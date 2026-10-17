/** Deliberately small, multi-label vocabulary for reader preferences, separate from author tags. */
export const BLOG_GENRES = {
  food: '美食',
  travel: '旅遊',
  gadgets: '3C／軟體介紹',
  programming: '程式／技術',
  life: '生活／日記',
  parenting: '親子',
  news: '新聞／媒體',
  finance: '財經',
  anime: '動漫／遊戲',
  culture: '閱讀／藝文',
  creative: '攝影／設計',
  other: '其他／綜合',
} as const;
export type BlogGenre = keyof typeof BLOG_GENRES;
export const isBlogGenre = (value: string): value is BlogGenre => Object.hasOwn(BLOG_GENRES, value);
