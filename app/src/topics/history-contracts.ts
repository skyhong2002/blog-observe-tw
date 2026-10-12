/** Durable SEO history is independent of the rolling vocabulary pointer. */
export type HistoryTopicState = 'active' | 'pending' | 'revoked' | 'merged';
export type HistoryEvidenceState = 'confirmed' | 'pending' | 'revoked';
export type HistoryEvidenceSource = 'title' | 'body';
export const historyReadsEnabled = () => process.env.BLOG_TOPIC_HISTORY_READ_ENABLED === 'true';
export const historyWritesEnabled = () => process.env.BLOG_TOPIC_HISTORY_WRITE_ENABLED === 'true';
export type HistoryRecordInput = {
  snapshotId: string;
  postId: number;
  postHash: string | null;
  bodyHash: string | null;
  matchedAt: Date;
  records: { termId: string; source: HistoryEvidenceSource }[];
  /** Never infer negatives from a capped/failed match or unavailable body. */
  complete: boolean;
  bodyCovered: boolean;
};
export type HistoryArticle = {
  id: number;
  title: string;
  url: string;
  publishedAt: string | null;
  blogSlug: string;
  blogName: string;
  blogCanonicalPath?: string;
  evidenceState: 'confirmed' | 'pending';
  observedAt: string;
};
export type TopicHistory = {
  articles: HistoryArticle[];
  nextCursor: string | null;
  confirmed: number;
  pending: number;
  lastObservedAt: string | null;
  /** Counts are distinct public articles, not edge rows. */
  total: number;
};
