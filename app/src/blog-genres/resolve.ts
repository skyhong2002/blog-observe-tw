import type { BlogGenre } from '../blog-genre-vocabulary.ts';

export type GenreItem = {
  genre: BlogGenre;
  source: 'ai' | 'admin' | 'community';
  visible: boolean;
  agrees: number;
  disagrees: number;
  adminOverride: 'set' | 'hide' | null;
};
export type GenreState = { status: 'ready' | 'unavailable'; items: GenreItem[] };
export const COMMUNITY_GENRE_THRESHOLD = 2;
/** An AI label hides only at this net disagreement, so one reader cannot remove it alone. */
export const AI_GENRE_HIDE_THRESHOLD = 2;

/** Admin overrides preserve the underlying AI baseline and every reader vote. */
export function resolveGenre(input: {
  genre: BlogGenre;
  ai: boolean;
  admin: 'set' | 'hide' | null;
  agrees: number;
  disagrees: number;
}): GenreItem {
  const { genre, ai, admin, agrees, disagrees } = input;
  return {
    genre,
    source: admin ? 'admin' : ai ? 'ai' : 'community',
    visible: admin ? admin === 'set' : ai ? disagrees - agrees < AI_GENRE_HIDE_THRESHOLD : agrees - disagrees >= COMMUNITY_GENRE_THRESHOLD,
    agrees,
    disagrees,
    adminOverride: admin,
  };
}
