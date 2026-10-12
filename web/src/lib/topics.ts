export type VocabularyStatus = {
  status: 'unavailable' | 'ready';
  source: string;
  version: string | null;
  coverage: 'observed-article-window' | 'all-current-indexed-article-tags' | null;
  syncedAt: string | null;
  window?: { since: string; until: string } | null;
};
export type Topic = { id: string; label: string; source: 'rss-category' | 'tag-vocabulary'; score: number; posts: number; blogs: number };
export type Topics = {
  days: number;
  vocabulary: VocabularyStatus;
  coverage?: { datedPosts: number; unknownDatePosts: number; bodyObservedPosts: number; matchedPosts: number; cappedPosts: number };
  items: Topic[];
  minimumBlogs: number;
  limit: number;
  truncated: boolean;
};
