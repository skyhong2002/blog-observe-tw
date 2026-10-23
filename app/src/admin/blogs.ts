import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { GenreItem } from '../blog-genres/resolve.ts';
import { loadAllGenres } from '../blog-genres/store.ts';
import { type RobotsStatus, robotsFor, robotsStatuses } from '../crawl/robots-observations.ts';

// Every blog row for the 部落格 tab of /admin/ (after tag.observe.tw 66d76690
// /admin/media/): what it is filed as, whether crawling works, how much it
// writes, and how often admins changed it (admin_audits on the blog, genre
// decisions included). Under 1,000 rows, so the browser
// sorts and filters; each part is read once per blog, never per row.

/** Why a blog is or is not being collected; derived, not stored. */
export type CrawlState = 'ok' | 'quiet' | 'failing' | 'never' | 'off';
const QUIET_DAYS = 90;
/** Every feed of the blog failed at least this many times in a row. */
const FAILING_AFTER = 3;

export type AdminBlog = {
  id: number;
  slug: string;
  name: string;
  url: string | null;
  category: string;
  status: string;
  statusLabel: string;
  crawl: CrawlState;
  lastCrawlSuccessAt: string | null;
  lastPublishedAt: string | null;
  feeds: number;
  feedFailures: number;
  scraper: boolean;
  posts: number | null;
  posts7d: number | null;
  /** traffic.observe.tw's tags for the blog's domain, with the ones an admin set or hid marked. */
  genres: Array<Pick<GenreItem, 'genre' | 'label' | 'source' | 'visible'>>;
  manualTags: string[];
  robots: RobotsStatus | null;
  edits: number;
  lastEdit: { at: string; by: string | null; action: string } | null;
};

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

export function crawlState(
  blog: {
    status: string;
    lastCrawlSuccessAt: string | null;
    lastPublishedAt: string | null;
    feeds: number;
    feedFailures: number;
    scraper: boolean;
  },
  now = Date.now(),
): CrawlState {
  if (blog.status !== 'verified') return 'off';
  if (blog.feeds && blog.feedFailures >= FAILING_AFTER && !blog.scraper) return 'failing';
  if (!blog.lastCrawlSuccessAt) return 'never';
  if (!blog.lastPublishedAt || now - Date.parse(blog.lastPublishedAt) > QUIET_DAYS * 86400e3) return 'quiet';
  return 'ok';
}

export async function adminBlogs(pool: Pool) {
  // Literal SQL at every call, so the SQL-writer audit (app/test/topic-writer-audit.spec.ts) sees plain reads.
  const rows = ([r]: [RowDataPacket[], unknown]) => r;
  // Post counts scan the whole posts index; on a cold shared DB they may time out and are then left out.
  const counts = (read: Promise<[RowDataPacket[], unknown]>) =>
    read.then(
      ([r]) => new Map(r.map((x) => [Number(x.blogId), Number(x.n)])),
      () => null,
    );
  const [blogs, posts, posts7d, feeds, scrapers, genres, tags, audits] = await Promise.all([
    pool
      .query<RowDataPacket[]>(
        `SELECT id,slug,name,url,category,status,status_label statusLabel,last_crawl_success_at lastCrawlSuccessAt,
           last_published_at lastPublishedAt FROM blogs ORDER BY id`,
      )
      .then(rows),
    counts(
      pool.query<RowDataPacket[]>('SET STATEMENT max_statement_time=8 FOR SELECT blog_id blogId,COUNT(*) n FROM posts GROUP BY blog_id'),
    ),
    counts(
      pool.query<RowDataPacket[]>(
        'SET STATEMENT max_statement_time=8 FOR SELECT blog_id blogId,COUNT(*) n FROM posts WHERE published_at>=UTC_TIMESTAMP()-INTERVAL 7 DAY AND published_at<=UTC_TIMESTAMP()+INTERVAL 1 DAY GROUP BY blog_id',
      ),
    ),
    pool
      .query<RowDataPacket[]>('SELECT blog_id blogId,COUNT(*) n,MIN(consecutive_failures) failures FROM feed_sources GROUP BY blog_id')
      .then(rows),
    pool
      .query<RowDataPacket[]>("SELECT DISTINCT blog_id blogId FROM blog_scrapers WHERE status='active' AND blog_id IS NOT NULL")
      .then(rows),
    // The table still loads when traffic does not answer; the tag column is then empty and `genresUnavailable` set.
    loadAllGenres(pool).catch(() => null),
    pool
      .query<RowDataPacket[]>(
        "SELECT bt.blog_id blogId,t.label FROM blog_tags bt JOIN tags t ON t.id=bt.tag_id WHERE bt.source_type='manual' AND bt.status='active' ORDER BY t.label",
      )
      .then(rows),
    pool
      .query<RowDataPacket[]>(
        `SELECT a.entity_id blogId,a.action,a.created_at at,u.name,u.email FROM admin_audits a LEFT JOIN users u ON u.id=a.actor_user_id
         WHERE a.entity_type='blog' ORDER BY a.id`,
      )
      .then(rows),
  ]);
  const robots = await robotsStatuses(
    pool,
    blogs.map((b) => b.url),
  ).catch(() => new Map<string, RobotsStatus>());
  const feedOf = new Map(feeds.map((f) => [Number(f.blogId), f]));
  const scraperOf = new Set(scrapers.map((s) => Number(s.blogId)));
  const tagsOf = new Map<number, string[]>();
  for (const t of tags) tagsOf.set(Number(t.blogId), [...(tagsOf.get(Number(t.blogId)) ?? []), String(t.label)]);
  const editsOf = new Map<number, { n: number; last: AdminBlog['lastEdit'] }>();
  for (const e of audits) {
    const blogId = Number(e.blogId);
    const at = iso(e.at);
    if (!Number.isSafeInteger(blogId) || !at) continue;
    const prior = editsOf.get(blogId) ?? { n: 0, last: null };
    prior.n++;
    if (!prior.last || at >= prior.last.at) prior.last = { at, by: e.name ?? e.email ?? null, action: String(e.action) };
    editsOf.set(blogId, prior);
  }
  const now = Date.now();
  return {
    partial: !posts || !posts7d,
    genresUnavailable: !genres,
    blogs: blogs.map((b): AdminBlog => {
      const id = Number(b.id);
      const feed = feedOf.get(id);
      const row = {
        id,
        slug: String(b.slug),
        name: String(b.name),
        url: b.url ?? null,
        category: String(b.category),
        status: String(b.status),
        statusLabel: String(b.statusLabel),
        lastCrawlSuccessAt: iso(b.lastCrawlSuccessAt),
        lastPublishedAt: iso(b.lastPublishedAt),
        feeds: Number(feed?.n ?? 0),
        feedFailures: Number(feed?.failures ?? 0),
        scraper: scraperOf.has(id),
        posts: posts ? (posts.get(id) ?? 0) : null,
        posts7d: posts7d ? (posts7d.get(id) ?? 0) : null,
        genres: (genres?.get(id) ?? []).map(({ genre, label, source, visible }) => ({ genre, label, source, visible })),
        manualTags: tagsOf.get(id) ?? [],
        robots: robotsFor(robots, b.url),
        edits: editsOf.get(id)?.n ?? 0,
        lastEdit: editsOf.get(id)?.last ?? null,
      };
      return { ...row, crawl: crawlState(row, now) };
    }),
  };
}
