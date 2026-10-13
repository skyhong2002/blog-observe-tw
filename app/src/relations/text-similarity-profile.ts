import type { Pool } from 'mysql2/promise';
import type { SimilarityPair } from './text-similarity.ts';
import { loadTextSimilarity } from './text-similarity-reader.ts';

export const PROFILE_SIMILARITY_PAIRS = 3;
export const PROFILE_SIMILARITY_LINKS = 20;
type Link = {
  postId: number;
  targetPostId: number | null;
  sourceBlogId: number;
  targetBlogId: number;
  location: string;
};
const id = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** Only already observed outgoing body links with a known target article. No search, URL guessing or NxN scan. */
export function selectProfileSimilarity(blogId: number, links: readonly Link[]) {
  const pairs: SimilarityPair[] = [],
    seen = new Set<string>();
  let omitted = 0;
  if (!id(blogId)) throw Error('invalid_text_similarity_profile');
  for (const link of links.slice(0, PROFILE_SIMILARITY_LINKS)) {
    if (
      link?.location !== 'body' ||
      link.sourceBlogId !== blogId ||
      !id(link.targetBlogId) ||
      link.targetBlogId === blogId ||
      !id(link.postId) ||
      !id(link.targetPostId) ||
      link.postId === link.targetPostId
    )
      continue;
    const key = [link.postId, link.targetPostId].sort((a, b) => a - b).join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    if (pairs.length === PROFILE_SIMILARITY_PAIRS) {
      omitted++;
      continue;
    }
    pairs.push({ sourceArticleId: link.postId, targetArticleId: link.targetPostId, expectedTargetBlogId: link.targetBlogId });
  }
  return { pairs, truncated: omitted > 0 || links.length > PROFILE_SIMILARITY_LINKS };
}

/** Uses the reader's independent fresh public/body ownership checks. A queue/cache cannot supply public previews. */
export async function loadProfileTextSimilarity(pool: Pool, blogId: number, links: readonly Link[], options: { enabled?: boolean } = {}) {
  if (options.enabled !== true) return { status: 'not-enabled' as const };
  const selected = selectProfileSimilarity(blogId, links);
  const coverage = {
    selectionOrigin: 'observed-outgoing-body-links' as const,
    selectionLimit: PROFILE_SIMILARITY_PAIRS,
    selectedPairs: selected.pairs.length,
    selectionTruncated: selected.truncated,
    exhaustive: false as const,
  };
  if (!selected.pairs.length) return { status: 'no-selected-pairs' as const, ...coverage };
  try {
    const result = await loadTextSimilarity(pool, { sourceBlogId: blogId, pairs: selected.pairs }, { enabled: true });
    return { ...result, ...coverage };
  } catch {
    return { status: 'unavailable' as const, ...coverage };
  }
}
