import type { Pool } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { isPublicRouteKey, proposedBlogSlug, readableSlug, resolvePublicPage } from './page-routes.ts';

describe('stable public page slugs', () => {
  it('normalizes labels without changing original identities', () => {
    expect(readableSlug('ＡＩ 模型')).toBe('ai-模型');
    expect(readableSlug('人工智慧')).toBe('人工智慧');
    expect(readableSlug('Cafe\u0301')).toBe('café');
    expect(readableSlug('推薦／比較 & 閱讀')).toBe('推薦-比較-閱讀');
    expect([...readableSlug('長'.repeat(500))]).toHaveLength(120);
  });
  it('keeps existing readable blog keys but replaces discovery hashes using verified homes', () => {
    expect(proposedBlogSlug({ slug: 'kocpc', name: '電腦王阿達', url: 'https://www.kocpc.com.tw/' })).toBe('kocpc');
    expect(proposedBlogSlug({ slug: 'discovered-a123', name: '站主', url: 'https://www.skyhong.tw/' })).toBe('skyhong.tw');
    expect(proposedBlogSlug({ slug: 'discovered-a123', name: '作者', url: 'https://medium.com/@alice/' })).toBe('medium.com-alice');
    expect(proposedBlogSlug({ slug: 'discovered-a123', name: '作者', url: 'https://matters.town/@alice/' })).toBe('matters.town-alice');
    expect(proposedBlogSlug({ slug: 'discovered-a123', name: '個人記事', url: null })).toBe('個人記事');
  });
  it('rejects encoded delimiters and invalid segments without querying or decoding them', async () => {
    const pool = {
      query: () => {
        throw Error('must not query');
      },
    } as unknown as Pool;
    for (const key of [
      '',
      '..',
      'a..b',
      'a/b',
      'a\\b',
      '%2F',
      '%252F',
      'https:evil',
      'a?b',
      'a#b',
      'a\u0000b',
      'a\u202Eb',
      'a'.repeat(181),
    ]) {
      expect(isPublicRouteKey('topic', key), key).toBe(false);
      expect(await resolvePublicPage(pool, 'topic', key)).toBeNull();
    }
    expect(isPublicRouteKey('topic', `tag:${'a'.repeat(64)}`)).toBe(true);
    expect(isPublicRouteKey('topic', 'rss:123')).toBe(true);
    expect(isPublicRouteKey('blog', 'skyhong.tw')).toBe(true);
    expect(isPublicRouteKey('blog', 'legacy_name-')).toBe(true);
    expect(isPublicRouteKey('topic', '人工智慧')).toBe(true);
  });
});
