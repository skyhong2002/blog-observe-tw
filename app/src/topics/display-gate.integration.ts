/** Actual SQL oracle, run only through the existing disposable 18169 integration runner. */
import assert from 'node:assert/strict';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { windowGateCtes } from './display-gate.ts';

export async function runDisplayGateIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const cases = [];
  // Same six article hits, 3/2/1 across blogs; one title/body overlap.
  // Corpus sizes straddle the exact 2% threshold, using production gate SQL.
  for (const denominator of [301, 300, 299]) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `WITH RECURSIVE scoped_posts AS (SELECT 1 id UNION ALL SELECT id+1 FROM scoped_posts WHERE id<?),
      raw_evidence AS (
        SELECT 1 post_id,1 blog_id,'term' topic_id,1 title_hit UNION ALL
        SELECT 1,1,'term',0 UNION ALL SELECT 2,1,'term',0 UNION ALL SELECT 3,1,'term',0 UNION ALL
        SELECT 4,2,'term',1 UNION ALL SELECT 5,2,'term',0 UNION ALL SELECT 6,3,'term',0
      ), evidence AS (
        SELECT post_id,blog_id,topic_id,MAX(title_hit) title_hit FROM raw_evidence GROUP BY post_id,blog_id,topic_id
      ), ${windowGateCtes()}
      SELECT (SELECT COUNT(*) FROM evidence) matched,COUNT(*) recent,SUM(title_hit) title_posts FROM recent`,
      [denominator],
    );
    assert.equal(Number(rows[0].matched), 6, 'overlap must count one article before document frequency');
    assert.equal(Number(rows[0].recent), denominator < 300 ? 2 : 6, 'only strictly above threshold drops body evidence');
    assert.equal(Number(rows[0].title_posts), 2, 'title evidence remains');
    cases.push({ denominator, matched: 6, recent: Number(rows[0].recent), titlePosts: 2 });
  }
  return { cases, assertions: 9, actualSql: true, uiOrBuildClaim: false };
}
