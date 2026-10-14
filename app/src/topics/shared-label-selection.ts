import type { Pool, RowDataPacket } from 'mysql2/promise';
import { runTechRead } from '../tech/read-resource.ts';
import { historyPublicTopicSql } from './history-read.ts';

export const publicSharedLabelEvidenceSql = `EXISTS (
         SELECT 1 FROM topic_article_evidence e JOIN posts p ON p.id=e.post_id JOIN blogs b ON b.id=p.blog_id
         WHERE e.canonical_id=t.canonical_id AND e.state IN ('confirmed','pending') AND e.source IN ('title','body')
           AND b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())
       )`;

/** Background producer admission; upstream labels alone are never enough to authorize a topic. */
export async function isPublicSharedLabelTopic(pool: Pool, label: string): Promise<boolean> {
  if (!label || label !== label.trim() || [...label].length > 60 || /[\p{Cc}\p{Cs}]/u.test(label)) return false;
  return runTechRead(pool, async (readPool) => {
    const [rows] = await readPool.query<RowDataPacket[]>(
      `SELECT t.canonical_id FROM topic_pages t
       WHERE BINARY t.label=BINARY ? AND t.state IN ('active','pending') AND ${historyPublicTopicSql('t')}
       AND ${publicSharedLabelEvidenceSql}  LIMIT 1`,
      [label],
    );
    return rows.length > 0;
  });
}
