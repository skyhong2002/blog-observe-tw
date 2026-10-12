import type { Pool } from 'mysql2/promise';
import { matchingPolicy, ranking, topicEvidenceDetail, vocabularyStatus } from '../topics/routes.ts';
import { iso } from './data.ts';
export async function listTopics(pool: Pool, hours: number, limit: number) {
  return {
    ...(await ranking(pool, hours / 24, undefined, true, limit)),
    nextCursor: null,
    hours,
    vocabulary: await vocabularyStatus(pool),
    matchingPolicy,
    minimumBlogs: 2,
    generatedAt: new Date().toISOString(),
  };
}
export async function topicDetail(pool: Pool, id: string, hours: number, historyCursor?: string) {
  const now = new Date();
  const detail = await topicEvidenceDetail(pool, id, hours / 24, true, now, historyCursor);
  if (!detail) return null;
  return {
    ...detail,
    hours,
    generatedAt: now.toISOString(),
    vocabulary: await vocabularyStatus(pool),
    matchingPolicy,
    articles: detail.articles.map((p) => ({
      id: Number(p.id),
      title: p.title,
      url: p.url,
      publishedAt: iso(p.publishedAt),
      blogSlug: p.blogSlug,
      blogName: p.blogName,
    })),
  };
}
