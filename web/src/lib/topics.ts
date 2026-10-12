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
};
export type Topic = { id: string; label: string; source: 'rss-category' | 'tag-vocabulary'; score: number; posts: number; blogs: number };
/** /api/topics/:id — one topic's blogs and articles in a period. */
export type TopicDetail = {
  days: number;
  vocabulary: VocabularyStatus;
  topic: { id: string; label: string; source: string } | null;
  blogs: Array<{ id: number; slug: string; name: string; posts: number; score: number }>;
  articles: Array<{ id: number; title: string; url: string; publishedAt: string | null; blogSlug: string; blogName: string }>;
  truncated: boolean;
};
export type Topics = {
  days: number;
  vocabulary: VocabularyStatus;
  coverage?: { datedPosts: number; unknownDatePosts: number; bodyObservedPosts: number; matchedPosts: number; cappedPosts: number };
  items: Topic[];
  minimumBlogs: number;
  limit: number;
  truncated: boolean;
};
