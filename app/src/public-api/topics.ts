import type { Pool, RowDataPacket } from 'mysql2/promise';
import { evidence, ranking, vocabularyStatus } from '../topics/routes.ts';
import { iso } from './data.ts';
export async function listTopics(pool: Pool, hours: number, limit: number) {
  return {
    ...(await ranking(pool, hours / 24, undefined, true, limit)),
    nextCursor: null,
    hours,
    vocabulary: await vocabularyStatus(pool),
    minimumBlogs: 2,
    generatedAt: new Date().toISOString(),
  };
}
export async function topicDetail(pool: Pool, id: string, hours: number) {
  const [[topic]] = await pool.query<RowDataPacket[]>(
    id.startsWith('rss:')
      ? "SELECT label FROM tags WHERE id=? AND status='active' AND visibility='public'"
      : 'SELECT t.label FROM topic_terms t JOIN topic_current c ON c.snapshot_id=t.snapshot_id WHERE t.id=?',
    [id.slice(4)],
  );
  if (!topic) return null;
  const now = new Date(),
    args = [new Date(now.getTime() - hours * 3600000), now, id];
  const [blogs] = await pool.query<RowDataPacket[]>(
    `WITH ${evidence(false, true)} SELECT b.id,b.slug,b.name,COUNT(DISTINCT r.post_id) posts,2*(1-POW(0.5,COUNT(DISTINCT r.post_id))) score FROM recent r JOIN blogs b ON b.id=r.blog_id WHERE r.topic_id=? GROUP BY b.id,b.slug,b.name ORDER BY posts DESC,b.id LIMIT 101`,
    args,
  );
  const [articles] = await pool.query<RowDataPacket[]>(
    `WITH ${evidence(false, true)} SELECT DISTINCT p.id,p.title,p.url,p.published_at publishedAt,b.slug blogSlug,b.name blogName FROM recent r JOIN posts p ON p.id=r.post_id JOIN blogs b ON b.id=r.blog_id WHERE r.topic_id=? ORDER BY p.published_at DESC,p.id DESC LIMIT 101`,
    args,
  );
  return {
    hours,
    generatedAt: now.toISOString(),
    vocabulary: await vocabularyStatus(pool),
    topic: { id, label: topic.label, source: id.startsWith('rss:') ? 'rss-category' : 'tag-vocabulary' },
    blogs: blogs
      .slice(0, 100)
      .map((b) => ({ id: Number(b.id), slug: b.slug, name: b.name, posts: Number(b.posts), score: Number(b.score) })),
    articles: articles.slice(0, 100).map((p) => ({
      id: Number(p.id),
      title: p.title,
      url: p.url,
      publishedAt: iso(p.publishedAt),
      blogSlug: p.blogSlug,
      blogName: p.blogName,
    })),
    truncated: blogs.length > 100 || articles.length > 100,
  };
}
