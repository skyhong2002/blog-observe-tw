import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import noEqual from '../../data/topic-no-equal-tags.json' with { type: 'json' };
import { CLEANUP_VERSION } from './matching-body.ts';
import { isTagNoise } from './vendor/tag-noise.ts';

export const normalizeTerm = (value: string) => value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const NO_EQUAL = new Set(noEqual.tags.map(normalizeTerm));
// Exact upstream copies are retained; changing either file must change the policy identity.
export const UPSTREAM_COMMIT = 'afe0a653fa8aae7e25a04a1d9fe87bf0400a2a39';
export const POLICY_VERSION = `topic-policy-v2:${digest(UPSTREAM_COMMIT + readFileSync(new URL('./vendor/tag-noise.ts', import.meta.url), 'utf8') + readFileSync(new URL('../../data/topic-no-equal-tags.json', import.meta.url), 'utf8'))}`;
export const MATCHER_VERSION = `topic-matcher-v2:${digest(POLICY_VERSION + CLEANUP_VERSION + ':nfkc-latin-boundaries-title2-body1')}`;

const payloadObject = (value: unknown): Record<string, unknown> => {
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
    const reason = reasons.includes('upstream-noise') ? 'upstream-noise' : (reasons.find(Boolean) ?? null);
    terms.push({
      id,
      normalizedLabel,
      label: group[0].label,
      exclusionReason: reason,
      occurrences: group.reduce((sum, term) => sum + count(term), 0),
    });
    for (const term of group) aliases.push({ termId: term.id, canonicalId: id });
  }
  terms.sort((a, b) => a.id.localeCompare(b.id));
  aliases.sort((a, b) => a.termId.localeCompare(b.termId));
  return { aliases, terms };
}
