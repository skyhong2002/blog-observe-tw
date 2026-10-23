import type { Pool, RowDataPacket } from 'mysql2/promise';
import { type GenreItem, type GenreState, genreItems } from './resolve.ts';
import { type TrafficTagItem, tagClient, tagDomain } from './traffic.ts';

// Tags come from traffic.observe.tw (traffic.ts); blog only maps its blogs to their domains. The directory, the
// overview and the admin table read one snapshot of every verified blog's tags, refreshed at most once a minute
// and served up to ten minutes stale when traffic does not answer; a blog page reads its own blog fresh.
const SNAPSHOT_TTL_MS = 60_000;
const SNAPSHOT_STALE_MS = 10 * 60_000;
type Snapshot = { key: string; at: number; domains: Record<string, TrafficTagItem[]> };
let snapshot: Snapshot | null = null;
let pending: { key: string; read: Promise<Snapshot> } | null = null;

/** Drops the snapshot (tests; a later read refetches). */
export function forgetTagSnapshot() {
  snapshot = null;
  pending = null;
}
/** A write's answer is the domain's new tags: the directory shows them at once instead of after the minute. */
export function rememberDomainTags(domain: string, tags: TrafficTagItem[]) {
  if (snapshot) snapshot.domains[domain] = tags;
}

type BlogDomain = { id: number; slug: string; domain: string | null };
const blogDomains = (rows: RowDataPacket[]): BlogDomain[] =>
  rows.map((row) => ({ id: Number(row.id), slug: String(row.slug), domain: tagDomain(row.host) }));
const domainsOf = (blogs: BlogDomain[]) => [...new Set(blogs.flatMap((b) => (b.domain ? [b.domain] : [])))].sort();

/** Every verified blog with its domain, and traffic's tags for all of them (the snapshot). */
async function everyBlogTags(pool: Pick<Pool, 'query'>) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SET STATEMENT max_statement_time=2 FOR SELECT id,slug,canonical_host host FROM blogs WHERE status='verified' LIMIT 20001",
  );
  if (rows.length > 20000) throw Error('genre-read-bound');
  const blogs = blogDomains(rows);
  const domains = domainsOf(blogs);
  const key = domains.join(' ');
  const now = Date.now();
  if (snapshot && snapshot.key === key && now - snapshot.at < SNAPSHOT_TTL_MS) return { blogs, tags: snapshot.domains };
  if (!pending || pending.key !== key) {
    const read = (async () => {
      const tags: Snapshot['domains'] = {};
      // traffic reads at most 2000 domains at a time.
      for (let i = 0; i < domains.length; i += 2000) Object.assign(tags, (await tagClient().read(domains.slice(i, i + 2000))).domains);
      return { key, at: Date.now(), domains: tags };
    })();
    pending = { key, read };
    const settle = () => {
      if (pending?.read === read) pending = null;
    };
    read.then(settle, settle);
  }
  try {
    snapshot = await pending.read;
  } catch (error) {
    // While traffic is down the last answer stands for a while; a blog added since then just has no tags yet.
    if (snapshot && now - snapshot.at < SNAPSHOT_STALE_MS) return { blogs, tags: snapshot.domains };
    throw error;
  }
  return { blogs, tags: snapshot.domains };
}

/** Each verified blog's tags (shown or not), by slug, from a fresh read (≤200 slugs: one traffic request). */
export async function loadBlogGenres(
  pool: Pick<Pool, 'query'>,
  slugs: string[],
  { cached = false }: { cached?: boolean } = {},
): Promise<Map<string, GenreState>> {
  const keys = [...new Set(slugs.filter((slug) => typeof slug === 'string' && slug.length > 0))];
  if (keys.length > 200) throw Error('genre-read-bound');
  const result = new Map<string, GenreState>(keys.map((key) => [key, { status: 'ready', items: [] }]));
  if (!keys.length) return result;
  let blogs: BlogDomain[];
  let tags: Record<string, TrafficTagItem[]>;
  if (cached) {
    ({ blogs, tags } = await everyBlogTags(pool));
    blogs = blogs.filter((b) => result.has(b.slug));
  } else {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SET STATEMENT max_statement_time=1 FOR SELECT id,slug,canonical_host host FROM blogs WHERE status='verified' AND slug IN (?)",
      [keys],
    );
    blogs = blogDomains(rows);
    const domains = domainsOf(blogs);
    tags = domains.length ? (await tagClient().read(domains)).domains : {};
    for (const [domain, list] of Object.entries(tags)) rememberDomainTags(domain, list);
  }
  // A domain traffic does not know (a blog newer than its list) has no tags yet.
  for (const blog of blogs) result.set(blog.slug, { status: 'ready', items: genreItems((blog.domain && tags[blog.domain]) || []) });
  return result;
}

/** Every verified blog's shown tags, for the directory's chips and filter. Keyed by blog id, in traffic's order. */
export async function loadShownGenres(pool: Pick<Pool, 'query'>): Promise<Map<number, GenreItem[]>> {
  const { blogs, tags } = await everyBlogTags(pool);
  const result = new Map<number, GenreItem[]>();
  for (const blog of blogs) {
    const shown = genreItems((blog.domain && tags[blog.domain]) || []).filter((item) => item.visible);
    if (shown.length) result.set(blog.id, shown);
  }
  return result;
}

/** Every verified blog's tags, shown or not, for the admin table, by blog id (the snapshot). */
export async function loadAllGenres(pool: Pick<Pool, 'query'>): Promise<Map<number, GenreItem[]>> {
  const { blogs, tags } = await everyBlogTags(pool);
  const result = new Map<number, GenreItem[]>();
  for (const blog of blogs) {
    const items = genreItems((blog.domain && tags[blog.domain]) || []);
    if (items.length) result.set(blog.id, items);
  }
  return result;
}

export async function readBlogGenres(
  pool: Pick<Pool, 'query'>,
  slugs: string[],
  onFailure: (error: unknown) => void,
  options: { cached?: boolean } = {},
) {
  try {
    return { status: 'ready' as const, blogs: await loadBlogGenres(pool, slugs, options) };
  } catch (error) {
    onFailure(error);
    return { status: 'unavailable' as const, blogs: new Map<string, GenreState>() };
  }
}
