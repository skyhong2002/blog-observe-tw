import { pathToFileURL } from 'node:url';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { loadConfig } from '../app/src/config.js';
import { createDb } from '../app/src/db/client.ts';
import { ICON_WIDTHS, ImageService, POST_WIDTHS } from '../app/src/images/service.ts';

type PostRow = { id: number; image_url: string | null; status: string; slug: string };
type SlugRow = { slug: string };
export type HomeImageSelection = { posts: number[]; icons: string[] };
/** Bound each homepage section BEFORE filtering/deduplication: do not fill gaps with off-page sources. */
export function selectHomeImages(posts: PostRow[], authors: SlugRow[], recentBlogs: SlugRow[]): HomeImageSelection {
  const visiblePosts = posts.slice(0, 7);
  const icons = [
    ...new Set(
      [...authors.slice(0, 8), ...visiblePosts, ...recentBlogs.slice(0, 10)]
        .map((row) => row.slug)
        .filter((slug) => typeof slug === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(slug)),
    ),
  ].slice(0, 25);
  return {
    posts: visiblePosts
      .filter((row) => row.status === 'verified' && typeof row.image_url === 'string' && row.image_url)
      .map((row) => row.id)
      .slice(0, 20),
    icons,
  };
}
/** Same three ordered homepage collections, without full article bodies, totals or unbounded source scans. */
export async function loadHomeImages(pool: Pool): Promise<HomeImageSelection> {
  const [posts] = await pool.query<RowDataPacket[]>(`SELECT p.id,p.image_url,b.status,b.slug FROM posts p JOIN blogs b ON b.id=p.blog_id
    WHERE b.status<>'moved' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())
    ORDER BY p.published_at DESC,p.id DESC LIMIT 7`);
  // Overview groups by this same author/blog identity; post counts do not affect its order.
  const [authors] = await pool.query<RowDataPacket[]>(`SELECT DISTINCT a.id,a.display_name,b.slug,b.name FROM authors a
    JOIN blog_authors ba ON ba.author_id=a.id JOIN blogs b ON b.id=ba.blog_id
    WHERE a.status<>'rejected' AND ba.status='active' AND b.status<>'moved'
    ORDER BY a.display_name,b.slug LIMIT 8`);
  const [recent] = await pool.query<RowDataPacket[]>(`SELECT b.slug FROM blogs b
    JOIN posts latest ON latest.id=(SELECT lp.id FROM posts lp WHERE lp.blog_id=b.id
      AND (lp.published_at IS NULL OR lp.published_at<=UTC_TIMESTAMP()) ORDER BY lp.published_at DESC,lp.id DESC LIMIT 1)
    WHERE b.status<>'moved' AND latest.published_at IS NOT NULL
    ORDER BY latest.published_at DESC,latest.id DESC,b.id LIMIT 10`);
  return selectHomeImages(posts as PostRow[], authors as SlugRow[], recent as SlugRow[]);
}
const sourceCounts = () => ({ sources: 0, success: 0, failed: 0, variants: { success: 0, failed: 0 } });
export async function prewarmHomeImages(selection: HomeImageSelection, images: Pick<ImageService, 'post' | 'icon'>) {
  const counts = { posts: sourceCounts(), icons: sourceCounts() };
  // One source at a time: post misses fetch once and generate all widths; icons are local-only.
  for (const id of selection.posts.slice(0, 20)) {
    counts.posts.sources++;
    let complete = true;
    for (const width of POST_WIDTHS) {
      const result = await images.post(id, width);
      if ('body' in result) counts.posts.variants.success++;
      else {
        counts.posts.variants.failed++;
        complete = false;
      }
    }
    if (complete) counts.posts.success++;
    else counts.posts.failed++;
  }
  for (const slug of [...new Set(selection.icons)].slice(0, 25)) {
    counts.icons.sources++;
    let complete = true;
    for (const size of ICON_WIDTHS) {
      const result = await images.icon(slug, size);
      if ('body' in result) counts.icons.variants.success++;
      else {
        counts.icons.variants.failed++;
        complete = false;
      }
    }
    if (complete) counts.icons.success++;
    else counts.icons.failed++;
  }
  return counts;
}
async function main() {
  if (process.argv.slice(2).length) throw Error('prewarm-images accepts no arguments');
  const db = createDb(loadConfig().blogDbUrl, { poolSize: 1 });
  try {
    const selected = await loadHomeImages(db.pool);
    console.log(JSON.stringify(await prewarmHomeImages(selected, new ImageService(db.pool))));
  } finally {
    await db.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(() => {
    console.error(JSON.stringify({ error: 'image_prewarm_failed' }));
    process.exitCode = 1;
  });
}
