import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { BatchOptions, BatchResult } from '../jobs/contracts.ts';
import { withJobLease } from '../jobs/lease.ts';
import { iconManifest } from '../v1/favicon-routes.ts';
import { iconUrl } from '../v1/icons.ts';

export type RelationEdge = {
  sourceBlogId: number;
  targetBlogId: number;
  count: number;
  share: number;
  firstMentionAt: string | null;
  lastMentionAt: string | null;
  mutual: boolean;
};
export type RelationNode = { id: number; slug: string; name: string; iconUrl: string | null };
export type RelationCoverage = {
  observedPosts: number;
  totalPosts: number;
  failedPosts: number;
  noBodyPosts: number;
  unknownDatePosts: number;
  unresolvedLinks: number;
  truncatedPosts: number;
  graphTruncated: boolean;
  aggregationTruncated: boolean;
  sampledAt: string | null;
  method: string;
  nonBodyLinks: { sidebar: number; blogroll: number; comment: number };
};
export type RelationDTO = {
  days: number;
  generatedAt: string;
  nodes: RelationNode[];
  edges: RelationEdge[];
  mostMentioned: { blogId: number; mentions: number; incomingBlogs: number }[];
  mutual: { sourceBlogId: number; targetBlogId: number; forwardCount: number; reverseCount: number }[];
  coverage: RelationCoverage;
};
// Stable source-post / exact target / location identity survives crawler ordinal changes.
// This only filters public presentation; original observations/discovery evidence are never mutated.
const PUBLIC_RELATION = `EXISTS (SELECT 1 FROM relation_observations public_o WHERE public_o.post_id=l.source_post_id AND public_o.last_success_at IS NOT NULL AND public_o.status<>'reparse-pending') AND NOT EXISTS (SELECT 1 FROM admin_relation_overrides hidden_link
  WHERE hidden_link.source_post_id=l.source_post_id AND hidden_link.target_url_hash=SHA2(l.target_url,256)
  AND BINARY hidden_link.target_url=BINARY l.target_url AND hidden_link.location=l.location AND hidden_link.hidden=TRUE)`;
