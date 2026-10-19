import type { Pool, RowDataPacket } from 'mysql2/promise';
import { isGenreKey } from '../blog-genre-vocabulary.ts';
import { type GenreItem, type GenreState, genreOrder, resolveGenre } from './resolve.ts';

/** Scoped by at most 200 verified slugs; the vote count index starts with blog_id. */
export async function loadBlogGenres(pool: Pick<Pool, 'query'>, slugs: string[]): Promise<Map<string, GenreState>> {
  const keys = [...new Set(slugs.filter((slug) => typeof slug === 'string' && slug.length > 0))];
  if (keys.length > 200) throw Error('genre-read-bound');
  const result = new Map<string, GenreState>(keys.map((key) => [key, { status: 'ready', items: [] }]));
  if (!keys.length) return result;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SET STATEMENT max_statement_time=1 FOR
     SELECT b.slug,a.genre,MAX(a.source='ai' AND a.status='active') ai,
       MAX(a.source='admin' AND a.status='active') adminSet,
       MAX(a.source='admin' AND a.status='hidden') adminHide,
       (SELECT COUNT(*) FROM blog_genre_votes v WHERE v.blog_id=b.id AND v.genre=a.genre AND v.vote=1) agrees,
       (SELECT COUNT(*) FROM blog_genre_votes v WHERE v.blog_id=b.id AND v.genre=a.genre AND v.vote=-1) disagrees
     FROM blogs b JOIN blog_genre_assignments a ON a.blog_id=b.id
     WHERE b.status='verified' AND b.slug IN (?)
     GROUP BY b.id,b.slug,a.genre LIMIT 4001`,
    [keys],
  );
  if (rows.length > 4000) throw Error('genre-read-bound');
  for (const row of rows) {
    if (!isGenreKey(row.genre)) continue;
    result.get(row.slug)?.items.push(
      resolveGenre({
        genre: row.genre,
        ai: Boolean(Number(row.ai)),
        admin: Number(row.adminHide) ? 'hide' : Number(row.adminSet) ? 'set' : null,
        agrees: Number(row.agrees),
        disagrees: Number(row.disagrees),
      }),
    );
  }
  for (const state of result.values()) state.items.sort(genreOrder);
  return result;
}

/**
 * Every verified blog's shown genres, for the directory's genre chips and filter (a few thousand rows: each blog
 * has a handful). Keyed by blog id, in genreOrder.
 */
export async function loadShownGenres(pool: Pick<Pool, 'query'>): Promise<Map<number, GenreItem[]>> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SET STATEMENT max_statement_time=2 FOR
     SELECT a.blog_id blogId,a.genre,MAX(a.source='ai' AND a.status='active') ai,
       MAX(a.source='admin' AND a.status='active') adminSet,
       MAX(a.source='admin' AND a.status='hidden') adminHide,
       COALESCE(MAX(v.agrees),0) agrees,COALESCE(MAX(v.disagrees),0) disagrees
     FROM blog_genre_assignments a JOIN blogs b ON b.id=a.blog_id AND b.status='verified'
     LEFT JOIN (SELECT blog_id,genre,SUM(vote=1) agrees,SUM(vote=-1) disagrees FROM blog_genre_votes GROUP BY blog_id,genre) v
       ON v.blog_id=a.blog_id AND v.genre=a.genre
     GROUP BY a.blog_id,a.genre LIMIT 20001`,
  );
  if (rows.length > 20000) throw Error('genre-read-bound');
  const result = new Map<number, GenreItem[]>();
  for (const row of rows) {
    if (!isGenreKey(row.genre)) continue;
    const item = resolveGenre({
      genre: row.genre,
      ai: Boolean(Number(row.ai)),
      admin: Number(row.adminHide) ? 'hide' : Number(row.adminSet) ? 'set' : null,
      agrees: Number(row.agrees),
      disagrees: Number(row.disagrees),
    });
    if (!item.visible) continue;
    const id = Number(row.blogId);
    result.set(id, [...(result.get(id) ?? []), item]);
  }
  for (const items of result.values()) items.sort(genreOrder);
  return result;
}

export async function readBlogGenres(pool: Pick<Pool, 'query'>, slugs: string[], onFailure: (error: unknown) => void) {
  try {
    return { status: 'ready' as const, blogs: await loadBlogGenres(pool, slugs) };
  } catch (error) {
    onFailure(error);
    return { status: 'unavailable' as const, blogs: new Map<string, GenreState>() };
  }
}
