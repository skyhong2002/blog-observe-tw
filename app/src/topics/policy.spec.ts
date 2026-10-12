import { describe, expect, it } from 'vitest';
import { TopicMatcher } from './matcher.ts';
import { digest, exclusionReason, MATCHER_VERSION, normalizeTerm, POLICY_VERSION, projectTopicTerms } from './policy.ts';

describe('crowdsourced vocabulary matching policy', () => {
  it('excludes one-character Chinese substrings: 穩定性 never matches 性', () => {
    expect(exclusionReason('性')).toBe('too-short');
    expect(new TopicMatcher([{ id: 'sex', label: '性' }]).match('穩定性').ids).toEqual([]);
    expect(new TopicMatcher([{ id: 'stable', label: '穩定性' }]).match('穩定性').ids).toEqual(['stable']);
  });
  it('matches AI 模型 once after width/case folding, deterministically across input order', () => {
    const terms = [
      { id: 'b', label: 'AI' },
      { id: 'a', label: 'ai' },
      { id: 'c', label: 'ＡＩ' },
    ];
    for (const values of [terms, [...terms].reverse()]) {
      const matcher = new TopicMatcher(values);
      expect(matcher.match('AI 模型').ids).toEqual(['a']);
      expect(matcher.match('AI工具與用AI').ids).toEqual(['a']);
      expect(matcher.match('said chair AIx xAI AI_tools').ids).toEqual([]);
    }
  });
  it('keeps named alphanumeric topics and English boundaries while excluding bare dates/numbers', () => {
    const labels = ['GPT-4', '3C', '2026大選', 'café', '2026', '10月', '123', '0050', '2026-10-12', '１,２３４'];
    const matcher = new TopicMatcher(labels.map((label) => ({ id: label, label })));
    expect(matcher.match('GPT-4 3C 2026大選 café 2026 10月 123 0050 2026-10-12 １,２３４').ids.sort()).toEqual(
      ['2026大選', '3C', 'GPT-4', 'café'].sort(),
    );
    expect(matcher.match('GPT-40 xGPT-4 caféine').ids).toEqual([]);
    for (const label of labels.slice(4)) expect(exclusionReason(label)).not.toBeNull();
  });
  it('preserves source pool terms while recording exact upstream/local exclusions', () => {
    const raw = [
      { id: 'a', label: '推薦', payload: { articleCount: 20 } },
      { id: 'b', label: '時間', payload: {} },
      { id: 'c', label: '2026', payload: {} },
      { id: 'd', label: '旅行日記', payload: { noise: true } },
    ];
    const before = structuredClone(raw);
    const projection = projectTopicTerms(raw);
    expect(raw).toEqual(before);
    expect(projection.aliases).toHaveLength(4);
    expect(Object.fromEntries(projection.terms.map((term) => [term.label, term.exclusionReason]))).toEqual({
      推薦: 'tag-noise',
      時間: 'no-equal',
      '2026': 'pure-number',
      旅行日記: 'upstream-noise',
    });
  });
  it('uses maximum source article count display spelling, stable canonical ID and id tie break', () => {
    const projected = projectTopicTerms([
      { id: 'z', label: 'AI', payload: { articleCount: 109 } },
      { id: 'a', label: 'ai', payload: JSON.stringify({ articleCount: 2 }) },
      { id: 'g2', label: 'google', payload: { articleCount: 10 } },
      { id: 'g1', label: 'Google', payload: { articleCount: 10 } },
    ]);
    expect(projected.terms.find((term) => term.normalizedLabel === 'ai')).toEqual({
      id: digest('ai'),
      normalizedLabel: 'ai',
      label: 'AI',
      exclusionReason: null,
      occurrences: 111,
    });
    expect(projected.terms.find((term) => term.normalizedLabel === 'google')?.label).toBe('Google');
    expect(projected.aliases.find((term) => term.termId === 'a')?.canonicalId).toBe(digest(normalizeTerm('ＡＩ')));
    expect(projectTopicTerms([{ id: 'new-snapshot-id', label: 'ai', payload: {} }]).terms[0].id).toBe(digest('ai'));
  });
  it('treats a noise spelling as excluding its complete canonical group', () => {
    const terms = [
      { id: 'a', label: 'AI', payload: {} },
      { id: 'b', label: 'ai', payload: { noise: true } },
    ];
    expect(projectTopicTerms(terms).terms[0].exclusionReason).toBe('upstream-noise');
    expect(new TopicMatcher(terms).match('AI 模型').ids).toEqual([]);
  });
  it('pins independently persisted policy and matcher versions', () => {
    expect(POLICY_VERSION).toMatch(/^topic-policy-v3:[a-f0-9]{64}$/u);
    expect(MATCHER_VERSION).toMatch(/^topic-matcher-v3:[a-f0-9]{64}$/u);
  });
});
