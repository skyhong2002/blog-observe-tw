import { describe, it, expect } from 'vitest';
import { fulltextTokens, normalizeFulltext, currentSearchBody } from './search-fulltext.ts';
import type { RowDataPacket } from 'mysql2/promise';
describe('historical fulltext encoding and current evidence', () => {
  it('encodes whole body beyond the former prefix without stopwords/operators', () => {
    const terms = fulltextTokens('x'.repeat(5000) + '蛤蜊絲瓜');
    expect(terms).toEqual(expect.arrayContaining(fulltextTokens('蛤蜊絲瓜')));
    expect(terms.every((t) => /^x[a-z0-9]{8}$/.test(t))).toBe(true);
    expect(fulltextTokens('10%_= OR +foo')).toEqual(expect.arrayContaining(fulltextTokens('%_=')));
  });
  it('normalizes Unicode, case and preserves emoji code points without collisions', () => {
    expect(normalizeFulltext('ＡＩ')).toBe('ai');
    expect(fulltextTokens('ＡＩ')).toEqual(fulltextTokens('ai'));
    expect(fulltextTokens('😀甲')).not.toEqual(fulltextTokens('😁甲'));
    expect(fulltextTokens('甲甲甲')).toHaveLength(1);
  });
  it('rejects unverified body ownership, changed article, future evidence and overcap', () => {
    const row = {
      bodyStatus: 'ok',
      bodyBlogId: 1,
      blogId: 1,
      obtainedAt: new Date(0),
      sourceUrl: 'https://anise.tw/feed',
      articleUrl: 'https://anise.tw/290726',
      url: 'https://anise.tw/290726',
      blogUrl: 'https://anise.tw/',
      bodyBytes: Buffer.from('蛤蜊絲瓜'),
    } as unknown as RowDataPacket;
    expect(currentSearchBody(row)).toBe('蛤蜊絲瓜');
    for (const patch of [
      { bodyStatus: 'partial' },
      { bodyBlogId: 2 },
      { articleUrl: 'https://anise.tw/other' },
      { sourceUrl: 'https://other.example/feed' },
      { obtainedAt: new Date('2099-01-01') },
      { bodyBytes: Buffer.alloc(131073) },
      { bodyBytes: Buffer.from([255]) },
    ])
      expect(currentSearchBody({ ...row, ...patch } as RowDataPacket)).toBeNull();
  });
});
