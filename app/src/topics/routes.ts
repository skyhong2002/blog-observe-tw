import type { FastifyInstance } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { SOURCE } from './snapshot-client.ts';

// Native feed categories remain live evidence; neither curated tags nor source tables are mutated.
// Vocabulary category mapping is exact normalized-label equality; title/body matches are versioned.
const evidence = `evidence AS (
 SELECT p.id post_id,p.blog_id,p.published_at,CONCAT('rss:',t.id) topic_id,t.label,'rss-category' source
 FROM posts p JOIN post_tags pt ON pt.post_id=p.id JOIN tags t ON t.id=pt.tag_id
 WHERE pt.source_type='crawler' AND pt.status='active' AND t.visibility='public' AND t.status='active'
 UNION
 SELECT p.id,p.blog_id,p.published_at,CONCAT('tag:',t.id),t.label,'tag-vocabulary'
 FROM posts p JOIN topic_matches m ON m.post_id=p.id JOIN topic_current c ON c.snapshot_id=m.snapshot_id
 JOIN topic_terms t ON t.snapshot_id=m.snapshot_id AND t.id=m.term_id
 JOIN topic_post_indexes i ON i.post_id=p.id AND i.snapshot_id=m.snapshot_id
 LEFT JOIN relation_observations o ON o.post_id=p.id
 WHERE i.status='ok' AND (i.post_hash<=>p.content_hash) AND (i.body_hash<=>(CASE WHEN o.status='ok' THEN o.content_hash END))
 UNION
 SELECT p.id,p.blog_id,p.published_at,CONCAT('tag:',t.id),t.label,'tag-vocabulary'
 FROM posts p JOIN post_tags pt ON pt.post_id=p.id JOIN tags native ON native.id=pt.tag_id
 JOIN topic_terms t ON t.normalized_label=native.normalized_label AND BINARY t.normalized_label=BINARY native.normalized_label
 JOIN topic_current c ON c.snapshot_id=t.snapshot_id
 WHERE pt.source_type='crawler' AND pt.status='active' AND native.visibility='public' AND native.status='active'
), recent AS (SELECT e.* FROM evidence e JOIN blogs b ON b.id=e.blog_id
 WHERE b.status<>'moved' AND e.published_at>=? AND e.published_at<=?)`;
const daysValue = (raw: unknown) =>
  raw === undefined ? 30 : typeof raw === 'string' && ['7', '30', '90'].includes(raw) ? Number(raw) : null;
