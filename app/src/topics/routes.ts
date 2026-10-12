import type { FastifyInstance } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { topicBodyHash, topicBodyJoins } from './body.ts';
import { TopicResponseCache } from './cache.ts';
import { MATCHER_VERSION, normalizeTerm, POLICY_VERSION } from './policy.ts';
import { SOURCE } from './snapshot-client.ts';

export const matchingPolicy = {
  version: MATCHER_VERSION,
  policyVersion: POLICY_VERSION,
  titleWeight: 2,
  bodyWeight: 1,
  sameBlogDecay: 0.5,
  sources: ['title', 'body'],
};
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
// Feed categories retain their provenance, but never create an independent ranking dictionary.
// Collapse title/body evidence per article before weighting; canonical labels merge source aliases.
export const evidence = (
  blogScoped = false,
  verifiedOnly = false,
) => `scoped_posts AS (SELECT p.id,p.blog_id,p.published_at,p.content_hash FROM posts p JOIN blogs b ON b.id=p.blog_id WHERE p.published_at>=? AND p.published_at<=? AND ${verifiedOnly ? "b.status='verified'" : "b.status<>'moved'"} ${blogScoped ? 'AND b.slug=?' : ''}), evidence AS (
 SELECT p.id post_id,p.blog_id,p.published_at,CONCAT('tag:',t.id) topic_id,t.label,'tag-vocabulary' source,MAX(m.source='title') title_hit
 FROM scoped_posts p JOIN topic_matches_v2 m ON m.post_id=p.id JOIN topic_current c ON c.snapshot_id=m.snapshot_id AND c.source=${literal(SOURCE)}
 JOIN topic_canonical_terms t ON t.snapshot_id=m.snapshot_id AND t.id=m.term_id
 JOIN topic_post_indexes_v2 i ON i.post_id=p.id AND i.snapshot_id=m.snapshot_id
 ${topicBodyJoins}
 WHERE i.status='ok' AND (i.post_hash<=>p.content_hash) AND (i.body_hash<=>(${topicBodyHash}))
 AND i.matcher_version=${literal(MATCHER_VERSION)} AND t.policy_version=${literal(POLICY_VERSION)}
 AND t.exclusion_reason IS NULL AND m.source IN ('title','body')
 GROUP BY p.id,p.blog_id,p.published_at,t.id,t.label
), recent AS (SELECT * FROM evidence)`;
export const weightedScore = (titleCount: string, bodyCount: string) =>
  `(4*(1-POW(0.5,${titleCount}))+2*POW(0.5,${titleCount})*(1-POW(0.5,${bodyCount})))`;
const daysValue = (raw: unknown) =>
  raw === undefined ? 30 : typeof raw === 'string' && ['7', '30', '90'].includes(raw) ? Number(raw) : null;
