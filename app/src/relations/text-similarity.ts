export const TEXT_SIMILARITY_VERSION = 'body-prefix-dice-trigram-v1';
export const TEXT_SIMILARITY_LIMITS = Object.freeze({
  pairs: 10,
  articles: 10,
  rawBytes: 64 * 1024,
  prefixCodepoints: 4096,
  minimumCodepoints: 64,
  minimumGrams: 8,
  excerptCodepoints: 240,
});
export type SimilarityPair = { sourceArticleId: number; targetArticleId: number };
export type SimilaritySelection = { pairs: SimilarityPair[]; sourceBlogId?: number };
export function textSimilaritySelection(input: SimilaritySelection) {
  const validId = (v: unknown) => Number.isSafeInteger(v) && Number(v) > 0;
  if (
    !input ||
    !Array.isArray(input.pairs) ||
    !input.pairs.length ||
    input.pairs.length > TEXT_SIMILARITY_LIMITS.pairs ||
    (input.sourceBlogId !== undefined && !validId(input.sourceBlogId))
  )
    throw Error('invalid_text_similarity_selection');
  const ids = new Set<number>(),
    pairs = new Set<string>();
  for (const pair of input.pairs) {
    if (!pair || !validId(pair.sourceArticleId) || !validId(pair.targetArticleId) || pair.sourceArticleId === pair.targetArticleId)
      throw Error('invalid_text_similarity_selection');
    const key = [pair.sourceArticleId, pair.targetArticleId].sort((a, b) => a - b).join(':');
    if (pairs.has(key)) throw Error('invalid_text_similarity_selection');
    pairs.add(key);
    ids.add(pair.sourceArticleId);
    ids.add(pair.targetArticleId);
  }
  if (ids.size > TEXT_SIMILARITY_LIMITS.articles) throw Error('invalid_text_similarity_selection');
  return [...ids];
}
export function prepareSimilarityText(text: string) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > TEXT_SIMILARITY_LIMITS.rawBytes || /\p{Cs}/u.test(text))
    return { status: 'overcap' as const };
  const chars = Array.from(text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim());
  const prefix = chars.slice(0, TEXT_SIMILARITY_LIMITS.prefixCodepoints);
  const grams = new Set<string>();
  for (let i = 0; i + 2 < prefix.length; i++) grams.add(prefix.slice(i, i + 3).join(''));
  return {
    status: 'ready' as const,
    normalizedPrefix: prefix.join(''),
    grams,
    prefixCodepoints: prefix.length,
    truncated: chars.length > prefix.length,
  };
}
/** Literal normalized-prefix overlap only. No semantic, plagiarism, citation or dialogue inference. */
export function compareSimilarityText(source: string, target: string) {
  const a = prepareSimilarityText(source),
    b = prepareSimilarityText(target);
  if (a.status !== 'ready' || b.status !== 'ready')
    return { status: 'unavailable' as const, reason: 'overcap' as const, lexicalSimilarity: null };
  const base = {
    matchVersion: TEXT_SIMILARITY_VERSION,
    method: 'set-sorensen-dice-trigram',
    scope: 'normalized-body-prefix-only',
    exhaustive: false,
    source: { prefixCodepoints: a.prefixCodepoints, uniqueGrams: a.grams.size, truncated: a.truncated },
    target: { prefixCodepoints: b.prefixCodepoints, uniqueGrams: b.grams.size, truncated: b.truncated },
  };
  if (
    a.prefixCodepoints < TEXT_SIMILARITY_LIMITS.minimumCodepoints ||
    b.prefixCodepoints < TEXT_SIMILARITY_LIMITS.minimumCodepoints ||
    a.grams.size < TEXT_SIMILARITY_LIMITS.minimumGrams ||
    b.grams.size < TEXT_SIMILARITY_LIMITS.minimumGrams
  )
    return { ...base, status: 'insufficient-text' as const, lexicalSimilarity: null };
  const common = [...a.grams].filter((gram) => b.grams.has(gram)).length;
  return { ...base, status: 'ready' as const, lexicalSimilarity: (2 * common) / (a.grams.size + b.grams.size) };
}
