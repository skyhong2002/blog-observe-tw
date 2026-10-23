import { genreKey } from '../blog-genre-vocabulary.ts';
import type { TrafficTagItem } from './traffic.ts';

export type GenreItem = {
  /** The URL key: a starting-vocabulary key (food) or the tag's own folded text (blog-genre-vocabulary.ts genreKey). */
  genre: string;
  /** The tag as traffic.observe.tw spells it (美食, 3C, 個人). */
  label: string;
  /** editor: traffic's editors' list (or its spreadsheet), always shown whatever the votes. */
  source: 'editor' | 'ai' | 'admin' | 'community';
  visible: boolean;
  agrees: number;
  disagrees: number;
  adminOverride: 'set' | 'hide' | null;
};
export type GenreState = { status: 'ready' | 'unavailable'; items: GenreItem[] };

/**
 * A site's tags from traffic, which applies the rules blog's genres had (traffic src/crowd.ts resolveTags): editors'
 * tags always show, an AI tag hides at net −2, a reader's tag shows at once and hides when disagrees catch up, and
 * an admin's set or hide wins. Kept in traffic's order (shown first, the editors' list in its own order). A tag
 * genreKey cannot key, or a second spelling of a key already listed, is left out.
 */
export function genreItems(tags: TrafficTagItem[]): GenreItem[] {
  const out: GenreItem[] = [];
  for (const t of tags) {
    const genre = genreKey(t.tag);
    if (!genre || out.some((item) => item.genre === genre)) continue;
    out.push({
      genre,
      label: t.tag,
      source: t.source === 'sheet' ? 'editor' : t.source,
      visible: t.visible,
      agrees: t.agrees,
      disagrees: t.disagrees,
      adminOverride: t.adminOverride,
    });
  }
  return out;
}
