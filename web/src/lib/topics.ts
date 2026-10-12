export type VocabularyStatus = {
  status: 'unavailable' | 'ready';
  source: string;
  version: string | null;
  coverage: 'observed-article-window' | 'all-current-indexed-article-tags' | null;
  syncedAt: string | null;
  window?: { since: string; until: string } | null;
  /** Upstream tags skipped as malformed in this snapshot; null/absent on snapshots taken before it was recorded. */
  invalidTagCount?: number | null;
  /** Tags kept after normalisation (e.g. trimmed edges); null/absent when not recorded. */
  normalizedTagCount?: number | null;
  /** Normalisation rule applied to upstream tags, e.g. 'boundary-whitespace-v1'; null/absent when not recorded. */
  tagNormalization?: string | null;
  /** Valid terms kept in the snapshot but left out of matching (separate from invalidTagCount); absent on older gateways. */
  excludedTermCount?: number;
  /** excludedTermCount by reason code, e.g. { 'pure-number': 3 }. */
  exclusionReasons?: Record<string, number>;
};
/** Response metadata: how article evidence is weighted. */
export type MatchingPolicy = {
  version: string;
  policyVersion: string;
  titleWeight: number;
  bodyWeight: number;
  sameBlogDecay: number;
  sources: string[];
};
export type Topic = {
  id: string;
  label: string;
  source: 'rss-category' | 'tag-vocabulary';
  score: number;
  posts: number;
  blogs: number;
  /** Articles matched in the title / only in the cleaned body; absent on older gateways. */
  titlePosts?: number;
  bodyOnlyPosts?: number;
};
/** /api/topics/:id — one topic's blogs and articles in a period. */
export type TopicDetail = {
  days: number;
  vocabulary: VocabularyStatus;
  matchingPolicy?: MatchingPolicy;
  /** `id` is the requested id (an alias stays as asked); canonicalId is the merged tag:… row, null when there is none. */
  topic: { id: string; label: string; source: string; canonicalId?: string | null; excludedReason?: string | null } | null;
  blogs: Array<{ id: number; slug: string; name: string; posts: number; score: number; titlePosts?: number; bodyOnlyPosts?: number }>;
  articles: Array<{ id: number; title: string; url: string; publishedAt: string | null; blogSlug: string; blogName: string }>;
  truncated: boolean;
};
export type Topics = {
  days: number;
  vocabulary: VocabularyStatus;
  matchingPolicy?: MatchingPolicy;
  coverage?: { datedPosts: number; unknownDatePosts: number; bodyObservedPosts: number; matchedPosts: number; cappedPosts: number };
  items: Topic[];
  minimumBlogs: number;
  limit: number;
  truncated: boolean;
};

const exclusionLabels: Record<string, string> = {
  'upstream-noise': '上游標記為雜訊',
  'tag-noise': '常見雜訊詞',
  'too-short': '單一字元',
  'invalid-label': '格式不適合比對',
  'pure-number': '純數字',
  'pure-date': '純日期',
  'no-equal': '沿用來源排除清單',
  'not-in-tag-vocabulary': '不在共同關鍵字詞庫',
};
/** Chinese label for an exclusion reason code; an unknown code stays visible next to a generic label. */
export const exclusionReasonLabel = (reason: string) => exclusionLabels[reason] ?? `其他排除規則（${reason}）`;

/** Reasons with a positive count, most frequent first. */
export function exclusionRows(reasons: Record<string, number> | undefined) {
  return Object.entries(reasons ?? {})
    .filter(([, count]) => typeof count === 'number' && Number.isFinite(count) && count > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([reason, count]) => ({ reason, label: exclusionReasonLabel(reason), count }));
}

type Weights = Pick<MatchingPolicy, 'titleWeight' | 'bodyWeight' | 'sameBlogDecay'>;
/** The gateway's policy, used when an older payload has no matchingPolicy. */
export const DEFAULT_MATCHING_POLICY: Weights = { titleWeight: 2, bodyWeight: 1, sameBlogDecay: 0.5 };

/**
 * One blog's contribution to a topic: each article counts once (title weight if its title matched,
 * else body weight), heaviest first, each later article multiplied by the decay once more.
 */
export function blogContribution(titlePosts: number, bodyOnlyPosts: number, policy: Weights = DEFAULT_MATCHING_POLICY) {
  const weights = [...Array<number>(titlePosts).fill(policy.titleWeight), ...Array<number>(bodyOnlyPosts).fill(policy.bodyWeight)];
  return weights.sort((a, b) => b - a).reduce((sum, weight, i) => sum + weight * policy.sameBlogDecay ** i, 0);
}

/** "title / body-only" article counts, or — when an older gateway did not send them. */
export function matchSplit(row: { titlePosts?: number; bodyOnlyPosts?: number }) {
  const { titlePosts: t, bodyOnlyPosts: b } = row;
  return typeof t === 'number' && typeof b === 'number' ? `${t.toLocaleString('zh-TW')} / ${b.toLocaleString('zh-TW')}` : '—';
}

/** Plain-language weighting rule, with a worked example computed from the policy itself. */
export function matchingPolicyText(policy: Weights = DEFAULT_MATCHING_POLICY) {
  const { titleWeight: t, bodyWeight: b, sameBlogDecay: d } = policy;
  return (
    `只比對文章標題與清理後的正文，不含訂閱摘要、分類與版型區塊。每篇文章只算一次：標題出現記 ${t}，僅正文出現記 ${b}；` +
    `同一部落格的文章由高到低排列，之後每篇再乘 ${d}。例如同站 2 篇標題、1 篇僅正文合計 ${blogContribution(2, 1, policy)}。`
  );
}
