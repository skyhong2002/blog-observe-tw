import { describe, expect, it } from 'vitest';
import { compareSimilarityText, prepareSimilarityText, TEXT_SIMILARITY_LIMITS, textSimilaritySelection } from './text-similarity.ts';

const narrative = '今天先把蛤蜊洗淨，再將絲瓜削皮切塊，放入鍋中煮熟。週末一家人分享這道家常菜，湯汁鮮甜，餐桌旁談起旅行與日常生活。'.repeat(
  3,
);
describe('literal prefix Dice, never a relationship inference', () => {
  it('is symmetric and identical normalized prefixes score1 without claiming semantics', () => {
    const a = compareSimilarityText(narrative, narrative);
    expect(a.status).toBe('ready');
    expect(a.lexicalSimilarity).toBe(1);
    expect('scope' in a && a.scope).toBe('normalized-body-prefix-only');
    expect(compareSimilarityText(narrative, narrative + '另外一句')).toMatchObject({
      lexicalSimilarity: compareSimilarityText(narrative + '另外一句', narrative).lexicalSimilarity,
    });
  });
  it('a complete analyzed disjoint prefix may score0; unavailable and short text staynull', () => {
    const a = Array.from({ length: 100 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
    const b = Array.from({ length: 100 }, (_, i) => String.fromCodePoint(0x6000 + i)).join('');
    expect(compareSimilarityText(a, b).lexicalSimilarity).toBe(0);
    expect(compareSimilarityText('湯', narrative)).toMatchObject({ status: 'insufficient-text', lexicalSimilarity: null });
    expect(compareSimilarityText('a'.repeat(65537), narrative)).toMatchObject({ status: 'unavailable', lexicalSimilarity: null });
  });
  it('uses one documented NFKC/lower/whitespace normalization on both sides', () => {
    const text = 'ＡＢＣ 全形字與半形字以及菜色筆記 '.repeat(12);
    expect(compareSimilarityText(text, text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()).lexicalSimilarity).toBe(1);
  });
  it('ignores repetition frequency and refuses low-diversity long text asinsufficient', () => {
    expect(compareSimilarityText('甲'.repeat(1000), narrative)).toMatchObject({ status: 'insufficient-text', lexicalSimilarity: null });
  });
  it('limits byte input before normalization and prefix codepoints after normalization', () => {
    expect(prepareSimilarityText('蛤'.repeat(22000)).status).toBe('overcap');
    expect(prepareSimilarityText('\ud800').status).toBe('overcap');
    const x = prepareSimilarityText(narrative.repeat(50));
    expect(x.status).toBe('ready');
    if (x.status === 'ready') {
      expect(x.prefixCodepoints).toBe(TEXT_SIMILARITY_LIMITS.prefixCodepoints);
      expect(x.truncated).toBe(true);
      expect(x).not.toHaveProperty('excerpt');
    }
  });
  it('onlyexplicitboundedpairs, with symmetric duplicates and selfpairs rejected', () => {
    expect(textSimilaritySelection({ pairs: [{ sourceArticleId: 20875, targetArticleId: 9 }] })).toEqual([20875, 9]);
    for (const pairs of [
      [],
      [{ sourceArticleId: 1, targetArticleId: 1 }],
      [
        { sourceArticleId: 1, targetArticleId: 2 },
        { sourceArticleId: 2, targetArticleId: 1 },
      ],
      Array.from({ length: 10 }, (_, i) => ({ sourceArticleId: 1, targetArticleId: i + 2 })),
    ])
      expect(() => textSimilaritySelection({ pairs })).toThrow();
  });
  it('public score shape never includes private prefix content for ready or insufficient text', () => {
    for (const text of ['PRIVATE_PREFIX_MARKER ' + narrative, 'PRIVATE_PREFIX_MARKER']) {
      const result = compareSimilarityText(text, text);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_PREFIX_MARKER');
      expect(result).not.toHaveProperty('excerpt');
    }
  });
});