const range = (days: number, now = new Date()) => [new Date(now.getTime() - days * 86400_000), now];
export async function vocabularyStatus(pool: Pool) {
  const [[row]] = await pool.query<RowDataPacket[]>(
    "SELECT s.id,s.manifest,s.synced_at FROM topic_current c JOIN topic_snapshots s ON s.id=c.snapshot_id WHERE c.source=? AND s.status='published'",
    [SOURCE],
  );
  const manifest = row ? (typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest) : null;
  const [excluded] = row
    ? await pool.query<RowDataPacket[]>(
        'SELECT exclusion_reason reason,COUNT(*) n FROM topic_canonical_terms WHERE snapshot_id=? AND policy_version=? AND exclusion_reason IS NOT NULL GROUP BY exclusion_reason',
        [row.id, POLICY_VERSION],
      )
    : [[]];
  return {
    status: row ? 'ready' : 'unavailable',
    source: SOURCE,
    version: row?.id ?? null,
    coverage: manifest?.coverage ?? null,
    syncedAt: row?.synced_at ?? null,
    window: manifest?.window ?? null,
    invalidTagCount: manifest?.invalidTagCount ?? null,
    normalizedTagCount: manifest?.normalizedTagCount ?? null,
    tagNormalization: manifest?.tagNormalization ?? null,
    upstreamSnapshotConsistent: manifest?.coverage === 'all-current-indexed-article-tags',
    excludedTermCount: excluded.reduce((sum, item) => sum + Number(item.n), 0),
    exclusionReasons: Object.fromEntries(excluded.map((item) => [item.reason, Number(item.n)])),
  };
}
const item = (r: RowDataPacket) => ({
  id: r.topic_id,
  label: r.label,
  source: r.source,
  score: Number(r.score),
  posts: Number(r.posts),
  blogs: Number(r.blogs),
  titlePosts: Number(r.title_posts),
  bodyOnlyPosts: Number(r.body_posts),
});
export async function ranking(pool: Pool, days: number, slug?: string, verifiedOnly = false, limit = 100, now = new Date()) {
  const args: unknown[] = [...range(days, now)];
  if (slug) args.push(slug);
  const boundedLimit = Math.min(200, Math.max(1, Math.floor(limit)));
  const [rows] = await pool.query<RowDataPacket[]>(
    `WITH ${evidence(Boolean(slug), verifiedOnly)}, per_blog AS (
    SELECT r.topic_id,r.label,r.source,r.blog_id,COUNT(*) n,SUM(title_hit) title_n,SUM(1-title_hit) body_n FROM recent r
    GROUP BY r.topic_id,r.label,r.source,r.blog_id)
    SELECT topic_id,label,source,SUM(${weightedScore('title_n', 'body_n')}) score,SUM(n) posts,COUNT(*) blogs,SUM(title_n) title_posts,SUM(body_n) body_posts FROM per_blog
    GROUP BY topic_id,label,source HAVING COUNT(*)>=${slug ? 1 : 2}
    ORDER BY score DESC,blogs DESC,posts DESC,topic_id LIMIT ${boundedLimit + 1}`,
    args,
  );
  return { items: rows.slice(0, boundedLimit).map(item), truncated: rows.length > boundedLimit };
}
/** Resolve retained source IDs without allowing native feed categories to extend the tag dictionary. */
export async function resolveTopic(pool: Pool, id: string) {
  if (id.startsWith('rss:')) {
    const [[native]] = await pool.query<RowDataPacket[]>("SELECT label FROM tags WHERE id=? AND status='active' AND visibility='public'", [
      id.slice(4),
    ]);
    if (!native) return null;
    const [[canonical]] = await pool.query<RowDataPacket[]>(
      'SELECT t.id,t.label,t.exclusion_reason FROM topic_canonical_terms t JOIN topic_current c ON c.snapshot_id=t.snapshot_id AND c.source=? WHERE t.normalized_label=? AND BINARY t.normalized_label=BINARY ? AND t.policy_version=?',
      [SOURCE, normalizeTerm(native.label), normalizeTerm(native.label), POLICY_VERSION],
    );
    return {
      id,
      label: canonical?.label ?? native.label,
      source: 'rss-category',
      canonicalId: canonical ? `tag:${canonical.id}` : null,
      excludedReason: canonical ? canonical.exclusion_reason : 'not-in-tag-vocabulary',
    };
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT t.id,t.label,t.exclusion_reason FROM topic_canonical_terms t JOIN topic_current c ON c.snapshot_id=t.snapshot_id AND c.source=?
     LEFT JOIN topic_term_aliases a ON a.snapshot_id=t.snapshot_id AND a.canonical_id=t.id AND a.term_id=?
     WHERE (t.id=? OR a.term_id=?) AND t.policy_version=? ORDER BY (t.id=?) DESC LIMIT 1`,
    [SOURCE, id.slice(4), id.slice(4), id.slice(4), POLICY_VERSION, id.slice(4)],
  );
  return rows[0]
    ? { id, label: rows[0].label, source: 'tag-vocabulary', canonicalId: `tag:${rows[0].id}`, excludedReason: rows[0].exclusion_reason }
    : null;
}
export async function topicEvidenceDetail(pool: Pool, id: string, days: number, verifiedOnly = false, now = new Date()) {
  const topic = await resolveTopic(pool, id);
  if (!topic) return null;
  if (!topic.canonicalId || topic.excludedReason) return { topic, blogs: [], articles: [], truncated: false };
  const args = [...range(days, now), topic.canonicalId];
  const [blogs] = await pool.query<RowDataPacket[]>(
    `WITH ${evidence(false, verifiedOnly)} SELECT b.id,b.slug,b.name,COUNT(*) posts,SUM(r.title_hit) titlePosts,SUM(1-r.title_hit) bodyOnlyPosts,${weightedScore('SUM(r.title_hit)', 'SUM(1-r.title_hit)')} score FROM recent r JOIN blogs b ON b.id=r.blog_id WHERE r.topic_id=? GROUP BY b.id,b.slug,b.name ORDER BY score DESC,posts DESC,b.id LIMIT 101`,
    args,
  );
  const [articles] = await pool.query<RowDataPacket[]>(
    `WITH ${evidence(false, verifiedOnly)} SELECT p.id,p.title,p.url,p.published_at publishedAt,b.slug blogSlug,b.name blogName FROM recent r JOIN posts p ON p.id=r.post_id JOIN blogs b ON b.id=r.blog_id WHERE r.topic_id=? ORDER BY p.published_at DESC,p.id DESC LIMIT 101`,
    args,
  );
  return {
    topic,
    blogs: blogs.slice(0, 100).map((b) => ({
      id: Number(b.id),
      slug: b.slug,
      name: b.name,
      posts: Number(b.posts),
      titlePosts: Number(b.titlePosts),
      bodyOnlyPosts: Number(b.bodyOnlyPosts),
      score: Number(b.score),
    })),
    articles: articles.slice(0, 100),
    truncated: blogs.length > 100 || articles.length > 100,
  };
}
const caches = new WeakMap<Pool, Set<TopicResponseCache>>();
export function invalidateTopicCache(pool: Pool) {
  for (const cache of caches.get(pool) ?? []) cache.clear();
}
export function registerTopicRoutes(app: FastifyInstance, pool: Pool) {
  const cache = new TopicResponseCache();
  const active = caches.get(pool) ?? new Set<TopicResponseCache>();
  active.add(cache);
  caches.set(pool, active);
  app.addHook('onClose', async () => {
    active.delete(cache);
    if (!active.size) caches.delete(pool);
  });
  const metadata = () => ({ generatedAt: new Date().toISOString(), cacheSeconds: cache.ttlMs / 1000, matchingPolicy });
  app.get<{ Querystring: { days?: string } }>('/api/topics', async (req, reply) => {
    const days = daysValue(req.query.days);
    if (!days) return reply.code(400).send({ error: 'invalid_days' });
    return cache.get(`rank:${days}`, async () => {
      const now = new Date();
      const results = await ranking(pool, days, undefined, false, 100, now);
      const dates = range(days, now);
      const [[coverage]] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) datedPosts,COALESCE(SUM(cb.status='ok' OR o.status='ok'),0) bodyObservedPosts FROM posts p JOIN blogs b ON b.id=p.blog_id ${topicBodyJoins} WHERE p.published_at>=? AND p.published_at<=? AND b.status<>'moved'`,
        dates,
      );
      const [[undated]] = await pool.query<RowDataPacket[]>(
        "SELECT COUNT(*) unknownDatePosts FROM posts p JOIN blogs b ON b.id=p.blog_id WHERE p.published_at IS NULL AND b.status<>'moved'",
      );
      const [[matched]] = await pool.query<RowDataPacket[]>(
        `WITH ${evidence()} SELECT COUNT(DISTINCT post_id) matchedPosts FROM recent`,
        dates,
      );
      const [[capped]] = await pool.query<RowDataPacket[]>(
        "SELECT COUNT(*) n FROM topic_post_indexes_v2 i JOIN topic_current c ON c.snapshot_id=i.snapshot_id AND c.source=? WHERE i.status='capped' AND i.matcher_version=?",
        [SOURCE, MATCHER_VERSION],
      );
      return {
        ...metadata(),
        days,
        source: 'tag-vocabulary',
        vocabulary: await vocabularyStatus(pool),
        coverage: {
          datedPosts: Number(coverage.datedPosts ?? 0),
          unknownDatePosts: Number(undated.unknownDatePosts ?? 0),
          bodyObservedPosts: Number(coverage.bodyObservedPosts ?? 0),
          matchedPosts: Number(matched.matchedPosts),
          cappedPosts: Number(capped.n),
        },
        ...results,
        minimumBlogs: 2,
        limit: 100,
      };
    });
  });
  app.get<{ Params: { id: string }; Querystring: { days?: string } }>('/api/topics/:id', async (req, reply) => {
    const days = daysValue(req.query.days);
    if (!days) return reply.code(400).send({ error: 'invalid_days' });
    const id = req.params.id;
    if (!/^(rss:[1-9]\d{0,9}|tag:[0-9a-f]{64})$/.test(id)) return reply.code(400).send({ error: 'invalid_topic' });
    const result = await cache.get(`detail:${days}:${id}`, async () => {
      const detail = await topicEvidenceDetail(pool, id, days);
      return detail ? { ...metadata(), days, vocabulary: await vocabularyStatus(pool), ...detail } : null;
    });
    return result ?? reply.code(404).send({ error: 'topic_not_found' });
  });
  app.get<{ Params: { slug: string }; Querystring: { days?: string } }>('/api/blogs/:slug/topics', async (req, reply) => {
    const days = daysValue(req.query.days);
    if (!days) return reply.code(400).send({ error: 'invalid_days' });
    if (req.params.slug.length > 255) return reply.code(400).send({ error: 'invalid_slug' });
    return cache.get(`blog:${days}:${req.params.slug}`, async () => ({
      ...metadata(),
      days,
      vocabulary: await vocabularyStatus(pool),
      ...(await ranking(pool, days, req.params.slug)),
      minimumBlogs: 1,
    }));
  });
}
