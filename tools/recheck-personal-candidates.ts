/** Target the old identity false-negative backlog. Dry-run unless --apply; preserve every human decision. */
import type { RowDataPacket } from 'mysql2/promise';
import { loadConfig } from '../app/src/config.js';
import { runCandidateReviewBatch } from '../app/src/crawl/candidate-review.ts';
import { CANDIDATE_POLICY } from '../app/src/crawl/candidate-validation.ts';
import { createDb } from '../app/src/db/client.ts';

const args = process.argv.slice(2);
const limitAt = args.indexOf('--limit');
const limit = limitAt < 0 ? 25 : Number(args[limitAt + 1]);
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) throw Error('invalid_limit');
const config = loadConfig();
const db = createDb(config.blogDbUrl, { poolSize: 2 });
try {
  const [rows] = await db.pool.query<RowDataPacket[]>(
    `SELECT d.id FROM discovery_candidates d WHERE d.status='candidate'
     AND JSON_UNQUOTE(JSON_EXTRACT(d.source_evidence,'$.automaticReview.reason'))
       IN ('personal_identity_uncertain','identity_not_confirmed','feed_name_identity_mismatch','missing_identity_name')
     AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(d.source_evidence,'$.automaticReview.policy')),'') <> ?
     AND NOT EXISTS(SELECT 1 FROM discovery_candidate_audits a WHERE a.candidate_id=d.id AND
       (a.source_type IN ('manual','human-review','admin') OR a.source_actor_id IS NOT NULL))
     ORDER BY d.id LIMIT ?`,
    [CANDIDATE_POLICY, limit],
  );
  console.log(
    JSON.stringify(
      rows.length
        ? await runCandidateReviewBatch(db.pool, {
            ids: rows.map((r) => Number(r.id)),
            apply: args.includes('--apply'),
            limit,
            maxDurationMs: 600000,
            userAgent: config.crawlUserAgent,
            delayMs: config.crawlDelayMs,
            timeoutMs: 6000,
          })
        : { selected: 0, processed: 0 },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
