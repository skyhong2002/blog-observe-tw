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
