import type { Pool, RowDataPacket } from 'mysql2/promise';
import { isBlogGenre } from '../blog-genre-vocabulary.ts';
import { type GenreState, resolveGenre } from './resolve.ts';

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
     GROUP BY b.id,b.slug,a.genre LIMIT 2401`,
    [keys],
  );
  if (rows.length > 2400) throw Error('genre-read-bound');
  for (const row of rows) {
    if (!isBlogGenre(row.genre)) continue;
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
  for (const state of result.values()) state.items.sort((a, b) => a.genre.localeCompare(b.genre, 'en'));
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
