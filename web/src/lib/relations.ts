/** How RelationEdge.share is computed; shown wherever the percentage appears. */
export const shareLabel = '引用占比';
export const shareExplanation =
  '引用占比的分母是「提及方」對所有已收錄部落格的「文章×目標站」組數：一篇文章提到三個站算 3 組，同一篇對同一站重複連結只算 1 組，無法辨識目標的連結不列入。分子是其中指向這個站的組數。它不是目標站全部文章的比例，也不是造訪比例。';
export const sharePercent = (share: number) => `${(share * 100).toFixed(1)}%`;

export type RelationNode = { id: number; slug: string; name: string; iconUrl?: string | null };
export type RelationEdge = {
  sourceBlogId: number;
  targetBlogId: number;
  count: number;
  share: number;
  firstMentionAt: string | null;
  lastMentionAt: string | null;
  mutual: boolean;
};
export type Relations = {
  days: number;
  generatedAt: string;
  nodes: RelationNode[];
  edges: RelationEdge[];
  mostMentioned: Array<{ blogId: number; mentions: number; incomingBlogs: number }>;
  mutual: Array<{ sourceBlogId: number; targetBlogId: number; forwardCount: number; reverseCount: number }>;
  coverage: {
    observedPosts: number;
    totalPosts: number;
    failedPosts: number;
    unknownDatePosts: number;
    unresolvedLinks: number;
    truncatedPosts: number;
    graphTruncated: boolean;
    aggregationTruncated: boolean;
    noBodyPosts: number;
    nonBodyLinks: { sidebar: number; blogroll: number; comment: number };
  };
  profileTruncated?: boolean;
  blogId?: number;
  outgoing?: RelationEdge[];
  incoming?: RelationEdge[];
  evidence?: Array<{ postTitle: string; postUrl: string; targetUrl: string; anchor: string; publishedAt: string | null }>;
};
