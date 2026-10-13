/** How RelationEdge.share is computed; shown wherever the percentage appears. */
export const shareLabel = '引用占比';
export const shareExplanation =
  '引用占比的分母是「提及方」對所有已收錄部落格的「文章×目標站」組數：一篇文章提到三個站算 3 組，同一篇對同一站重複連結只算 1 組，無法辨識目標的連結不列入。分子是其中指向這個站的組數。它不是目標站全部文章的比例，也不是造訪比例。';
export const sharePercent = (share: number) => `${(share * 100).toFixed(1)}%`;

/** canonicalPath / *BlogCanonicalPath: optional readable blog pages (page-links.ts); ids and slugs stay the API keys. */
export type RelationNode = { id: number; slug: string; name: string; iconUrl?: string | null; canonicalPath?: string };
export type RelationEdge = {
  sourceBlogId: number;
  targetBlogId: number;
  sourceBlogCanonicalPath?: string;
  targetBlogCanonicalPath?: string;
  count: number;
  share: number;
  firstMentionAt: string | null;
  lastMentionAt: string | null;
  mutual: boolean;
};
/**
 * One observed link (app/src/relations/routes.ts projectEvidence). Older gateways sent only the first five keys,
 * so everything after them is optional here and shown as 未提供, never guessed. anchor is NOT NULL in the
 * database; null is still accepted (public-contracts.ts) and shown as 原始連結.
 */
export type RelationEvidence = {
  postTitle: string;
  postUrl: string;
  targetUrl: string;
  anchor: string | null;
  publishedAt: string | null;
  postId?: number;
  sourceBlogId?: number;
  targetBlogId?: number | null;
  location?: string | null;
  context?: string | null;
  observedAt?: string | null;
  matchVersion?: string | null;
  evidenceType?: string;
  contextSource?: string | null;
};
/**
 * app/src/relations/shared-tags.ts SharedTagHit: the publishers' own article tags, not the site's tag vocabulary.
 * targetBlogSlug and the tag provenance keys are newer than the hit: optional, as in public-contracts.ts.
 */
export type SharedTagHit = {
  sourceArticleId: number;
  sourceArticleUrl: string;
  sourceArticleTitle: string;
  sourceArticlePublishedAt: string;
  targetArticleId: number;
  targetArticleUrl: string;
  targetArticleTitle: string;
  targetArticlePublishedAt: string;
  targetBlogId: number;
  targetBlogSlug?: string;
  targetBlogName: string;
  tagId: number;
  label: string;
  sourceType?: string;
  lastSeenAt?: string;
  targetSourceType?: string;
  targetLastSeenAt?: string;
  tagSourceType?: string;
  tagLastSeenAt?: string;
  matchVersion: string;
};
export type SharedTags =
  | { status: 'not-enabled' }
  | { status: 'unavailable'; matchVersion: string }
  | {
      status: 'ready';
      days: number;
      items: SharedTagHit[];
      truncated: boolean;
      sourceTagsTruncated: boolean;
      matchVersion: string;
      interpretation: string;
    };
export type TextSimilarity = { status: 'not-analysed' } | { status: string };
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
  // Profile-only keys. Absent on older gateways: the section says 未提供 instead of an empty success.
  evidence?: RelationEvidence[];
  evidenceTruncated?: boolean;
  nonBodyEvidence?: RelationEvidence[];
  nonBodyEvidenceTruncated?: boolean;
  sharedTags?: SharedTags;
  textSimilarity?: TextSimilarity;
};

export const MISSING = '未提供';
/** A count as the gateway sent it; a missing or malformed one is 未提供, never 0. */
export const countText = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('zh-TW') : MISSING;
/** A date (Asia/Taipei) or `fallback` when the value is missing or unreadable. */
export function dayText(value: string | null | undefined, fallback = '日期未知') {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }) : fallback;
}
/** Where on the source page a link sat (relation_links.location). */
export const locationText: Record<string, string> = { body: '正文', blogroll: 'Blogroll', sidebar: '側欄', comment: '留言' };
export const locationOf = (value: string | null | undefined) => (value ? (locationText[value] ?? value) : MISSING);
/** Only http(s) links leave the page; anything else is shown as text. */
export function externalHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}
/** The shared-tag hits under each tag, in the gateway's order; nothing is counted or merged across tags. */
export function hitsByTag(items: SharedTagHit[]) {
  const groups = new Map<number, { tagId: number; label: string; hits: SharedTagHit[] }>();
  for (const hit of items) {
    const group = groups.get(hit.tagId) ?? { tagId: hit.tagId, label: hit.label, hits: [] };
    group.hits.push(hit);
    groups.set(hit.tagId, group);
  }
  return [...groups.values()];
}
