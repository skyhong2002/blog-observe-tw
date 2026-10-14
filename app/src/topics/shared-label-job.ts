import type { Pool, RowDataPacket } from 'mysql2/promise';
import { historyPublicTopicSql } from './history-read.ts';
import { isPublicSharedLabelTopic, publicSharedLabelEvidenceSql } from './shared-label-selection.ts';
import { sharedLabelSyncClientFactory, syncSharedLabels } from './shared-label-sync.ts';

/** Same bounded producer selection used by the worker and isolated SQL tests. */
export async function selectSharedLabelCandidates(pool: Pool) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SET STATEMENT max_statement_time=1 FOR SELECT t.label FROM topic_pages t
       WHERE t.state IN ('active','pending') AND ${historyPublicTopicSql('t')}
       AND ${publicSharedLabelEvidenceSql}
       AND CHAR_LENGTH(t.label) BETWEEN 1 AND 60
       AND (NOT EXISTS (SELECT 1 FROM topic_shared_label_snapshots s
            WHERE s.label_hash=SHA2(t.label,256) AND s.kind='relations' AND BINARY s.exact_label=BINARY t.label
            AND s.status IN ('ready','missing') AND s.expires_at>DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))
         OR NOT EXISTS (SELECT 1 FROM topic_shared_label_snapshots s
            WHERE s.label_hash=SHA2(t.label,256) AND s.kind='visual' AND BINARY s.exact_label=BINARY t.label
            AND s.status IN ('ready','missing') AND s.expires_at>DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR)))
       ORDER BY COALESCE((SELECT MAX(attempt.fetched_at) FROM topic_shared_label_snapshots attempt
                 WHERE attempt.label_hash=SHA2(t.label,256) AND BINARY attempt.exact_label=BINARY t.label),FROM_UNIXTIME(0)),
                t.last_article_at DESC,t.canonical_id LIMIT 10`,
  );
  return [...new Set(rows.map((row) => String(row.label)))];
}

/** Refresh only public blog topics with missing/expiring metadata, never the entire tag vocabulary. */
export async function runSharedLabelBatch(pool: Pool) {
  if (process.env.BLOG_SHARED_LABEL_SYNC_ENABLED !== 'true') return { mode: 'disabled' as const };
  const selection = await selectSharedLabelCandidates(pool);
  return syncSharedLabels(
    pool,
    selection,
    {
      validatePublicLabel: (label) => isPublicSharedLabelTopic(pool, label),
      makeClient: sharedLabelSyncClientFactory(fetch),
    },
    { apply: true, enabled: true, dailyLimit: 40 },
  );
}
