import { publicSummary } from '../public-post.ts';
import type { RelationDTO, RelationEdge } from '../relations/routes.ts';
import { iso } from './data.ts';

// One public allowlist also protects against future fields added to internal projections.
const edge = (e: RelationEdge) => ({
  sourceBlogId: e.sourceBlogId,
  targetBlogId: e.targetBlogId,
  count: e.count,
  share: e.share,
  firstMentionAt: iso(e.firstMentionAt),
  lastMentionAt: iso(e.lastMentionAt),
  mutual: e.mutual,
});
export function relationsDto(
  dto: RelationDTO & { blogId?: number; evidence?: Record<string, unknown>[]; profileTruncated?: boolean },
  hours: number,
) {
  const edges = dto.edges.slice(0, 500).map(edge),
    c = dto.coverage;
  const result = {
    hours,
    days: hours / 24,
    generatedAt: dto.generatedAt,
    nodes: dto.nodes.map((n) => ({ id: n.id, slug: n.slug, name: n.name, iconUrl: n.iconUrl })),
    edges,
    mostMentioned: dto.mostMentioned.slice(0, 100).map((r) => ({ blogId: r.blogId, mentions: r.mentions, incomingBlogs: r.incomingBlogs })),
    mutual: dto.mutual.slice(0, 100).map((r) => ({
      sourceBlogId: r.sourceBlogId,
      targetBlogId: r.targetBlogId,
      forwardCount: r.forwardCount,
      reverseCount: r.reverseCount,
    })),
    coverage: {
      observedPosts: c.observedPosts,
      totalPosts: c.totalPosts,
      failedPosts: c.failedPosts,
      noBodyPosts: c.noBodyPosts,
      unknownDatePosts: c.unknownDatePosts,
      unresolvedLinks: c.unresolvedLinks,
      truncatedPosts: c.truncatedPosts,
      graphTruncated: c.graphTruncated || dto.edges.length > 500,
      aggregationTruncated: c.aggregationTruncated,
      sampledAt: iso(c.sampledAt),
      method: c.method,
      nonBodyLinks: { sidebar: c.nonBodyLinks.sidebar, blogroll: c.nonBodyLinks.blogroll, comment: c.nonBodyLinks.comment },
    },
  };
  if (dto.blogId === undefined) return result;
  return {
    ...result,
    blogId: dto.blogId,
    outgoing: edges.filter((e) => e.sourceBlogId === dto.blogId),
    incoming: edges.filter((e) => e.targetBlogId === dto.blogId),
    profileTruncated: !!dto.profileTruncated || dto.edges.length > 500,
    evidence: (dto.evidence ?? []).slice(0, 20).map((r) => ({
      postId: r.postId,
      postTitle: r.postTitle,
      postUrl: r.postUrl,
      targetUrl: r.targetUrl,
      anchor: publicSummary(r.anchor, 200),
      publishedAt: iso(r.publishedAt),
      sourceBlogId: r.sourceBlogId,
      targetBlogId: r.targetBlogId,
      location: r.location,
    })),
  };
}
