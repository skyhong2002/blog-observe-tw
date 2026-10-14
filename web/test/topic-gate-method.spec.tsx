/**
 * The window display gate's explanation inside the topics method notes (TopicMethod, shown in the page's closed
 * 資料來源與計算方式 block), rendered with react-dom/server. Synthetic policy; not a UI acceptance.
 */
import { load } from 'cheerio';
import { renderToString } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import TopicMethod from '@/components/public/TopicMethod';
import { displayGateText, type MatchingPolicy, matchingReasonLabel, type VocabularyStatus } from '@/lib/topics';
import { EMPTY } from './public-payloads.ts';

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return { default: ({ prefetch: _prefetch, ...props }: Record<string, unknown>) => createElement('a', props) };
});

const vocabulary = (EMPTY.topics as { vocabulary: VocabularyStatus }).vocabulary;
const gate = {
  version: 'tag-broad-window-title-only-v1',
  upstream: 'tag.observe.tw/qualifyTagMedia/broad',
  minimumSources: 3,
  minimumTwiceSources: 2,
  minimumPeakPosts: 3,
  documentFrequencyRatio: 0.02,
  reason: 'high-window-document-frequency-title-only',
  effect: 'ranking-body-evidence-only;source-pool-and-historical-pages-retained',
};
const policy = (displayGate?: object): MatchingPolicy =>
  ({
    version: 'm',
    policyVersion: 'p',
    titleWeight: 2,
    bodyWeight: 1,
    sameBlogDecay: 0.5,
    sources: ['tag-vocabulary'],
    frequency: { baselineDays: 365, highFrequencyRatio: 0.02, reason: 'high-document-frequency-title-only', version: 'f' },
    ...(displayGate ? { displayGate } : {}),
  }) as MatchingPolicy;

describe('window display gate in the method notes', () => {
  test('the ranking notes state the gate from the payload: thresholds, window vs 365-day baseline, nothing deleted', () => {
    const $ = load(renderToString(<TopicMethod vocabulary={vocabulary} matchingPolicy={policy(gate)} ranking />));
    const text = $('body').text();
    expect(text).toContain('本期間高頻詞：期間內至少 3 個部落格使用、其中 2 個各有 2 篇以上且有一站達 3 篇');
    expect(text).toContain('並且期間內命中文章占比超過 2% 的詞，排行只計標題命中、不計正文貢獻。');
    expect(text).toContain('與 365 日基準的高頻詞規則分開');
    expect(text).toContain('話題頁、歷史文章與原始 RSS 分類都保留');
    expect(text).not.toMatch(/刪除了|黑名單/);
  });

  test('no gate reported, no gate sentence; a detail page with the window reason explains it as title-only', () => {
    expect(load(renderToString(<TopicMethod vocabulary={vocabulary} matchingPolicy={policy()} ranking />))('body').text()).not.toContain(
      '本期間高頻詞',
    );
    expect(displayGateText(policy())).toBeNull();
    const detail = load(
      renderToString(
        <TopicMethod vocabulary={vocabulary} matchingPolicy={policy(gate)} matchingReason="high-window-document-frequency-title-only" />,
      ),
    )('body').text();
    expect(detail).toContain('本期間高頻詞，排行只計標題命中：');
    expect(detail).not.toContain('長期文章中出現得很普遍');
    // The baseline reason keeps its own text; an unknown reason is shown as such, not mistaken for either.
    expect(matchingReasonLabel('high-document-frequency-title-only')).toBe('高頻詞，只計標題命中');
    expect(matchingReasonLabel('toString')).toBe('其他比對規則（toString）');
  });
});
