import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { BatchOptions, BatchResult } from '../jobs/contracts.ts';
import { withJobLease } from '../jobs/lease.ts';
import { publicSummary } from '../public-post.ts';
import { iconManifest } from '../v1/favicon-routes.ts';
import { iconUrl } from '../v1/icons.ts';
import { loadProfileMentions } from './home-feed.ts';
import { PUBLIC_RELATION } from './public-relation.ts';
import { loadSharedTags } from './shared-tags.ts';
import { loadProfileTextSimilarity } from './text-similarity-profile.ts';
import { registerTextSimilarityRoute } from './text-similarity-routes.ts';

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
type RelationCache = { revision: number; active: number };
const relationCaches = new WeakMap<Pool, RelationCache>();
function cacheFor(pool: Pool): RelationCache {
  let cache = relationCaches.get(pool);
  if (!cache) {
    cache = { revision: 0, active: 0 };
    relationCaches.set(pool, cache);
  }
  return cache;
}
/** Admin callers MUST await this after commit. Database CAS fences concurrent worker rebuilds. */
export async function invalidateRelationCache(pool: Pool) {
  const cache = cacheFor(pool);
  cache.revision++;
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
/** Bound live reads without sharing a result across request boundaries. */
async function cachedProjection<T>(pool: Pool, _key: string, _ttl: number, build: () => Promise<T>): Promise<T> {
  const cache = cacheFor(pool);
  if (cache.active >= 4) throw Object.assign(Error('relation_projection_busy'), { statusCode: 503 });
  cache.active++;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const revision = cache.revision;
      const dto = await build();
      if (cache.revision !== revision) continue;
      return dto;
    }
    throw Error('relation_projection_changed');
  } finally {
    cache.active--;
  }
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
  // Worker snapshots cannot prove visibility after a deletion/hide. Read live
  // SQL, retaining the revision fence for admin edits committed mid-query.
  for (let attempt = 0; attempt < 2; attempt++) {
    const [[before]] = await pool.query<RowDataPacket[]>('SELECT revision FROM relation_projection_state WHERE id=1');
    const result = await loadRelations(pool, days, now);
    const [[after]] = await pool.query<RowDataPacket[]>('SELECT revision FROM relation_projection_state WHERE id=1');
    if (Number(before?.revision ?? 0) === Number(after?.revision ?? 0)) return result;
  }
  throw Error('relation_projection_changed');
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
    FROM posts p JOIN blogs b ON b.id=p.blog_id LEFT JOIN relation_observations o ON o.post_id=p.id WHERE b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP()) ${blogId === undefined ? '' : 'AND p.blog_id=?'}`,
    blogId === undefined ? [] : [blogId],
  );
  const [locationRows] = await pool.query<RowDataPacket[]>(
    `SELECT l.location,COUNT(*) count,COALESCE(SUM(l.target_blog_id IS NULL),0) unresolved
    FROM relation_links l JOIN posts p ON p.id=l.source_post_id AND p.blog_id=l.source_blog_id JOIN blogs b ON b.id=p.blog_id WHERE ${PUBLIC_RELATION} AND b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP()) ${blogId === undefined ? '' : 'AND l.source_blog_id=?'} GROUP BY l.location`,
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
  const [nodes] = nodeIds.size
    ? await pool.query<RowDataPacket[]>("SELECT id,slug,name FROM blogs WHERE id IN (?) AND status='verified'", [[...nodeIds]])
    : [[]];
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
  registerTextSimilarityRoute(app, pool);
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
    const [[blog]] = await pool.query<RowDataPacket[]>("SELECT id,slug,name FROM blogs WHERE slug=? AND status='verified'", [slug]);
    if (!blog) return reply.code(404).send({ error: 'blog_not_found' });
    return projectionResponse(reply, () => readBlogRelations(pool, { id: Number(blog.id) }, days));
  });
  // The blog page's 最近被這些部落格提到: read fresh each time, so a hide override applies at once.
  app.get('/api/blogs/:slug/mentions', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const { slug } = request.params as { slug: string };
    const [[blog]] = await pool.query<RowDataPacket[]>("SELECT id FROM blogs WHERE slug=? AND status='verified'", [slug]);
    if (!blog) return reply.code(404).send({ error: 'blog_not_found' });
    try {
      return await loadProfileMentions(pool, Number(blog.id));
    } catch {
      return reply.header('retry-after', '2').code(503).send({ error: 'mentions_unavailable' });
    }
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
    const [nodes] = await pool.query<RowDataPacket[]>("SELECT id,slug,name FROM blogs WHERE id IN (?) AND status='verified'", [ids]);
    const [evidence] = await pool.query<RowDataPacket[]>(
      `SET STATEMENT max_statement_time=0.25 FOR SELECT p.id postId,p.title postTitle,p.url postUrl,l.target_url targetUrl,l.anchor_text anchor,p.published_at publishedAt,
      l.source_blog_id sourceBlogId,l.target_blog_id targetBlogId,l.location,l.context,
      target_post.id targetPostId,
      l.observed_at observedAt,o.parser_version matchVersion
      FROM relation_links l JOIN posts p ON p.id=l.source_post_id JOIN blogs a ON a.id=l.source_blog_id JOIN blogs b ON b.id=l.target_blog_id
      JOIN relation_observations o ON o.post_id=l.source_post_id
      LEFT JOIN posts target_post ON target_post.id=l.target_post_id AND target_post.blog_id=l.target_blog_id
        AND (target_post.published_at IS NULL OR target_post.published_at<=UTC_TIMESTAMP())
      WHERE ${PUBLIC_RELATION} AND l.location='body' AND (l.source_blog_id=? OR l.target_blog_id=?) AND l.source_blog_id<>l.target_blog_id
      AND a.status='verified' AND b.status='verified' AND p.published_at>=? AND p.published_at<=?
      ORDER BY p.published_at DESC,l.source_post_id,l.ordinal LIMIT 21`,
      [blog.id, blog.id, cutoff, now],
    );
    const [nonBodyEvidence] = await pool.query<RowDataPacket[]>(
      `SET STATEMENT max_statement_time=0.25 FOR SELECT p.id postId,p.title postTitle,p.url postUrl,l.target_url targetUrl,l.anchor_text anchor,p.published_at publishedAt,
      l.source_blog_id sourceBlogId,l.target_blog_id targetBlogId,l.location,l.context,l.observed_at observedAt,o.parser_version matchVersion
      FROM relation_links l JOIN posts p ON p.id=l.source_post_id JOIN blogs a ON a.id=l.source_blog_id JOIN blogs b ON b.id=l.target_blog_id
      JOIN relation_observations o ON o.post_id=l.source_post_id
      WHERE ${PUBLIC_RELATION} AND l.location IN ('blogroll','sidebar','comment') AND (l.source_blog_id=? OR l.target_blog_id=?)
      AND l.source_blog_id<>l.target_blog_id AND a.status='verified' AND b.status='verified' AND p.published_at>=? AND p.published_at<=?
      ORDER BY p.published_at DESC,l.source_post_id,l.ordinal LIMIT 21`,
      [blog.id, blog.id, cutoff, now],
    );
    const projectEvidence = (r: RowDataPacket) => ({
      postId: Number(r.postId),
      postTitle: r.postTitle,
      postUrl: r.postUrl,
      targetUrl: r.targetUrl,
      anchor: r.anchor,
      publishedAt: iso(r.publishedAt),
      sourceBlogId: Number(r.sourceBlogId),
      targetBlogId: Number(r.targetBlogId),
      location: r.location,
      context: publicSummary(r.context, 240),
      observedAt: iso(r.observedAt),
      matchVersion: r.matchVersion,
      evidenceType: 'direct-link' as const,
      contextSource: r.location,
    });
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
      evidence: evidence.slice(0, 20).map(projectEvidence),
      evidenceTruncated: evidence.length > 20,
      nonBodyEvidence: nonBodyEvidence.slice(0, 20).map(projectEvidence),
      nonBodyEvidenceTruncated: nonBodyEvidence.length > 20,
      sharedTags:
        process.env.BLOG_SHARED_TAGS_ENABLED === 'true'
          ? await loadSharedTags(pool, { sourceBlogId: blog.id, days: days as 7 | 30 | 90 })
          : { status: 'not-enabled' as const },
      textSimilarity: await loadProfileTextSimilarity(
        pool,
        blog.id,
        evidence.map((r) => ({
          postId: Number(r.postId),
          targetPostId: r.targetPostId == null ? null : Number(r.targetPostId),
          sourceBlogId: Number(r.sourceBlogId),
          targetBlogId: Number(r.targetBlogId),
          location: r.location,
        })),
        { enabled: process.env.BLOG_TEXT_SIMILARITY_ENABLED === 'true' },
      ),
      profileTruncated: rows.length > 1000,
    };
  });
}

export function readPublicRelations(pool: Pool, days: number) {
  return cachedProjection(pool, `global:${days}`, 300000, () => readRelationSnapshot(pool, days));
}