type RelationCache = { revision: number; entries: Map<string, { expires: number; dto: unknown }>; flights: Map<string, Promise<unknown>> };
const relationCaches = new WeakMap<Pool, RelationCache>();
function cacheFor(pool: Pool): RelationCache {
  let cache = relationCaches.get(pool);
  if (!cache) {
    cache = { revision: 0, entries: new Map(), flights: new Map() };
    relationCaches.set(pool, cache);
  }
  return cache;
}
/** Admin callers MUST await this after commit. Database CAS fences concurrent worker rebuilds. */
export async function invalidateRelationCache(pool: Pool) {
  const cache = cacheFor(pool);
  cache.revision++;
  cache.entries.clear();
  cache.flights.clear();
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    await c.query('INSERT INTO relation_projection_state (id,revision) VALUES (1,1) ON DUPLICATE KEY UPDATE revision=revision+1');
    await c.query('DELETE FROM relation_snapshots');
    await c.commit();
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
async function cachedProjection<T>(pool: Pool, key: string, ttl: number, build: () => Promise<T>): Promise<T> {
  const cache = cacheFor(pool);
  const hit = cache.entries.get(key);
  if (hit && hit.expires > Date.now()) return hit.dto as T;
  const pending = cache.flights.get(key);
  if (pending) return pending as Promise<T>;
  if (cache.flights.size >= 4) throw Object.assign(Error('relation_projection_busy'), { statusCode: 503 });
  const task = (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const revision = cache.revision;
      const dto = await build();
      if (cache.revision !== revision) continue;
      if (cache.entries.size >= 256) cache.entries.delete(cache.entries.keys().next().value as string);
      cache.entries.set(key, { expires: Date.now() + ttl, dto });
      return dto;
    }
    throw Error('relation_projection_changed');
  })().finally(() => {
    if (cache.flights.get(key) === task) cache.flights.delete(key);
  });
  cache.flights.set(key, task);
  return task;
}
async function buildSnapshot(pool: Pool, days: number, now: Date, attempt = 0): Promise<RelationDTO> {
  await pool.query('INSERT IGNORE INTO relation_projection_state (id,revision) VALUES (1,0)');
  const [[state]] = await pool.query<RowDataPacket[]>('SELECT revision FROM relation_projection_state WHERE id=1');
  const dto = await loadRelations(pool, days, now);
  await pool.query(
    `INSERT INTO relation_snapshots (days,revision,payload,generated_at)
    SELECT ?,revision,?,? FROM relation_projection_state WHERE id=1 AND revision=?
    ON DUPLICATE KEY UPDATE revision=VALUES(revision),payload=VALUES(payload),generated_at=VALUES(generated_at)`,
    [days, JSON.stringify(dto), now, state.revision],
  );
  const [[after]] = await pool.query<RowDataPacket[]>('SELECT revision FROM relation_projection_state WHERE id=1');
  if (Number(after.revision) !== Number(state.revision)) {
    if (attempt >= 1) throw Error('relation_projection_changed');
    return buildSnapshot(pool, days, now, attempt + 1);
  }
  return dto;
}
export async function readRelationSnapshot(pool: Pool, days: number, now = new Date()): Promise<RelationDTO> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT s.payload FROM relation_snapshots s JOIN relation_projection_state p ON p.id=1 AND p.revision=s.revision WHERE s.days=? AND s.generated_at>=?`,
    [days, new Date(now.getTime() - 600000)],
  );
  if (row) return typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return buildSnapshot(pool, days, now);
}
/** Schedule every five minutes independently of crawler enablement; three bounded window DTOs. */
export async function runRelationSnapshotBatch(pool: Pool, options: BatchOptions = {}): Promise<BatchResult> {
  return (
    (await withJobLease(pool, 'relation-snapshots', async (assertLease) => {
      let processed = 0;
      const deadline = Date.now() + Math.min(options.maxDurationMs ?? 120000, 120000);
      for (const days of [7, 30, 90]) {
        if (options.signal?.aborted || Date.now() >= deadline) break;
        await assertLease();
        await buildSnapshot(pool, days, options.now?.() ?? new Date());
        processed++;
      }
      return { processed, skipped: 0, truncated: processed < 3, reservedUnused: 0 };
    })) ?? { processed: 0, skipped: 1, truncated: false, reservedUnused: 0 }
  );
}
const iso = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
export function relationDays(value: unknown): number | null {
  return value === undefined ? 90 : ['7', '30', '90'].includes(String(value)) ? Number(value) : null;
}
export function withinRelationWindow(publishedAt: Date | null, now: Date, days: number): boolean {
  return !!publishedAt && publishedAt.getTime() >= now.getTime() - days * 86400000 && publishedAt.getTime() <= now.getTime();
}

/** Input counts are distinct article→publication body references. Self references are excluded. */
export function projectRelations(
  rows: {
    sourceBlogId: number;
    targetBlogId: number;
    count: number;
    denominator?: number;
    firstMentionAt: unknown;
    lastMentionAt: unknown;
  }[],
): RelationEdge[] {
  const safe = rows.filter((row) => row.sourceBlogId !== row.targetBlogId && row.count > 0);
  const denominators = new Map<number, number>();
  for (const row of safe) denominators.set(row.sourceBlogId, (denominators.get(row.sourceBlogId) || 0) + row.count);
  const keys = new Set(safe.map((row) => `${row.sourceBlogId}:${row.targetBlogId}`));
  return safe.map((row) => ({
    sourceBlogId: row.sourceBlogId,
    targetBlogId: row.targetBlogId,
    count: row.count,
    share: row.count / (row.denominator || denominators.get(row.sourceBlogId) || row.count),
    firstMentionAt: iso(row.firstMentionAt),
    lastMentionAt: iso(row.lastMentionAt),
    mutual: keys.has(`${row.targetBlogId}:${row.sourceBlogId}`),
  }));
}

export async function loadRelationCoverage(
  pool: Pool,
  blogId?: number,
): Promise<Omit<RelationCoverage, 'graphTruncated' | 'aggregationTruncated'>> {
  const [[coverage]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) totalPosts,
    COALESCE(SUM(o.status='ok'),0) observedPosts,COALESCE(SUM(o.status='failed'),0) failedPosts,
    COALESCE(SUM(o.status='no-body'),0) noBodyPosts,COALESCE(SUM(p.published_at IS NULL),0) unknownDatePosts,
    COALESCE(SUM(o.truncated=1),0) truncatedPosts,MAX(o.last_success_at) sampledAt
    FROM posts p JOIN blogs b ON b.id=p.blog_id LEFT JOIN relation_observations o ON o.post_id=p.id WHERE b.status='verified' ${blogId === undefined ? '' : 'AND p.blog_id=?'}`,
    blogId === undefined ? [] : [blogId],
  );
  const [locationRows] = await pool.query<RowDataPacket[]>(
    `SELECT l.location,COUNT(*) count,COALESCE(SUM(l.target_blog_id IS NULL),0) unresolved
    FROM relation_links l JOIN blogs b ON b.id=l.source_blog_id WHERE ${PUBLIC_RELATION} AND b.status='verified' ${blogId === undefined ? '' : 'AND l.source_blog_id=?'} GROUP BY l.location`,
    blogId === undefined ? [] : [blogId],
  );
  const [[homeLinks]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) count FROM relation_home_links l JOIN blogs b ON b.id=l.blog_id JOIN relation_home_scans s ON s.blog_id=l.blog_id AND s.status='ok'
    WHERE b.status='verified' ${blogId === undefined ? '' : 'AND l.blog_id=?'}`,
    blogId === undefined ? [] : [blogId],
  );
  const nonBodyLinks = { sidebar: 0, blogroll: Number(homeLinks.count), comment: 0 };
  let unresolved = 0;
  for (const r of locationRows) {
    if (r.location === 'body') unresolved += Number(r.unresolved);
    if (r.location in nonBodyLinks) nonBodyLinks[r.location as keyof typeof nonBodyLinks] += Number(r.count);
  }
  return {
    observedPosts: Number(coverage.observedPosts),
    totalPosts: Number(coverage.totalPosts),
    failedPosts: Number(coverage.failedPosts),
    noBodyPosts: Number(coverage.noBodyPosts),
    unknownDatePosts: Number(coverage.unknownDatePosts),
    unresolvedLinks: unresolved,
    truncatedPosts: Number(coverage.truncatedPosts),
    sampledAt: iso(coverage.sampledAt),
    method: `distinct-published-article-to-blog/body-only; share=source-resolved-body-mentions; coverage=${blogId === undefined ? 'all' : 'source-blog'}-indexed-posts`,
    nonBodyLinks,
  };
}

export async function loadRelations(pool: Pool, days = 90, now = new Date()): Promise<RelationDTO> {
  const cutoff = new Date(now.getTime() - days * 86400000);
  // Window functions run before LIMIT: a capped graph never changes the share denominator.
  const [rawEdges] = await pool.query<RowDataPacket[]>(
    `SELECT l.source_blog_id sourceBlogId,l.target_blog_id targetBlogId,COUNT(DISTINCT l.source_post_id) count,
    SUM(COUNT(DISTINCT l.source_post_id)) OVER (PARTITION BY l.source_blog_id) denominator,
    MIN(p.published_at) firstMentionAt,MAX(p.published_at) lastMentionAt
    FROM relation_links l JOIN posts p ON p.id=l.source_post_id JOIN blogs a ON a.id=l.source_blog_id JOIN blogs b ON b.id=l.target_blog_id
    JOIN relation_observations o ON o.post_id=l.source_post_id
    WHERE ${PUBLIC_RELATION} AND l.location='body' AND l.target_blog_id IS NOT NULL AND l.source_blog_id<>l.target_blog_id
    AND a.status='verified' AND b.status='verified' AND o.last_success_at IS NOT NULL AND p.published_at>=? AND p.published_at<=?
    GROUP BY l.source_blog_id,l.target_blog_id ORDER BY count DESC,l.source_blog_id,l.target_blog_id LIMIT 10001`,
    [cutoff, now],
  );
  const allEdges = projectRelations(
    rawEdges.slice(0, 10000).map((r) => ({
      sourceBlogId: Number(r.sourceBlogId),
      targetBlogId: Number(r.targetBlogId),
      count: Number(r.count),
      denominator: Number(r.denominator),
      firstMentionAt: r.firstMentionAt,
      lastMentionAt: r.lastMentionAt,
    })),
  );
  const ranks = new Map<number, { blogId: number; mentions: number; incomingBlogs: number }>();
  const pairs = new Map(allEdges.map((e) => [`${e.sourceBlogId}:${e.targetBlogId}`, e]));
  const mutual: RelationDTO['mutual'] = [];
  for (const edge of allEdges) {
    const rank = ranks.get(edge.targetBlogId) || { blogId: edge.targetBlogId, mentions: 0, incomingBlogs: 0 };
    rank.mentions += edge.count;
    rank.incomingBlogs++;
    ranks.set(edge.targetBlogId, rank);
    const reverse = pairs.get(`${edge.targetBlogId}:${edge.sourceBlogId}`);
    if (reverse && edge.sourceBlogId < edge.targetBlogId)
      mutual.push({
        sourceBlogId: edge.sourceBlogId,
        targetBlogId: edge.targetBlogId,
        forwardCount: edge.count,
        reverseCount: reverse.count,
      });
  }
  mutual.sort((a, b) => b.forwardCount + b.reverseCount - (a.forwardCount + a.reverseCount));
  const mostMentioned = [...ranks.values()]
    .sort((a, b) => b.incomingBlogs - a.incomingBlogs || b.mentions - a.mentions || a.blogId - b.blogId)
    .slice(0, 100);
  const nodeIds = new Set<number>();
  const edges: RelationEdge[] = [];
  for (const edge of allEdges) {
    if (edges.length >= 500) break;
    const addition = Number(!nodeIds.has(edge.sourceBlogId)) + Number(!nodeIds.has(edge.targetBlogId));
    if (nodeIds.size + addition > 200) continue;
    nodeIds.add(edge.sourceBlogId);
    nodeIds.add(edge.targetBlogId);
    edges.push(edge);
  }
  // Also resolve names for leaderboard rows outside the drawn graph.
  for (const rank of mostMentioned) nodeIds.add(rank.blogId);
  for (const pair of mutual.slice(0, 100)) {
    nodeIds.add(pair.sourceBlogId);
    nodeIds.add(pair.targetBlogId);
  }
  const [nodes] = nodeIds.size ? await pool.query<RowDataPacket[]>('SELECT id,slug,name FROM blogs WHERE id IN (?)', [[...nodeIds]]) : [[]];
  const icons = await iconManifest();
  const coverage = await loadRelationCoverage(pool);
  return {
    days,
    generatedAt: now.toISOString(),
    nodes: nodes.map((r) => ({ id: Number(r.id), slug: r.slug, name: r.name, iconUrl: iconUrl(r.slug, icons) })),
    edges,
    mostMentioned,
    mutual: mutual.slice(0, 100),
    coverage: { ...coverage, graphTruncated: edges.length < allEdges.length, aggregationTruncated: rawEdges.length > 10000 },
  };
}

async function projectionResponse(reply: FastifyReply, build: () => Promise<unknown>) {
  try {
    return await build();
  } catch (error) {
    if (error instanceof Error && (error.message === 'relation_projection_busy' || error.message === 'relation_projection_changed'))
      return reply.header('retry-after', '2').code(503).send({ error: 'relation_projection_busy' });
    throw error;
  }
}
export async function registerRelationRoutes(app: FastifyInstance, pool: Pool) {
  const read = (days: number) => readPublicRelations(pool, days);
  app.get('/api/relations', async (request, reply) => {
    const days = relationDays((request.query as { days?: unknown }).days);
    if (days === null) return reply.code(400).send({ error: 'invalid_days' });
    return projectionResponse(reply, () => read(days));
  });
  app.get('/api/blogs/:slug/relations', async (request, reply) => {
    const days = relationDays((request.query as { days?: unknown }).days);
    if (days === null) return reply.code(400).send({ error: 'invalid_days' });
    const { slug } = request.params as { slug: string };
    const [[blog]] = await pool.query<RowDataPacket[]>("SELECT id,slug,name FROM blogs WHERE slug=? AND status<>'moved'", [slug]);
    if (!blog) return reply.code(404).send({ error: 'blog_not_found' });
    return projectionResponse(reply, () => readBlogRelations(pool, { id: Number(blog.id) }, days));
  });
}

export function readBlogRelations(pool: Pool, blog: { id: number }, days: number) {
  return cachedProjection(pool, `profile:${blog.id}:${days}`, 60000, async () => {
    // Profile edges are queried separately so the global 500-edge graph cap never hides a source's links.
    const now = new Date();
    const cutoff = new Date(now.getTime() - days * 86400000);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT e.* FROM (
      SELECT l.source_blog_id sourceBlogId,l.target_blog_id targetBlogId,COUNT(DISTINCT l.source_post_id) count,
        SUM(COUNT(DISTINCT l.source_post_id)) OVER (PARTITION BY l.source_blog_id) denominator,MIN(p.published_at) firstMentionAt,MAX(p.published_at) lastMentionAt
      FROM relation_links l JOIN posts p ON p.id=l.source_post_id JOIN blogs a ON a.id=l.source_blog_id JOIN blogs b ON b.id=l.target_blog_id
      WHERE ${PUBLIC_RELATION} AND l.source_blog_id IN (SELECT relevant.source_id FROM (SELECT ? source_id UNION SELECT source_blog_id FROM relation_links WHERE target_blog_id=?) relevant) AND l.location='body' AND l.source_blog_id<>l.target_blog_id AND a.status='verified' AND b.status='verified' AND p.published_at>=? AND p.published_at<=?
      GROUP BY l.source_blog_id,l.target_blog_id) e WHERE sourceBlogId=? OR targetBlogId=? ORDER BY count DESC,sourceBlogId,targetBlogId LIMIT 1001`,
      [blog.id, blog.id, cutoff, now, blog.id, blog.id],
    );
    const edges = projectRelations(
      rows.slice(0, 1000).map((r) => ({
        sourceBlogId: Number(r.sourceBlogId),
        targetBlogId: Number(r.targetBlogId),
        count: Number(r.count),
        denominator: Number(r.denominator),
        firstMentionAt: r.firstMentionAt,
        lastMentionAt: r.lastMentionAt,
      })),
    );
    const ids = [...new Set([Number(blog.id), ...edges.flatMap((e) => [e.sourceBlogId, e.targetBlogId])])];
    const [nodes] = await pool.query<RowDataPacket[]>('SELECT id,slug,name FROM blogs WHERE id IN (?)', [ids]);
    const [evidence] = await pool.query<RowDataPacket[]>(
      `SELECT p.id postId,p.title postTitle,p.url postUrl,l.target_url targetUrl,l.anchor_text anchor,p.published_at publishedAt,
      l.source_blog_id sourceBlogId,l.target_blog_id targetBlogId,l.location
      FROM relation_links l JOIN posts p ON p.id=l.source_post_id JOIN blogs a ON a.id=l.source_blog_id JOIN blogs b ON b.id=l.target_blog_id
      WHERE ${PUBLIC_RELATION} AND l.location='body' AND (l.source_blog_id=? OR l.target_blog_id=?) AND l.source_blog_id<>l.target_blog_id
      AND a.status='verified' AND b.status='verified' AND p.published_at>=? AND p.published_at<=?
      ORDER BY p.published_at DESC,l.source_post_id,l.ordinal LIMIT 20`,
      [blog.id, blog.id, cutoff, now],
    );
    const icons = await iconManifest();
    const coverage = await loadRelationCoverage(pool, Number(blog.id));
    return {
      days,
      generatedAt: now.toISOString(),
      mostMentioned: [],
      mutual: [],
      coverage: { ...coverage, graphTruncated: rows.length > 1000, aggregationTruncated: false },
      blogId: Number(blog.id),
      nodes: nodes.map((r) => ({ id: Number(r.id), slug: r.slug, name: r.name, iconUrl: iconUrl(r.slug, icons) })),
      edges,
      outgoing: edges.filter((e) => e.sourceBlogId === blog.id),
      incoming: edges.filter((e) => e.targetBlogId === blog.id),
      evidence: evidence.map((r) => ({ ...r, publishedAt: iso(r.publishedAt) })),
      profileTruncated: rows.length > 1000,
    };
  });
}

export function readPublicRelations(pool: Pool, days: number) {
  return cachedProjection(pool, `global:${days}`, 300000, () => readRelationSnapshot(pool, days));
}
