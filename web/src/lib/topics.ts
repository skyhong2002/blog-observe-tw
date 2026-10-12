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
  /** Terms in the whole source vocabulary (kept in full, matched or not); null/absent when not recorded. */
  totalSourceTerms?: number | null;
  /** The subset of eligible terms the matcher indexes; null/absent on gateways or snapshots without one. */
  activeSet?: ActiveSet | null;
  /** Long-term document-frequency baseline; null/absent before the first run or on older gateways. */
  frequencyBaseline?: FrequencyBaseline | null;
};
/** Denominator for the high-frequency rule: posts in [since, until]; coveredPosts of them matched by the current matcher. */
export type FrequencyBaseline = {
  since: string;
  until: string;
  totalPosts: number;
  coveredPosts: number;
  thresholdRatio: number;
  version: string;
};
/** Bounded matching set chosen from the kept vocabulary at `asOf`; terms left out stay queryable. */
export type ActiveSet = {
  status: string;
  version: string | null;
  asOf: string | null;
  eligibleTerms: number;
  activeTerms: number;
  termLimit: number;
  codePointLimit: number;
  memoryBudgetBytes: number;
  estimatedBytes: number;
  /** Terms kept but not indexed, by reason code, e.g. { 'low-frequency': 120 }. */
  inactiveReasons: Record<string, number>;
};
/** Response metadata: how article evidence is weighted. */
export type MatchingPolicy = {
  version: string;
  policyVersion: string;
  titleWeight: number;
  bodyWeight: number;
  sameBlogDecay: number;
  sources: string[];
  /** Hours of recent articles re-matched first when new terms arrive; absent on older gateways. */
  recentBackfillHours?: number;
  frequency?: { baselineDays: number; highFrequencyRatio: number; reason: string; version: string };
};
export type MatchingRule = 'title-only' | 'title-and-body';
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
  /** Share of period articles matching the term; for title-only terms both shares count titles only. */
  recentShare?: number | null;
  baselineShare?: number | null;
  /** recentShare ÷ baselineShare; null when there is no baseline (never 0 for "unknown"). */
  lift?: number | null;
  matchingRule?: MatchingRule;
  matchingReason?: string | null;
};
/** /api/topics/:id — one topic's blogs and articles in a period. */
export type TopicDetail = {
  days: number;
  vocabulary: VocabularyStatus;
  matchingPolicy?: MatchingPolicy;
  /** `id` is the requested id (an alias stays as asked); canonicalId is the merged tag:… row, null when there is none. */
  topic: {
    id: string;
    label: string;
    source: string;
    canonicalId?: string | null;
    excludedReason?: string | null;
    /** Valid and kept, but outside the active matching set (see inactiveReasonLabel); not noise. */
    inactiveReason?: string | null;
    matchingStatus?: 'active' | 'inactive' | 'excluded';
    articleCount?: number | null;
    lastPublishedAt?: string | null;
    matchingRule?: MatchingRule;
    matchingReason?: string | null;
  } | null;
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
  'upstream-no-equal': '來源標示不參與比對',
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

/** Not noise: a valid term left out of this round's active matching set. */
const inactiveLabels: Record<string, string> = {
  'low-frequency': '文章數較少且最近 180 天未觀測到發文',
  'memory-budget': '超出本次比對容量',
};
export const inactiveReasonLabel = (reason: string) => inactiveLabels[reason] ?? `其他暫停比對原因（${reason}）`;

/** Why an active term counts differently in the ranking; not an exclusion. */
const matchingReasonLabels: Record<string, string> = {
  'high-document-frequency-title-only': '高頻詞，只計標題命中',
};
export const matchingReasonLabel = (reason: string) => matchingReasonLabels[reason] ?? `其他比對規則（${reason}）`;

/** Ratio as a percentage without trailing zeros, e.g. 0.02 → 2%; — when not recorded. */
export function formatPercent(ratio: number | null | undefined) {
  const n = recorded(ratio);
  return n === null ? '—' : `${(n * 100).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}%`;
}

/** Lift as "1.25×"; null/absent means no baseline yet, not zero. */
export function formatLift(lift: number | null | undefined) {
  const n = recorded(lift);
  return n === null ? '尚無基準' : `${n.toFixed(2)}×`;
}

/** Tooltip for the lift column: what the ratio is and what it is not. */
export function liftExplanation(baselineDays = 365) {
  return (
    `升溫倍率＝近期文章占比 ÷ ${baselineDays} 日基準占比；高頻詞的分子分母都只計標題命中。` +
    '這是發文比例的比較，不是瀏覽流量，也不是成長百分比。'
  );
}

/** Reasons with a positive count, most frequent first. */
export function exclusionRows(
  reasons: Record<string, number> | null | undefined,
  label: (reason: string) => string = exclusionReasonLabel,
) {
  return Object.entries(reasons ?? {})
    .filter(([, count]) => typeof count === 'number' && Number.isFinite(count) && count > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([reason, count]) => ({ reason, label: label(reason), count }));
}
export const inactiveRows = (reasons: Record<string, number> | null | undefined) => exclusionRows(reasons, inactiveReasonLabel);

/** null/absent means the payload predates the field: callers say so instead of showing 0. */
export const recorded = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Memory estimate in MiB/KiB/B; — when not recorded. */
export function formatBytes(bytes: number | null | undefined) {
  const n = recorded(bytes);
  if (n === null || n < 0) return '—';
  const fmt = (v: number) => v.toLocaleString('zh-TW', { maximumFractionDigits: 1 });
  if (n >= 1024 ** 2) return `${fmt(n / 1024 ** 2)} MiB`;
  if (n >= 1024) return `${fmt(n / 1024)} KiB`;
  return `${n.toLocaleString('zh-TW')} B`;
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
