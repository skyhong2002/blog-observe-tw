import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import noEqual from '../../data/topic-no-equal-tags.json' with { type: 'json' };
import { CLEANUP_VERSION } from './matching-body.ts';
import { publicationExclusionReason } from './publication-noise.ts';
import { isTagNoise } from './vendor/tag-noise.ts';

/** One immutable process profile binds reader/writer algorithms to their persisted versions. */
export function normalizationProfile(env: Record<string, string | undefined>) {
  const format = env.BLOG_TOPIC_FORMAT_NORMALIZATION_ENABLED === 'true';
  // New namespaces are not prepared in production yet. Keep this opt-in offline until cutover is supported.
  if (format && env.NODE_ENV === 'production') throw Error('topic_format_normalization_not_ready_for_production');
  return Object.freeze({
    version: `nfkc-lower-en-US-${format ? 'strip-format-v1-' : ''}unicode-${process.versions.unicode}`,
    normalize: (value: string) => {
      const folded = value.normalize('NFKC').toLocaleLowerCase('en-US');
      return (format ? folded.replace(/\p{Cf}/gu, '') : folded).replace(/\s+/gu, ' ').trim();
    },
    display: (value: string) => (format ? value.replace(/\p{Cf}/gu, '').trim() : value),
  });
}
const NORMALIZATION_PROFILE = normalizationProfile(process.env);
/** Derived matching identity only. Original exact-label IDs/payloads remain in the upstream pool. */
export const normalizeTerm = NORMALIZATION_PROFILE.normalize;
export const displayTerm = NORMALIZATION_PROFILE.display;
/** Only derived VARCHAR lookup columns are shortened; canonical identity always hashes the complete normalization. */
export const storedNormalizedLabel = (label: string) => [...normalizeTerm(label)].slice(0, 255).join('');
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const NO_EQUAL = new Set(noEqual.tags.map(normalizeTerm));
// Exact upstream copies are retained; changing either file must change the policy identity.
export const UPSTREAM_COMMIT = 'afe0a653fa8aae7e25a04a1d9fe87bf0400a2a39';
export const ACTIVE_TOPIC_LIMITS = Object.freeze({
  maxTerms: 50_000,
  maxCodePoints: 150_000,
  maxEstimatedBytes: 96 * 1024 * 1024,
  bytesPerNode: 512,
  bytesPerTerm: 1024,
  minArticleCount: 3,
  recentDays: 180,
});
export const NORMALIZATION_VERSION = NORMALIZATION_PROFILE.version;
export const POLICY_VERSION = `topic-policy-v3:${digest(UPSTREAM_COMMIT + readFileSync(new URL('./vendor/tag-noise.ts', import.meta.url), 'utf8') + readFileSync(new URL('../../data/topic-no-equal-tags.json', import.meta.url), 'utf8') + NORMALIZATION_VERSION + JSON.stringify(ACTIVE_TOPIC_LIMITS) + ':max-alias-count-last-date-count-desc-id-desc:shadow-v3-per-snapshot')}`;
export const MATCHER_VERSION = `topic-matcher-v3:${digest(POLICY_VERSION + CLEANUP_VERSION + ':nfkc-latin-boundaries-title2-body1')}`;

export const payloadObject = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string') {
    try {
      return payloadObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
};

/** A local matching exclusion is not a deletion from the crowdsourced source vocabulary. */
export function exclusionReason(label: string, payload?: unknown): string | null {
  const normalized = normalizeTerm(label);
  if (payloadObject(payload).noise === true) return 'upstream-noise';
  if (payloadObject(payload).noEqual === true) return 'upstream-no-equal';
  const publicationReason = publicationExclusionReason(label);
  if (publicationReason) return publicationReason;
  if ([...normalized].length < 2) return 'too-short';
  if ([...normalized].length > 240 || /[\p{Cc}\p{Cf}]/u.test(normalized)) return 'invalid-label';
  if (/^[\p{Number}\s.,+\-％%]+$/u.test(normalized)) return 'pure-number';
  if (
    /^(?:(?:西元|公元|民國)?\d{1,4}年(?:度)?(?:\d{1,2}月(?:\d{1,2}[日號])?)?|\d{1,2}月(?:\d{1,2}[日號])?|\d{1,2}[日號]|\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?|\d{1,2}[-/]\d{1,2})$/u.test(
      normalized,
    )
  )
    return 'pure-date';
  if (isTagNoise(normalized)) return 'tag-noise';
  if (NO_EQUAL.has(normalized)) return 'no-equal';
  return null;
}

type InputTerm = { id: string; label: string; payload: unknown };
export type ProjectedTopicTerm = {
  id: string;
  normalizedLabel: string;
  label: string;
  exclusionReason: string | null;
  occurrences: number;
};
export function projectTopicTerms(input: InputTerm[]): {
  aliases: { termId: string; canonicalId: string }[];
  terms: ProjectedTopicTerm[];
} {
  const groups = new Map<string, InputTerm[]>();
  for (const term of input) {
    const normalized = normalizeTerm(term.label);
    const group = groups.get(normalized) ?? [];
    group.push(term);
    groups.set(normalized, group);
  }
  const count = (term: InputTerm) => {
    const value = payloadObject(term.payload).articleCount;
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  };
  const aliases: { termId: string; canonicalId: string }[] = [];
  const terms: ProjectedTopicTerm[] = [];
  for (const [normalizedLabel, group] of groups) {
    group.sort((a, b) => count(b) - count(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const id = digest(normalizedLabel);
    const reasons = group.map((term) => exclusionReason(term.label, term.payload));
    // A single upstream noise marker excludes every equivalent spelling conservatively.
    const reason = reasons.reduce<string | null>(mergeExclusionReasons, null);
    terms.push({
      id,
      normalizedLabel,
      label: displayTerm(group[0].label),
      exclusionReason: reason,
      occurrences: group.reduce((sum, term) => sum + count(term), 0),
    });
    for (const term of group) aliases.push({ termId: term.id, canonicalId: id });
  }
  terms.sort((a, b) => a.id.localeCompare(b.id));
  aliases.sort((a, b) => a.termId.localeCompare(b.termId));
  return { aliases, terms };
}

const REASON_PRIORITY = [
  'upstream-noise',
  'upstream-no-equal',
  'empty-label',
  'punctuation-only',
  'too-short',
  'invalid-label',
  'pure-number',
  'pure-date',
  'tag-noise',
  'no-equal',
];
export function mergeExclusionReasons(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return REASON_PRIORITY.indexOf(a) <= REASON_PRIORITY.indexOf(b) ? a : b;
}
