import { genreLabel } from '../blog-genre-vocabulary.ts';

export type GenreItem = {
  /** A starting-vocabulary key (food) or a reader's own folded text (blog-genre-vocabulary.ts genreKey). */
  genre: string;
  label: string;
  source: 'ai' | 'admin' | 'community';
  visible: boolean;
  agrees: number;
  disagrees: number;
  adminOverride: 'set' | 'hide' | null;
};
export type GenreState = { status: 'ready' | 'unavailable'; items: GenreItem[] };
/** A reader-added genre shows at once (its proposer's agree) and hides when disagrees catch up (2026-10-19). */
export const COMMUNITY_GENRE_THRESHOLD = 1;
/** An AI label hides only at this net disagreement, so one reader cannot remove it alone. */
export const AI_GENRE_HIDE_THRESHOLD = 2;

/** Admin overrides preserve the underlying AI baseline and every reader vote. */
export function resolveGenre(input: {
  genre: string;
  ai: boolean;
  admin: 'set' | 'hide' | null;
  agrees: number;
  disagrees: number;
}): GenreItem {
  const { genre, ai, admin, agrees, disagrees } = input;
  return {
    genre,
    label: genreLabel(genre),
    source: admin ? 'admin' : ai ? 'ai' : 'community',
    visible: admin ? admin === 'set' : ai ? disagrees - agrees < AI_GENRE_HIDE_THRESHOLD : agrees - disagrees >= COMMUNITY_GENRE_THRESHOLD,
    agrees,
    disagrees,
    adminOverride: admin,
  };
}

/** Shown genres first, then by how many readers agree, then by name. */
export const genreOrder = (a: GenreItem, b: GenreItem) =>
  Number(b.visible) - Number(a.visible) || b.agrees - a.agrees || a.label.localeCompare(b.label, 'zh-Hant');
