// Cross-source thresholds ported from tag.observe.tw app/src/jobs/tag-qualification.ts
// at afe0a653fa8aae7e25a04a1d9fe87bf0400a2a39. No term blacklist or separate dictionary.
import { FREQUENCY_POLICY } from './frequency.ts';

export const DISPLAY_GATE = Object.freeze({
  version: 'tag-broad-window-title-only-v1',
  upstream: 'tag.observe.tw/qualifyTagMedia/broad',
  minimumSources: 3,
  minimumTwiceSources: 2,
  minimumPeakPosts: 3,
  documentFrequencyRatio: FREQUENCY_POLICY.highFrequencyRatio,
  reason: 'high-window-document-frequency-title-only',
  effect: 'ranking-body-evidence-only; source-pool-and-historical-pages-retained',
});

/** The exact tag early/broad qualification on article counts, applied to blog sources. */
export function qualifyTopicSources(countsByBlog: Record<string, number>) {
  const counts = Object.values(countsByBlog).filter((n) => Number.isFinite(n) && n > 0);
  const twice = counts.filter((n) => n >= 2).length;
  return { early: twice >= 2, broad: counts.length >= 3 && twice >= 2 && counts.some((n) => n >= 3) };
}

export function windowTitleOnly(countsByBlog: Record<string, number>, observedPosts: number) {
  return (
    observedPosts > 0 &&
    qualifyTopicSources(countsByBlog).broad &&
    Object.values(countsByBlog)
      .filter((n) => Number.isFinite(n) && n > 0)
      .reduce((sum, n) => sum + n, 0) /
      observedPosts >
      DISPLAY_GATE.documentFrequencyRatio
  );
}

/** SQL identifiers are constant caller-owned aliases, never user labels or parameters. */
export function windowGateSql(alias = 'wf') {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw Error('invalid_window_gate_alias');
  return `(${alias}.blogs>=${DISPLAY_GATE.minimumSources} AND ${alias}.twice_sources>=${DISPLAY_GATE.minimumTwiceSources}
    AND ${alias}.peak_posts>=${DISPLAY_GATE.minimumPeakPosts}
    AND ${alias}.matched_posts>(SELECT COUNT(*) FROM scoped_posts)*${DISPLAY_GATE.documentFrequencyRatio})`;
}

export const windowGateCtes = () => `window_blog_counts AS (
 SELECT topic_id,blog_id,COUNT(*) n FROM evidence GROUP BY topic_id,blog_id
), window_frequencies AS (
 SELECT topic_id,SUM(n) matched_posts,COUNT(*) blogs,SUM(n>=2) twice_sources,MAX(n) peak_posts
 FROM window_blog_counts GROUP BY topic_id
), recent AS (
 SELECT e.* FROM evidence e JOIN window_frequencies wf ON wf.topic_id=e.topic_id
 WHERE e.title_hit=1 OR NOT ${windowGateSql()}
)`;
