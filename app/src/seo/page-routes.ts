import { createHash } from 'node:crypto';
import { domainToUnicode } from 'node:url';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { withJobLease } from '../jobs/lease.ts';
import { publicationHome } from '../relations/identity.ts';
import { SOURCE } from '../topics/snapshot-client.ts';

export type PublicPageKind = 'blog' | 'topic';
export type PublicPage = { entityId: string; stableId: string; slug: string; canonicalPath: string };
export type BackfillOptions = { afterId?: string; limit?: number; missingOnly?: boolean };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const count = (n: number | undefined) => Math.max(1, Math.min(500, Math.floor(Number.isFinite(n) ? n! : 100)));
const entityPattern = (kind: PublicPageKind) => (kind === 'blog' ? /^[1-9]\d{0,14}$/ : /^[a-f0-9]{64}$/);
const kindValid = (kind: unknown): kind is PublicPageKind => kind === 'blog' || kind === 'topic';
/** Already-decoded segments only; never decode twice or permit path/query/control delimiters. */
export function isPublicRouteKey(kind: PublicPageKind, key: string): boolean {
  if (!kindValid(kind) || typeof key !== 'string' || [...key].length > 180) return false;
  if (kind === 'topic' && /^(tag:[a-f0-9]{64}|rss:[1-9]\d{0,9})$/.test(key)) return true;
  if (kind === 'blog' && /^[a-z0-9][a-z0-9_-]{0,179}$/.test(key)) return true; // Existing API slug contract, including terminal separators.
  return /^[\p{L}\p{N}][\p{L}\p{M}\p{N}._-]*$/u.test(key) && !key.includes('..') && !/[._-]$/.test(key);
}
export function readableSlug(text: string): string {
  return [
    ...text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}._-]+/gu, '-')
      .replace(/\.{2,}/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[^\p{L}\p{N}]+|[._-]+$/gu, ''),
  ]
    .slice(0, 120)
    .join('')
    .replace(/[._-]+$/u, '');
}
export function proposedBlogSlug(blog: { slug: string; url?: string | null; name: string }): string {
  if (!/^discovered-/.test(blog.slug) && isPublicRouteKey('blog', blog.slug)) return blog.slug;
  try {
    const home = blog.url ? publicationHome(blog.url) : null;
    if (home) {
      const parsed = new URL(home);
      const owner = parsed.pathname === '/' ? '' : decodeURIComponent(parsed.pathname);
      const candidate = readableSlug(
        domainToUnicode(parsed.hostname.replace(/^www\./, '')) +
          owner +
          (parsed.searchParams.get('owner') ? `-${parsed.searchParams.get('owner')}` : ''),
      );
      if (candidate) return candidate;
    }
  } catch {
    /* Invalid/non-publication URLs use the retained name, never a network request. */
  }
  return readableSlug(blog.name) || 'blog';
}
function page(kind: PublicPageKind, row: RowDataPacket): PublicPage {
  return {
    entityId: String(row.entity_id),
    stableId: String(row.stable_id),
    slug: row.canonical_key,
    canonicalPath: `/${kind === 'blog' ? 'blogs' : 'topics'}/${encodeURIComponent(row.canonical_key)}/`,
  };
}
/** A moved source is only resolved through explicit URL ownership, never a name/domain guess. */
async function movedTarget(pool: Pool | PoolConnection, id: string): Promise<string | null> {
  const [targets] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT b.id FROM blogs old JOIN blogs b ON b.status='verified' AND b.id<>old.id
     LEFT JOIN blog_urls u ON u.blog_id=b.id
     WHERE old.id=? AND old.status='moved' AND old.url IS NOT NULL AND (BINARY b.url=BINARY old.url OR BINARY u.url=BINARY old.url) LIMIT 2`,
    [id],
  );
  return targets.length === 1 ? String(targets[0].id) : null;
}
export async function getPublicPages(pool: Pool, kind: PublicPageKind, entityIds: readonly string[]): Promise<Map<string, PublicPage>> {
  if (!kindValid(kind)) return new Map();
  const ids = [...new Set(entityIds.filter((id) => entityPattern(kind).test(id)))];
  if (ids.length > 1000) throw Error('public_page_lookup_limit');
  if (!ids.length) return new Map();
  const [rows] = await pool.query<RowDataPacket[]>(
    kind === 'blog'
      ? `SELECT r.entity_id,r.canonical_key,b.slug stable_id FROM public_page_routes r JOIN blogs b ON b.id=r.entity_id WHERE r.kind='blog' AND r.entity_id IN (?) AND b.status<>'moved'`
      : `SELECT r.entity_id,r.canonical_key,CONCAT('tag:',r.entity_id) stable_id FROM public_page_routes r JOIN topic_current c ON c.source=? JOIN topic_canonical_terms_v3 t ON t.snapshot_id=c.snapshot_id AND t.id=r.entity_id WHERE r.kind='topic' AND r.entity_id IN (?)`,
    kind === 'blog' ? [ids] : [SOURCE, ids],
  );
  return new Map(rows.filter((r) => isPublicRouteKey(kind, r.canonical_key)).map((r) => [String(r.entity_id), page(kind, r)]));
}
export async function resolvePublicPage(pool: Pool, kind: PublicPageKind, key: string): Promise<PublicPage | null> {
  if (!isPublicRouteKey(kind, key)) return null;
  const [[registered]] = await pool.query<RowDataPacket[]>('SELECT entity_id FROM public_route_keys WHERE kind=? AND route_key=?', [
    kind,
    key,
  ]);
  let id: string | null = registered ? String(registered.entity_id) : null;
  // Legacy IDs remain readable before/after a backfill, but this resolver never creates routes.
  if (!id && kind === 'blog') {
    const [[blog]] = await pool.query<RowDataPacket[]>('SELECT id FROM blogs WHERE BINARY slug=BINARY ? LIMIT 1', [key]);
    id = blog ? String(blog.id) : null;
  }
  if (!id && kind === 'topic' && /^tag:[a-f0-9]{64}$/.test(key)) {
    // Two bounded index lookups instead of OR across every canonical/alias in a large snapshot.
    const [[canonical]] = await pool.query<RowDataPacket[]>(
      'SELECT t.id FROM topic_canonical_terms_v3 t JOIN topic_current c ON c.snapshot_id=t.snapshot_id AND c.source=? WHERE t.id=? LIMIT 1',
      [SOURCE, key.slice(4)],
    );
    if (canonical) id = String(canonical.id);
    else {
      const [[alias]] = await pool.query<RowDataPacket[]>(
        'SELECT a.canonical_id FROM topic_term_aliases_v3 a JOIN topic_current c ON c.snapshot_id=a.snapshot_id AND c.source=? WHERE a.term_id=? LIMIT 1',
        [SOURCE, key.slice(4)],
      );
      id = alias ? String(alias.canonical_id) : null;
    }
  }
  if (kind === 'topic' && /^rss:[1-9]\d{0,9}$/.test(key)) {
    const [[tag]] = await pool.query<RowDataPacket[]>("SELECT label FROM tags WHERE id=? AND status='active' AND visibility='public'", [
      key.slice(4),
    ]);
    if (!tag) return null;
    if (tag) {
      const { normalizeTerm } = await import('../topics/policy.ts');
      id = hash(normalizeTerm(tag.label));
    }
  }
  if (!id) return null;
  if (kind === 'blog') {
    const [[blog]] = await pool.query<RowDataPacket[]>('SELECT status FROM blogs WHERE id=?', [id]);
    if (blog?.status === 'moved') id = await movedTarget(pool, id);
  }
  if (!id) return null;
  return (await getPublicPages(pool, kind, [id])).get(id) ?? null;
}
async function claim(c: PoolConnection, kind: PublicPageKind, key: string, entityId: string): Promise<boolean> {
  if (!isPublicRouteKey(kind, key)) return false;
  const [[existing]] = await c.query<RowDataPacket[]>('SELECT entity_id FROM public_route_keys WHERE kind=? AND route_key=? FOR UPDATE', [
    kind,
    key,
  ]);
  if (existing) return String(existing.entity_id) === entityId;
  await c.execute('INSERT INTO public_route_keys(kind,route_key,entity_id,created_at) VALUES (?,?,?,UTC_TIMESTAMP())', [
    kind,
    key,
    entityId,
  ]);
  return true;
}
async function register(
  pool: Pool,
  kind: PublicPageKind,
  entityId: string,
  preferred: string,
  legacy: string,
  assertLease: () => Promise<void>,
) {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[existing]] = await c.query<RowDataPacket[]>(
      'SELECT canonical_key FROM public_page_routes WHERE kind=? AND entity_id=? FOR UPDATE',
      [kind, entityId],
    );
    if (existing) {
      if (!(await claim(c, kind, legacy, entityId))) throw Error('public_legacy_route_conflict');
      await assertLease();
      await c.commit();
      return;
    }
    if (!(await claim(c, kind, legacy, entityId))) throw Error('public_legacy_route_conflict');
    const base = [...(readableSlug(preferred) || (kind === 'blog' ? 'blog' : 'topic'))].slice(0, 110).join('');
    let canonical: string | null = null;
    // Existing API blog slugs reserve their names even before their own route backfill.
    for (const suffix of [
      '',
      `-${hash(`${kind}:${entityId}`).slice(0, 8)}`,
      `-${hash(`${kind}:${entityId}`).slice(0, 16)}`,
      `-${hash(`${kind}:${entityId}`)}`,
    ]) {
      const candidate = `${base}${suffix}`;
      const [[reserved]] =
        kind === 'blog'
          ? await c.query<RowDataPacket[]>('SELECT id FROM blogs WHERE BINARY slug=BINARY ? AND id<>? LIMIT 1', [candidate, entityId])
          : [[]];
      if (!reserved && (await claim(c, kind, candidate, entityId))) {
        canonical = candidate;
        break;
      }
    }
    if (!canonical) throw Error('public_route_collision_exhausted');
    await c.execute('INSERT INTO public_page_routes(kind,entity_id,canonical_key,created_at) VALUES (?,?,?,UTC_TIMESTAMP())', [
      kind,
      entityId,
      canonical,
    ]);
    await assertLease();
    await c.commit();
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
export async function backfillPublicRoutes(pool: Pool, options: BackfillOptions & { kind: PublicPageKind }) {
  if (!kindValid(options.kind)) throw Error('invalid_public_page_kind');
  const { kind } = options,
    limit = count(options.limit),
    afterId = options.afterId ?? '';
  if (afterId && !entityPattern(kind).test(afterId)) throw Error('invalid_public_page_cursor');
  return (
    (await withJobLease(pool, 'public-routes', async (assertLease) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        kind === 'blog'
          ? `SELECT b.id,b.slug,b.name,b.url FROM blogs b WHERE b.status<>'moved' AND b.id>? ${options.missingOnly ? "AND NOT EXISTS (SELECT 1 FROM public_page_routes r WHERE r.kind='blog' AND r.entity_id=CAST(b.id AS CHAR))" : ''} ORDER BY b.id LIMIT ${limit}`
          : `SELECT t.id,t.label FROM topic_canonical_terms_v3 t JOIN topic_current c ON c.snapshot_id=t.snapshot_id AND c.source=? WHERE t.id>? ${options.missingOnly ? "AND NOT EXISTS (SELECT 1 FROM public_page_routes r WHERE r.kind='topic' AND r.entity_id=t.id)" : ''} ORDER BY t.id LIMIT ${limit}`,
        kind === 'blog' ? [afterId || '0'] : [SOURCE, afterId],
      );
      for (const row of rows) {
        await assertLease();
        await register(
          pool,
          kind,
          String(row.id),
          kind === 'blog' ? proposedBlogSlug({ slug: row.slug, name: row.name, url: row.url }) : row.label,
          kind === 'blog' ? row.slug : `tag:${row.id}`,
          assertLease,
        );
      }
      return { status: 'ok', processed: rows.length, nextCursor: rows.length === limit ? String(rows.at(-1)!.id) : null };
    })) ?? { status: 'busy', processed: 0, nextCursor: afterId || null }
  );
}
/** Separate cursor bounds source-alias persistence without collecting all aliases of a popular term. */
export async function backfillTopicRouteAliases(pool: Pool, options: BackfillOptions = {}) {
  const limit = count(options.limit),
    afterId = options.afterId ?? '';
  if (afterId && !/^[a-f0-9]{64}$/.test(afterId)) throw Error('invalid_public_alias_cursor');
  return (
    (await withJobLease(pool, 'public-routes', async (assertLease) => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT a.term_id,a.canonical_id FROM topic_term_aliases_v3 a JOIN topic_current c ON c.snapshot_id=a.snapshot_id AND c.source=? JOIN public_page_routes r ON r.kind='topic' AND r.entity_id=a.canonical_id WHERE a.term_id>? ${options.missingOnly ? "AND NOT EXISTS (SELECT 1 FROM public_route_keys k WHERE k.kind='topic' AND k.route_key=CONCAT('tag:',a.term_id))" : ''} ORDER BY a.term_id LIMIT ${limit}`,
        [SOURCE, afterId],
      );
      for (const row of rows) {
        const c = await pool.getConnection();
        try {
          await c.beginTransaction();
          if (!(await claim(c, 'topic', `tag:${row.term_id}`, row.canonical_id))) throw Error('public_topic_alias_conflict');
          await assertLease();
          await c.commit();
        } catch (error) {
          await c.rollback();
          throw error;
        } finally {
          c.release();
        }
      }
      return { status: 'ok', processed: rows.length, nextCursor: rows.length === limit ? (rows.at(-1)!.term_id as string) : null };
    })) ?? { status: 'busy', processed: 0, nextCursor: afterId || null }
  );
}
