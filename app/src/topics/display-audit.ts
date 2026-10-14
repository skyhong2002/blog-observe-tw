import type { Pool, RowDataPacket } from 'mysql2/promise';
import {
  backgroundExcludedSql,
  DISPLAY_GATE,
  nativeLabelConsensusSql,
  nativeLabelCte,
  nativeLabelJoin,
  windowGateSql,
} from './display-gate.ts';
import { FREQUENCY_POLICY } from './frequency.ts';
import { evidence } from './routes.ts';
import { SOURCE } from './snapshot-client.ts';

/** Read-only, on-demand audit of a single canonical term using the ranking's exact visibility/quality rules. */
export async function auditTopicDisplay(pool: Pool, topicId: string, days: number, now = new Date()) {
  if (!/^tag:[a-f0-9]{64}$/.test(topicId) || ![7, 30, 90].includes(days) || !Number.isFinite(now.getTime()))
    throw Error('invalid_topic_display_audit');
  const [rows] = await pool.query<RowDataPacket[]>(
    `SET STATEMENT max_statement_time=5 FOR WITH ${evidence(false, true, true)}, ${nativeLabelCte}
    SELECT (SELECT COUNT(*) FROM scoped_posts) publicPosts,
      MAX(e.label) label,COUNT(e.post_id) evidencePosts,COALESCE(SUM(e.title_hit),0) titlePosts,
      COUNT(DISTINCT e.blog_id) sourceBlogs,COALESCE(MAX(${windowGateSql()}),0) titleOnly,
      COALESCE(MAX(wf.twice_sources),0) twiceSources,COALESCE(MAX(wf.peak_posts),0) peakPosts,
      COALESCE(MAX(${backgroundExcludedSql}),0) backgroundExcluded,
      COALESCE(MAX(${nativeLabelConsensusSql}),0) nativeConsensus
    FROM evidence e LEFT JOIN window_frequencies wf ON wf.topic_id=e.topic_id
    LEFT JOIN topic_current tc ON tc.source=?
    LEFT JOIN topic_frequency_runs fr ON fr.snapshot_id=tc.snapshot_id AND fr.policy_version=?
    LEFT JOIN topic_term_frequencies f ON f.snapshot_id=fr.snapshot_id AND f.term_id=SUBSTRING(e.topic_id,5)
    LEFT JOIN topic_canonical_terms_v3 display_term ON display_term.snapshot_id=tc.snapshot_id AND display_term.id=SUBSTRING(e.topic_id,5)
    ${nativeLabelJoin}
    WHERE e.topic_id=?`,
    [new Date(now.getTime() - days * 86400_000), now, SOURCE, FREQUENCY_POLICY.version, topicId],
  );
  const row = rows[0],
    titleOnly = Number(row.titleOnly) === 1;
  const matched = Number(row.evidencePosts),
    titles = Number(row.titlePosts),
    denominator = Number(row.publicPosts);
  return {
    topicId,
    label: row.label ?? null,
    days,
    observedAt: now.toISOString(),
    sourcePoolRetained: true,
    historicalEvidenceRetained: true,
    displayGate: DISPLAY_GATE,
    publicPosts: denominator,
    evidencePosts: matched,
    titlePosts: titles,
    bodyOnlyPosts: matched - titles,
    sourceBlogs: Number(row.sourceBlogs),
    twiceSources: Number(row.twiceSources),
    peakPosts: Number(row.peakPosts),
    documentFrequency: denominator > 0 ? matched / denominator : null,
    titleOnly,
    backgroundExcluded: Number(row.backgroundExcluded) === 1,
    nativeLabelConsensus: Number(row.nativeConsensus) === 1,
    eligibleRankingPosts: Number(row.backgroundExcluded) === 1 ? 0 : titleOnly ? titles : matched,
    reason: !matched
      ? 'no-public-ranking-evidence'
      : Number(row.backgroundExcluded) === 1
        ? DISPLAY_GATE.background.reason
        : titleOnly
          ? DISPLAY_GATE.reason
          : null,
  };
}
