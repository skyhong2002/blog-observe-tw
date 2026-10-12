import * as cheerio from 'cheerio';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { BatchOptions, BatchResult } from '../jobs/contracts.ts';
import { withJobLease } from '../jobs/lease.ts';
import { infer } from './service.ts';

export function interleaveTasks<T>(profiles: T[], articles: T[], limit: number): T[] {
  const rows: T[] = [];
  for (let i = 0; i < Math.max(profiles.length, articles.length) && rows.length < limit; i++) {
    if (profiles[i]) rows.push(profiles[i]);
    if (articles[i] && rows.length < limit) rows.push(articles[i]);
  }
  return rows;
}
const plain = (s: string) => cheerio.load(s).text().replace(/\s+/g, ' ').trim();
export async function runAiBatch(pool: Pool, options: BatchOptions = {}): Promise<BatchResult> {
  const result: BatchResult = { processed: 0, skipped: 0, truncated: false, reservedUnused: 0 };
  const work = await withJobLease(pool, 'ai', async (assert) => {
    const limit = Math.max(1, Math.min(10, options.limit || 3));
    const deadline = Date.now() + Math.min(120000, options.maxDurationMs || 120000);
    const day = (options.now?.() || new Date()).toISOString().slice(0, 10);
    const [budgets] = await pool.query<RowDataPacket[]>(
      "SELECT scope,used FROM work_budgets WHERE day=? AND scope IN ('ai:task:profile','ai:task:topics')",
      [day],
    );
    const available = (task: string) => Number(budgets.find((b) => b.scope === `ai:task:${task}`)?.used || 0) < 2;
    const [profiles] = available('profile')
      ? await pool.query<RowDataPacket[]>(
          `SELECT 'blog' entity_type,b.id,b.name title,b.description summary,NULL body_text,MAX(a.updated_at) attempted FROM blogs b LEFT JOIN ai_results a ON a.entity_type='blog' AND a.entity_id=b.id AND a.task='profile' WHERE b.status='verified' GROUP BY b.id HAVING attempted IS NULL OR attempted<DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) OR MAX(a.status)<>'ok' AND MAX(a.attempts)<3 AND MAX(a.next_attempt_at)<=UTC_TIMESTAMP() ORDER BY attempted,b.id LIMIT ?`,
          [limit],
        )
      : [[]];
    const [articles] = available('topics')
      ? await pool.query<RowDataPacket[]>(
          `SELECT 'post' entity_type,p.id,p.title,p.summary,o.body_text,MAX(a.updated_at) attempted FROM posts p LEFT JOIN relation_observations o ON o.post_id=p.id AND o.status='ok' LEFT JOIN ai_results a ON a.entity_type='post' AND a.entity_id=p.id AND a.task='topics' WHERE p.published_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 90 DAY) GROUP BY p.id HAVING attempted IS NULL OR attempted<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY) OR MAX(a.status)<>'ok' AND MAX(a.attempts)<3 AND MAX(a.next_attempt_at)<=UTC_TIMESTAMP() ORDER BY attempted,p.id LIMIT ?`,
          [limit],
        )
      : [[]];
    const rows = interleaveTasks(profiles, articles, limit);
    for (const row of rows) {
      if (Date.now() >= deadline || options.signal?.aborted) {
        result.truncated = true;
        break;
      }
      await assert();
      let evidence = `Name/title: ${row.title}\n${plain(row.body_text || row.summary || '')}`;
      let coverage = row.body_text ? 'article-body' : 'rss-summary';
      if (row.entity_type === 'blog') {
        const [posts] = await pool.query<RowDataPacket[]>(
          'SELECT title,summary FROM posts WHERE blog_id=? ORDER BY published_at DESC LIMIT 5',
          [row.id],
        );
        evidence += `\nRecent posts:\n${posts.map((p) => `${p.title}: ${plain(p.summary || '').slice(0, 800)}`).join('\n')}`;
        coverage = 'blog-and-rss-summary';
      }
      const output = await infer(
        pool,
        row.entity_type === 'blog' ? 'profile' : 'topics',
        row.entity_type,
        row.id,
        evidence,
        coverage,
        options,
      );
      if (output.status === 'ok') result.processed++;
      else result.skipped++;
    }
    return result;
  });
  return work || { ...result, skipped: 1 };
}
