/** A presentation-time exclusion. Retained source rows/IDs and matcher freshness are unchanged. */
export const PUBLICATION_NOISE_VERSION = 'topic-publication-noise-v1';
export type PublicationExclusionReason = 'empty-label' | 'punctuation-only';

export function publicationExclusionReason(label: string): PublicationExclusionReason | null {
  const normalized = label.normalize('NFKC').trim();
  if (!normalized) return 'empty-label';
  return /[\p{L}\p{N}]/u.test(label) ? null : 'punctuation-only';
}

/**
 * Input must be a trusted identifier holding the original label (normally
 * t.label), not raw user SQL. Pure symbols remain noise even when NFKC would
 * turn a compatibility symbol such as ™ into letters. PCRE Unicode properties work in MariaDB.
 * A UTF-8 hex literal avoids backslash differences under NO_BACKSLASH_ESCAPES.
 * Both operands explicitly use utf8mb4_bin to avoid differing IMPLICIT table /
 * server collations (unicode_ci vs uca1400_ai_ci). They remain UTF-8 strings,
 * not BINARY bytes, so PCRE still recognizes Chinese Unicode letters.
 * Pattern: [\\p{L}\\p{N}]. Numbers are dealt with by the existing matching policy;
 * this predicate adds no length, frequency, blog-count or SEO threshold.
 */
export function publicationLabelSql(column: string): string {
  if (!/^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/i.test(column)) throw Error('invalid_publication_label_column');
  return `(CONVERT(COALESCE(${column},'') USING utf8mb4) COLLATE utf8mb4_bin REGEXP CONVERT(0x5b5c707b4c7d5c707b4e7d5d USING utf8mb4) COLLATE utf8mb4_bin)`;
}
