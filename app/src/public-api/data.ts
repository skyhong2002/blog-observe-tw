import { PUBLIC_SEARCH_SQL } from '../search-bounds.ts';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { publicPost, publicSummary } from '../public-post.ts';
import { type IconManifest, iconManifest } from '../v1/favicon-routes.ts';
import { iconUrl } from '../v1/icons.ts';
import { type articleQuery, type blogsQuery, escapeLike } from './query.ts';
export const iso = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const blogFields =
  'b.id,b.slug,b.name,b.url,b.category,b.description,b.discovered_at,b.last_crawl_success_at,b.last_published_at,b.expected_interval_hours';
export function blogDto(row: RowDataPacket, icons: IconManifest) {
  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    url: row.url ?? null,
    category: row.category,
    description: publicSummary(row.description),
    iconUrl: iconUrl(row.slug, icons),
    discoveredAt: iso(row.discovered_at),
    lastCrawlSuccessAt: iso(row.last_crawl_success_at),
    lastPublishedAt: iso(row.last_published_at),
    expectedIntervalHours: Number(row.expected_interval_hours),
  };
}
export async function findPublicBlog(pool: Pool, slug: string) {
  const [[row]] = await pool.query<RowDataPacket[]>(`SELECT ${blogFields} FROM blogs b WHERE b.slug=? AND b.status='verified'`, [slug]);
  return row ? blogDto(row, await iconManifest()) : null;
}
export async function listBlogs(pool: Pool, query: ReturnType<typeof blogsQuery>) {
  const args: unknown[] = [query.after];
  let search = '';
  if (query.q) {
    search = "AND (b.name LIKE ? ESCAPE '!' OR b.url LIKE ? ESCAPE '!')";
    const term = `%${escapeLike(query.q)}%`;
    args.push(term, term);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT ${blogFields} FROM blogs b WHERE b.status='verified' AND b.id>? ${search} ORDER BY b.id ASC LIMIT ${query.limit + 1}`,
    args,
  );
  const selected = rows.slice(0, query.limit);
  const icons = await iconManifest();
  return {
    items: selected.map((row) => blogDto(row, icons)),
    nextCursor: rows.length > query.limit ? query.next(Number(selected.at(-1)!.id)) : null,
  };
}
export async function listArticles(pool: Pool, query: ReturnType<typeof articleQuery>) {
  const args: unknown[] = [new Date(query.since), new Date(query.until)];
  const where: string[] = [];
  if (query.blog) {
    where.push('b.slug=?');
    args.push(query.blog);
  }
  if (query.q) {
    where.push("p.title LIKE ? ESCAPE '!'");
    args.push(`%${escapeLike(query.q)}%`);
  }
  if (query.after) {
    where.push('(COALESCE(p.published_at,p.created_at)<? OR (COALESCE(p.published_at,p.created_at)=? AND p.id<?))');
    args.push(new Date(query.after.at), new Date(query.after.at), query.after.id);
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.id,p.title,p.url,p.summary,p.author,p.published_at publishedAt,p.updated_at updatedAt,p.created_at observedAt,p.image_url imageUrl,b.slug blogSlug,b.name blogName,COALESCE(p.published_at,p.created_at) sortAt
    FROM posts p JOIN blogs b ON b.id=p.blog_id WHERE ${PUBLIC_SEARCH_SQL} AND COALESCE(p.published_at,p.created_at)>=? AND COALESCE(p.published_at,p.created_at)<=? ${where.length ? `AND ${where.join(' AND ')}` : ''}
    ORDER BY COALESCE(p.published_at,p.created_at) DESC,p.id DESC LIMIT ${query.limit + 1}`,
    args,
  );
  const selected = rows.slice(0, query.limit),
    last = selected.at(-1);
  const icons = await iconManifest();
  return {
    items: selected.map((row) => ({
      ...publicPost({ ...row, publishedAt: iso(row.publishedAt), updatedAt: iso(row.updatedAt) }),
      observedAt: iso(row.observedAt),
      iconUrl: iconUrl(row.blogSlug, icons),
    })),
    nextCursor: rows.length > query.limit && last ? query.next(new Date(last.sortAt).getTime(), Number(last.id)) : null,
    window: { since: new Date(query.since).toISOString(), until: new Date(query.until).toISOString() },
  };
}