const range = (days: number) => {
  const now = new Date();
  return [new Date(now.getTime() - days * 86400_000), now];
};
export async function vocabularyStatus(pool: Pool) {
  const [[row]] = await pool.query<RowDataPacket[]>(
    "SELECT s.id,s.manifest,s.synced_at FROM topic_current c JOIN topic_snapshots s ON s.id=c.snapshot_id WHERE c.source=? AND s.status='published'",
    [SOURCE],
  );
  const manifest = row ? (typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest) : null;
  return {
    status: row ? 'ready' : 'unavailable',
    source: SOURCE,
    version: row?.id ?? null,
    coverage: manifest?.coverage ?? null,
    syncedAt: row?.synced_at ?? null,
    window: manifest?.window ?? null,
    upstreamSnapshotConsistent: manifest?.coverage === 'all-current-indexed-article-tags',
  };
}
const item = (r: RowDataPacket) => ({
  id: r.topic_id,
  label: r.label,
  source: r.source,
  score: Number(r.score),
  posts: Number(r.posts),
  blogs: Number(r.blogs),
});
async function ranking(pool: Pool, days: number, slug?: string) {
  const args: unknown[] = [...range(days)];
  if (slug) args.push(slug);
  const [rows] = await pool.query<RowDataPacket[]>(
    `WITH ${evidence}, per_blog AS (
    SELECT r.topic_id,r.label,r.source,r.blog_id,COUNT(DISTINCT r.post_id) n FROM recent r
    ${slug ? 'JOIN blogs b ON b.id=r.blog_id WHERE b.slug=?' : ''}
    GROUP BY r.topic_id,r.label,r.source,r.blog_id)
    SELECT topic_id,label,source,SUM(2*(1-POW(0.5,n))) score,SUM(n) posts,COUNT(*) blogs FROM per_blog
    GROUP BY topic_id,label,source HAVING COUNT(*)>=${slug ? 1 : 2}
    ORDER BY score DESC,blogs DESC,posts DESC,topic_id LIMIT 101`,
    args,
  );
  return { items: rows.slice(0, 100).map(item), truncated: rows.length > 100 };
}
export function registerTopicRoutes(app: FastifyInstance, pool: Pool) {
  app.get<{ Querystring: { days?: string } }>('/api/topics', async (req, reply) => {
    const days = daysValue(req.query.days);
    if (!days) return reply.code(400).send({ error: 'invalid_days' });
    const results = await ranking(pool, days);
    const dates = range(days);
    const [[coverage]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) total,
      SUM(p.published_at IS NULL) unknownDatePosts,
      SUM(p.published_at>=? AND p.published_at<=?) datedPosts,
      SUM(p.published_at>=? AND p.published_at<=? AND o.status='ok') bodyObservedPosts
      FROM posts p JOIN blogs b ON b.id=p.blog_id LEFT JOIN relation_observations o ON o.post_id=p.id WHERE b.status<>'moved'`,
      [...dates, ...dates],
    );
    const [[matched]] = await pool.query<RowDataPacket[]>(
      `WITH ${evidence} SELECT COUNT(DISTINCT post_id) matchedPosts FROM recent`,
      dates,
    );
    const [[capped]] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) n FROM topic_post_indexes WHERE status='capped'");
    return {
      days,
      source: 'rss-categories-and-tag-vocabulary',
      vocabulary: await vocabularyStatus(pool),
      coverage: {
        datedPosts: Number(coverage.datedPosts ?? 0),
        unknownDatePosts: Number(coverage.unknownDatePosts ?? 0),
        bodyObservedPosts: Number(coverage.bodyObservedPosts ?? 0),
        matchedPosts: Number(matched.matchedPosts),
        cappedPosts: Number(capped.n),
      },
      ...results,
      minimumBlogs: 2,
      limit: 100,
    };
  });
  app.get<{ Params: { id: string }; Querystring: { days?: string } }>('/api/topics/:id', async (req, reply) => {
    const days = daysValue(req.query.days);
    if (!days) return reply.code(400).send({ error: 'invalid_days' });
    const id = req.params.id;
    if (!/^(rss:[1-9]\d{0,9}|tag:[0-9a-f]{64})$/.test(id)) return reply.code(400).send({ error: 'invalid_topic' });
    const [topicRows] = await pool.query<RowDataPacket[]>(
      id.startsWith('rss:')
        ? "SELECT label FROM tags WHERE id=? AND status='active' AND visibility='public'"
        : 'SELECT t.label FROM topic_terms t JOIN topic_current c ON c.snapshot_id=t.snapshot_id WHERE t.id=?',
      [id.slice(4)],
    );
    if (!topicRows[0]) return reply.code(404).send({ error: 'topic_not_found' });
    const args = [...range(days), id];
    const [blogs] = await pool.query<RowDataPacket[]>(
      `WITH ${evidence} SELECT b.id,b.slug,b.name,COUNT(DISTINCT r.post_id) posts,2*(1-POW(0.5,COUNT(DISTINCT r.post_id))) score FROM recent r JOIN blogs b ON b.id=r.blog_id WHERE r.topic_id=? GROUP BY b.id,b.slug,b.name ORDER BY posts DESC,b.id LIMIT 101`,
      args,
    );
    const [articles] = await pool.query<RowDataPacket[]>(
      `WITH ${evidence} SELECT DISTINCT p.id,p.title,p.url,p.published_at publishedAt,b.slug blogSlug,b.name blogName FROM recent r JOIN posts p ON p.id=r.post_id JOIN blogs b ON b.id=r.blog_id WHERE r.topic_id=? ORDER BY p.published_at DESC,p.id DESC LIMIT 101`,
      args,
    );
    return {
      days,
      vocabulary: await vocabularyStatus(pool),
      topic: { id, label: topicRows[0].label, source: id.startsWith('rss:') ? 'rss-category' : 'tag-vocabulary' },
      blogs: blogs.slice(0, 100).map((b) => ({ ...b, posts: Number(b.posts), score: Number(b.score) })),
      articles: articles.slice(0, 100),
      truncated: blogs.length > 100 || articles.length > 100,
    };
  });
  app.get<{ Params: { slug: string }; Querystring: { days?: string } }>('/api/blogs/:slug/topics', async (req, reply) => {
    const days = daysValue(req.query.days);
    if (!days) return reply.code(400).send({ error: 'invalid_days' });
    if (req.params.slug.length > 255) return reply.code(400).send({ error: 'invalid_slug' });
    return { days, vocabulary: await vocabularyStatus(pool), ...(await ranking(pool, days, req.params.slug)), minimumBlogs: 1 };
  });
}
