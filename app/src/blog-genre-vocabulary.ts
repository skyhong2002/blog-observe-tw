/** Deliberately small, multi-label vocabulary for reader preferences, separate from author tags.
 * On 2026-10-17 every paired label (3C／軟體介紹 …) became two genres. Each old key kept the half it names
 * (gadgets 3C, culture 藝文, creative → design), so earlier /articles/?exclude= links still mean part of what they did. */
export const BLOG_GENRES = {
  food: '美食',
  travel: '旅遊',
  gadgets: '3C',
  software: '軟體介紹',
  programming: '程式',
  tech: '技術',
  life: '生活',
  diary: '日記',
  parenting: '親子',
  news: '新聞',
  media: '媒體',
  finance: '財經',
  anime: '動漫',
  games: '遊戲',
  reading: '閱讀',
  culture: '藝文',
  photography: '攝影',
  design: '設計',
  other: '其他',
  general: '綜合',
} as const;
export type BlogGenre = keyof typeof BLOG_GENRES;
export const isBlogGenre = (value: string): value is BlogGenre => Object.hasOwn(BLOG_GENRES, value);

/** Longest tag, in characters: traffic.observe.tw's TAG_LIMIT (src/crowd.ts), where the tags live since 2026-10-24. */
export const GENRE_TEXT_LIMIT = 32;
const LABEL_KEYS = new Map(Object.entries(BLOG_GENRES).map(([key, label]) => [label.toLowerCase(), key as BlogGenre]));
/**
 * The stored key for what a reader typed (2026-10-19: readers may add any genre, shown at once). The starting
 * vocabulary keeps its keys, so 美食, food and ＦＯＯＤ are one genre; anything else is its own folded text
 * (NFKC, lower case, single spaces, no leading #). null without a letter or digit, too long, separators or control
 * characters.
 */
export function genreKey(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const folded = text
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^#+\s*/, '')
    .toLowerCase();
  if (!/[\p{L}\p{N}]/u.test(folded) || Array.from(folded).length > GENRE_TEXT_LIMIT || /[\p{Cc}\p{Cf},，、;；/\\|<>]/u.test(folded))
    return null;
  if (isBlogGenre(folded)) return folded;
  return LABEL_KEYS.get(folded) ?? folded;
}
/** A key genreKey could have made: a starting genre or a reader's folded text. */
export const isGenreKey = (value: unknown): value is string => typeof value === 'string' && genreKey(value) === value;
/** How a genre reads: the starting vocabulary's name, otherwise the reader's own text. */
export const genreLabel = (key: string) => (isBlogGenre(key) ? BLOG_GENRES[key] : key);
