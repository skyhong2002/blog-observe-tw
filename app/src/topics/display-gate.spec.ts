import { describe, expect, it } from 'vitest';
import { DISPLAY_GATE, qualifyTopicSources, windowGateSql, windowTitleOnly } from './display-gate.ts';
import { FREQUENCY_POLICY } from './frequency.ts';
import { MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { evidence } from './routes.ts';

describe('ranked vocabulary uses tag thresholds, never a local blacklist', () => {
  it('uses exact upstream early/broad behavior, retaining new and sparse evidence', () => {
    expect(qualifyTopicSources({ a: 2, b: 2 })).toEqual({ early: true, broad: false });
    expect(qualifyTopicSources({ a: 3, b: 2, c: 1 })).toEqual({ early: true, broad: true });
    expect(qualifyTopicSources({ a: 2, b: 2, c: 2 })).toEqual({ early: true, broad: false });
    expect(windowTitleOnly({ a: 3, b: 2, c: 1 }, 100)).toBe(true);
    expect(windowTitleOnly({ a: 3, b: 2, c: 1 }, 300)).toBe(false); // equality is not above 2%.
    expect(windowTitleOnly({ a: 30 }, 100)).toBe(false); // one prolific author is not broad noise.
  });
  it('reuses frequency threshold and leaves persisted namespace/normalization unchanged', () => {
    expect(DISPLAY_GATE.documentFrequencyRatio).toBe(FREQUENCY_POLICY.highFrequencyRatio);
    expect(POLICY_VERSION).toBe('topic-policy-v3:25670024a3b758518aa0895b6ca6ebc0d1a4e6540a48380d0aeade56fe703475');
    expect(MATCHER_VERSION).toBe('topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5');
  });
  it('quality gate is applied before ranking limit, only to body evidence; historical detail stays intact', () => {
    const rank = evidence(false, true, true),
      detail = evidence();
    expect(rank).toContain('WHERE e.title_hit=1 OR NOT');
    expect(rank).toContain('COUNT(*) FROM scoped_posts');
    expect(rank).not.toContain('每天');
    expect(rank).not.toContain('Uncategorized');
    expect(detail).not.toContain('window_frequencies');
    expect(() => windowGateSql('wf);DROP TABLE posts')).toThrow('invalid_window_gate_alias');
  });
});
