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
