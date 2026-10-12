import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { type ActiveTerm, admitActiveTerm, estimatedMatcherBytes, sourceTermMetadata, startActiveSelection } from './active-set.ts';
import { activeTopicMatcher, clearTopicMatcherCache } from './batch.ts';
import { TopicMatcher } from './matcher.ts';
import {
  ACTIVE_TOPIC_LIMITS,
  digest,
  exclusionReason,
  NORMALIZATION_VERSION,
  normalizeTerm,
  POLICY_VERSION,
  storedNormalizedLabel,
} from './policy.ts';

const asOf = new Date('2026-10-12T00:00:00.000Z');
const term = (extra: Partial<ActiveTerm> = {}): ActiveTerm => ({
  id: 'a',
  label: '部落格',
  normalizedLabel: '部落格',
  articleCount: 3,
  lastPublishedAt: null,
  exclusionReason: null,
  ...extra,
});

describe('bounded active topic selection', () => {
  it('admits frequent or observed-recent terms, rejects old/future/missing low-frequency dates', () => {
    const state = startActiveSelection('snapshot', asOf);
    expect(admitActiveTerm(state, term(), asOf)).toBeNull();
    expect(admitActiveTerm(state, term({ articleCount: 1, lastPublishedAt: new Date(asOf.getTime() - 180 * 86400000) }), asOf)).toBeNull();
    for (const date of [null, new Date(asOf.getTime() - 181 * 86400000), new Date(asOf.getTime() + 1)])
      expect(admitActiveTerm(state, term({ articleCount: 2, lastPublishedAt: date }), asOf)).toBe('low-frequency');
    expect(state.activeTerms).toBe(2);
  });
  it('conservatively ignores flagged aliases and does not claim fake full-snapshot recency', () => {
    const state = startActiveSelection('s', asOf);
    admitActiveTerm(state, term({ exclusionReason: 'upstream-no-equal' }), asOf);
    expect(state.activeTerms).toBe(0);
    expect(exclusionReason('AI', { noEqual: true })).toBe('upstream-no-equal');
    expect(sourceTermMetadata({ articleCount: 1 }, null, asOf).lastPublishedAt).toBeNull();
    expect(sourceTermMetadata({ articleCount: 1 }, asOf, asOf).lastPublishedAt).toEqual(asOf);
    expect(sourceTermMetadata({ articleCount: 1, lastPublishedAt: '2027-01-01T00:00:00.000Z' }, asOf, asOf).lastPublishedAt).toBeNull();
  });
  it.each(['maxTerms', 'maxCodePoints', 'maxEstimatedBytes'] as const)(
    'stops permanently at the first %s bound, across a checkpoint',
    (key) => {
      const limits = { ...ACTIVE_TOPIC_LIMITS, [key]: key === 'maxTerms' ? 1 : key === 'maxCodePoints' ? 3 : estimatedMatcherBytes(3, 1) };
      const state = startActiveSelection('s', asOf);
      expect(admitActiveTerm(state, term(), asOf, limits)).toBeNull();
      expect(admitActiveTerm(state, term({ id: 'b' }), asOf, limits)).toBe('memory-budget');
      const resumed = JSON.parse(JSON.stringify(state));
      expect(admitActiveTerm(resumed, term({ id: 'c', label: 'AI', normalizedLabel: 'ai' }), asOf, limits)).toBe('memory-budget');
      expect(resumed.activeTerms).toBe(1);
      expect(resumed.eligibleTerms).toBe(3);
    },
  );
  it('produces identical chained digests independent of page checkpoints', () => {
    const items = Array.from({ length: 10 }, (_, i) => term({ id: String(i) }));
    const one = startActiveSelection('s', asOf);
    let paged = startActiveSelection('s', asOf);
    for (const t of items) admitActiveTerm(one, t, asOf);
    for (const t of items) {
      admitActiveTerm(paged, t, asOf);
      paged = JSON.parse(JSON.stringify(paged));
    }
    expect(paged).toEqual(one);
    expect(NORMALIZATION_VERSION).toContain(process.versions.unicode);
    expect(POLICY_VERSION).toContain('topic-policy-v3:');
  });
  it('preserves full canonical identity while bounding expanded Unicode storage', () => {
    const label = 'ﷺ'.repeat(20),
      normalized = normalizeTerm(label);
    expect([...normalized].length).toBeGreaterThan(255);
    expect([...storedNormalizedLabel(label)].length).toBe(255);
    expect(exclusionReason(label)).toBe('invalid-label');
    expect(digest(normalized)).not.toBe(digest(storedNormalizedLabel(label)));
    expect(storedNormalizedLabel('😀'.repeat(300))).toBe('😀'.repeat(255));
  });
  it('hard-rejects over-cap input and reports bounded trie statistics', () => {
    expect(() => new TopicMatcher(Array.from({ length: ACTIVE_TOPIC_LIMITS.maxTerms + 1 }, () => ({ id: 'a', label: 'test' })))).toThrow(
      'active term cap',
    );
    const terms = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), label: `term${i}${'漢'.repeat(190)}` }));
    expect(() => new TopicMatcher(terms)).toThrow('active memory cap');
    expect(new TopicMatcher([{ id: 'a', label: 'AI' }]).statistics).toEqual({
      terms: 1,
      nodes: 3,
      codePoints: 2,
      estimatedBytes: estimatedMatcherBytes(2, 1),
    });
  });
  it('reuses only one ready selection for exactly the same pool, replacing on version changes', async () => {
    clearTopicMatcherCache();
    let selection = 'one';
    const makePool = () =>
      ({
        query: vi.fn(async (sql: string) =>
          sql.includes('topic_policy_selections')
            ? [[{ selection_id: selection, active_terms: 1 }]]
            : [[{ id: digest('ai'), label: 'AI' }]],
        ),
      }) as unknown as Pool;
    const a = makePool(),
      b = makePool();
    const first = await activeTopicMatcher(a, 'snapshot');
    expect(await activeTopicMatcher(a, 'snapshot')).toBe(first);
    expect(await activeTopicMatcher(b, 'snapshot')).not.toBe(first);
    expect(await activeTopicMatcher(a, 'snapshot')).not.toBe(first);
    const current = await activeTopicMatcher(a, 'snapshot');
    selection = 'two';
    expect(await activeTopicMatcher(a, 'snapshot')).not.toBe(current);
    clearTopicMatcherCache();
  });
});
