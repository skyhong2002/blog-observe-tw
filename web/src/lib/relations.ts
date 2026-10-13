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
/** The raw key as sent; read it only through parseTextSimilarity. Older gateways send { status: 'not-analysed' }. */
export type TextSimilarity = { status: 'not-analysed' } | { status: string };

/* Text similarity (app/src/relations/text-similarity-profile.ts, text-similarity-reader.ts) ------------------- */

/** The profile compares at most this many pairs (PROFILE_SIMILARITY_PAIRS); more rows are not shown. */
export const SIMILARITY_PAIRS_MAX = 3;
const SIMILARITY_REASONS = ['evidence-unavailable', 'overcap', 'invalid-utf8', 'stale-or-unavailable', 'same-publication'] as const;
export type SimilarityReason = (typeof SIMILARITY_REASONS)[number];
/** One article of a compared pair: public fields only. The preview is the post's public summary, never body text. */
export type SimilaritySide = {
  articleId: number;
  title: string | null;
  url: string | null;
  publishedAt: string | null;
  observedAt: string | null;
  excerpt: string | null;
  prefixCodepoints: number | null;
  truncated: boolean | null;
};
export type SimilarityItem =
  | {
      status: 'ready';
      sourceArticleId: number;
      targetArticleId: number;
      lexicalSimilarity: number;
      matchVersion: string | null;
      source: SimilaritySide;
      target: SimilaritySide;
    }
  | {
      status: 'insufficient-text';
      sourceArticleId: number;
      targetArticleId: number;
      matchVersion: string | null;
      source: SimilaritySide | null;
      target: SimilaritySide | null;
    }
  /** No score and no preview: a withdrawn or changed article must not be shown from a stale read. */
  | { status: 'unavailable'; sourceArticleId: number; targetArticleId: number; reason: SimilarityReason | null };
/** How the pairs were picked; null is 未提供. exhaustive is never repeated as true. */
export type SimilaritySelection = {
  selectionOrigin: 'observed-outgoing-body-links' | null;
  selectionLimit: number | null;
  selectedPairs: number | null;
  selectionTruncated: boolean | null;
};
export type TextSimilarityView =
  | { status: 'missing' }
  | { status: 'not-analysed' }
  | { status: 'not-enabled' }
  | { status: 'no-selected-pairs'; selection: SimilaritySelection }
  | { status: 'unavailable'; selection: SimilaritySelection }
  | { status: 'ready'; selection: SimilaritySelection; matchVersion: string | null; items: SimilarityItem[]; omittedItems: number };

const plainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const articleId = (value: unknown) => (Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null);
const versionLabel = (value: unknown) => (typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) ? value : null);
const dateValue = (value: unknown) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null);
/** Plain text cut to `max` code points; anything that is not a string is not provided. */
const boundedText = (value: unknown, max: number) => {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!text) return null;
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
};

/**
 * A compared article's original link: http(s) with no username or password, kept exactly as sent (its query is part
 * of the article address). Anything else is null and the title stays plain text. Stricter than externalHref, which
 * the citation and shared-tag rows keep using unchanged.
 */
export function similarityHref(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
}

function sideOf(value: unknown, expectedId: number): SimilaritySide | null {
  // The preview must be the public summary and the comparison the private body prefix, as the reader says.
  if (
    !plainRecord(value) ||
    articleId(value.articleId) !== expectedId ||
    value.contextSource !== 'post-summary' ||
    value.comparedContextSource !== 'body-prefix'
  )
    return null;
  const prefix = articleId(value.prefixCodepoints);
  return {
    articleId: expectedId,
    title: boundedText(value.title, 160),
    url: similarityHref(value.url),
    publishedAt: dateValue(value.publishedAt),
    observedAt: dateValue(value.observedAt),
    excerpt: boundedText(value.excerpt, 240),
    prefixCodepoints: prefix !== null && prefix <= 4096 ? prefix : null,
    truncated: typeof value.truncated === 'boolean' ? value.truncated : null,
  };
}

function itemOf(value: unknown): SimilarityItem | null {
  if (!plainRecord(value)) return null;
  const sourceArticleId = articleId(value.sourceArticleId),
    targetArticleId = articleId(value.targetArticleId);
  if (sourceArticleId === null || targetArticleId === null || sourceArticleId === targetArticleId) return null;
  const unavailable = (reason: unknown): SimilarityItem => ({
    status: 'unavailable',
    sourceArticleId,
    targetArticleId,
    reason: SIMILARITY_REASONS.find((known) => known === reason) ?? null,
  });
  const matchVersion = versionLabel(value.matchVersion);
  if (value.status === 'ready') {
    const source = sideOf(value.source, sourceArticleId),
      target = sideOf(value.target, targetArticleId);
    const score = value.lexicalSimilarity;
    // A score is shown only with both public sides and a ratio in [0, 1]; anything else reads as unavailable.
    if (!source || !target || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) return unavailable(null);
    return { status: 'ready', sourceArticleId, targetArticleId, lexicalSimilarity: score, matchVersion, source, target };
  }
  if (value.status === 'insufficient-text') {
    if (value.lexicalSimilarity !== null) return unavailable(null);
    return {
      status: 'insufficient-text',
      sourceArticleId,
      targetArticleId,
      matchVersion,
      source: sideOf(value.source, sourceArticleId),
      target: sideOf(value.target, targetArticleId),
    };
  }
  // unavailable, or a status this page does not know: no score, no preview.
  return unavailable(value.status === 'unavailable' ? value.reason : null);
}

function selectionOf(value: Record<string, unknown>): SimilaritySelection {
  const count = (raw: unknown) => (Number.isSafeInteger(raw) && (raw as number) >= 0 ? (raw as number) : null);
  return {
    selectionOrigin: value.selectionOrigin === 'observed-outgoing-body-links' ? 'observed-outgoing-body-links' : null,
    selectionLimit: count(value.selectionLimit),
    selectedPairs: count(value.selectedPairs),
    selectionTruncated: typeof value.selectionTruncated === 'boolean' ? value.selectionTruncated : null,
  };
}

/**
 * The profile's textSimilarity key, read through an allowlist: nothing from the raw object is spread into the view.
 * Unknown or malformed states are 未提供; a pair that cannot be shown safely is unavailable, never a 0% score.
 */
export function parseTextSimilarity(raw: unknown): TextSimilarityView {
  if (!plainRecord(raw)) return { status: 'missing' };
  switch (raw.status) {
    case 'not-analysed':
      return { status: 'not-analysed' };
    case 'not-enabled':
      return { status: 'not-enabled' };
    case 'no-selected-pairs':
      return { status: 'no-selected-pairs', selection: selectionOf(raw) };
    case 'unavailable':
      return { status: 'unavailable', selection: selectionOf(raw) };
    case 'ready': {
      if (!Array.isArray(raw.items)) return { status: 'missing' };
      const items = raw.items
        .slice(0, SIMILARITY_PAIRS_MAX)
        .map(itemOf)
        .filter((item): item is SimilarityItem => item !== null);
      return {
        status: 'ready',
        selection: selectionOf(raw),
        matchVersion: versionLabel(raw.matchVersion),
        items,
        omittedItems: raw.items.length - items.length,
      };
    }
    default:
      return { status: 'missing' };
  }
}
/** A computed overlap ratio as a percentage; only ever called on a ready item. */
export const overlapPercent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;
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
