import type { Pool, RowDataPacket } from 'mysql2/promise';
import { type GenreItem, type GenreState, genreItems } from './resolve.ts';
import { type TrafficTagItem, tagClient, tagDomain } from './traffic.ts';

// Tags come from traffic.observe.tw (traffic.ts); blog only maps its blogs to their domains. The directory, the
// overview, the admin table and every blog page read one snapshot of every verified blog's tags, refreshed at most
// once a minute. Once there is a snapshot no reader waits for traffic: an older one is answered at once while a
// fresh read runs behind it, and stays when that read fails (gen106: the blog page's tag line was the reader's wait
// on a loaded host). Only before the first answer does a request wait, and then it fails as unavailable.
const SNAPSHOT_TTL_MS = 60_000;
type Snapshot = { key: string; at: number; domains: Record<string, TrafficTagItem[]> };
let snapshot: Snapshot | null = null;
let pending: { key: string; read: Promise<Snapshot> } | null = null;

/** Drops the snapshot (tests; a later read refetches). */
export function forgetTagSnapshot() {
  snapshot = null;
  pending = null;
}

type BlogDomain = { id: number; slug: string; domain: string | null };
const blogDomains = (rows: RowDataPacket[]): BlogDomain[] =>
  rows.map((row) => ({ id: Number(row.id), slug: String(row.slug), domain: tagDomain(row.host) }));
const domainsOf = (blogs: BlogDomain[]) => [...new Set(blogs.flatMap((b) => (b.domain ? [b.domain] : [])))].sort();

/** One read of all these domains' tags, shared by every request that needs it while it runs. */
function refresh(key: string, domains: string[]) {
  if (pending?.key === key) return pending.read;
  const read = (async () => {
    const tags: Snapshot['domains'] = {};
    // traffic reads at most 2000 domains at a time.
    for (let i = 0; i < domains.length; i += 2000) Object.assign(tags, (await tagClient().read(domains.slice(i, i + 2000))).domains);
    const next = { key, at: Date.now(), domains: tags };
    snapshot = next;
    return next;
  })();
  pending = { key, read };
  const settle = () => {
    if (pending?.read === read) pending = null;
  };
  read.then(settle, settle);
  return read;
}

/** Every verified blog with its domain, and traffic's tags for all of them (the snapshot). */
async function everyBlogTags(pool: Pick<Pool, 'query'>) {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SET STATEMENT max_statement_time=2 FOR SELECT id,slug,canonical_host host FROM blogs WHERE status='verified' LIMIT 20001",
  );
  if (rows.length > 20000) throw Error('genre-read-bound');
  const blogs = blogDomains(rows);
  const domains = domainsOf(blogs);
  const key = domains.join(' ');
  const fresh = snapshot && snapshot.key === key && Date.now() - snapshot.at < SNAPSHOT_TTL_MS;
  if (snapshot && !fresh) {
    // Answer the last snapshot now; a blog added since then just has no tags until the read behind it lands.
    refresh(key, domains).catch(() => undefined);
    return { blogs, tags: snapshot.domains };
  }
  if (snapshot) return { blogs, tags: snapshot.domains };
  return { blogs, tags: (await refresh(key, domains)).domains };
}

/** Each verified blog's tags (shown or not), by slug, from the snapshot (≤200 slugs). */
export async function loadBlogGenres(pool: Pick<Pool, 'query'>, slugs: string[]): Promise<Map<string, GenreState>> {
  const keys = [...new Set(slugs.filter((slug) => typeof slug === 'string' && slug.length > 0))];
  if (keys.length > 200) throw Error('genre-read-bound');
  const result = new Map<string, GenreState>(keys.map((key) => [key, { status: 'ready', items: [] }]));
  if (!keys.length) return result;
  const { blogs, tags } = await everyBlogTags(pool);
  // A domain traffic does not know (a blog newer than its list) has no tags yet.
  for (const blog of blogs)
    if (result.has(blog.slug)) result.set(blog.slug, { status: 'ready', items: genreItems((blog.domain && tags[blog.domain]) || []) });
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

export async function readBlogGenres(pool: Pick<Pool, 'query'>, slugs: string[], onFailure: (error: unknown) => void) {
  try {
    return { status: 'ready' as const, blogs: await loadBlogGenres(pool, slugs) };
  } catch (error) {
    onFailure(error);
    return { status: 'unavailable' as const, blogs: new Map<string, GenreState>() };
  }
}
