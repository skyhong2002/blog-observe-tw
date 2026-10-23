import { describe, expect, it } from 'vitest';
import { genreKey, genreLabel, isGenreKey } from './blog-genre-vocabulary.ts';

describe('reader-written genres', () => {
  it('folds what a reader types: starting names and keys to their keys, anything else to its own text', () => {
    expect(genreKey('美食')).toBe('food');
    expect(genreKey('ＦＯＯＤ')).toBe('food');
    expect(genreKey('  #咖啡  ')).toBe('咖啡');
    expect(genreKey('Single   Origin')).toBe('single origin');
    expect(genreLabel('food')).toBe('美食');
    expect(genreLabel('咖啡')).toBe('咖啡');
  });
  it('refuses empty, overlong (over 32, traffic TAG_LIMIT), punctuation-only, list-separated and control text', () => {
    for (const text of ['', '   ', '-', '###', '字'.repeat(33), '旅遊, 生活', '旅遊、生活', 'a/b', 'a\u0000b', '<b>', 7, null])
      expect(genreKey(text), String(text)).toBeNull();
    expect(genreKey('字'.repeat(32))).toBe('字'.repeat(32));
  });
  it('a stored key is one genreKey could have made', () => {
    expect(isGenreKey('food')).toBe(true);
    expect(isGenreKey('咖啡')).toBe(true);
    expect(isGenreKey('美食')).toBe(false);
    expect(isGenreKey('Coffee')).toBe(false);
    expect(isGenreKey('-')).toBe(false);
  });
});
