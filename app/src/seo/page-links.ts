import type { FastifyInstance } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { TopicResponseCache } from '../topics/cache.ts';
import { historyReadsEnabled } from '../topics/history-contracts.ts';
import { digest, normalizeTerm } from '../topics/policy.ts';
import { publicationExclusionReason } from '../topics/publication-noise.ts';
import { SOURCE } from '../topics/snapshot-client.ts';
import { getPublicPages, isPublicRouteKey, type PublicPageKind } from './page-routes.ts';

export const PAGE_LINK_LIMITS = { references: 1000, nodes: 20000, depth: 24, cacheEntries: 10000, cacheMs: 0, flights: 2000 } as const;
type Ref = { kind: 'blog-slug' | 'blog-id' | 'topic'; value: string };
type Node = Record<string, unknown>;
const keyOf = (ref: Ref) => `${ref.kind}:${ref.value}`;
const topicId = /^(tag:[a-f0-9]{64}|rss:[1-9]\d{0,9})$/;
const numericId = /^[1-9]\d{0,14}$/;
const PAGE_ORIGIN = 'https://blog.observe.tw';
// Route allowlist, not a generic /api hook: never traverse credentials, admin
// evidence, page-registry responses, OpenAPI, sessions or arbitrary plugin DTOs.
export function pageLinksEndpoint(path: string): boolean {
  return /^\/api\/(?:overview|mentions|catalog(?:\/authors)?|search|traffic|relations|me\/follows|tags\/[^/]+|blogs(?:\/[^/]+(?:\/(?:topics|relations))?)?|topics(?:\/[^/]+)?|v1\/(?:articles|relations|blogs(?:\/[^/]+(?:\/(?:articles|relations))?)?|topics(?:\/[^/]+)?))$/.test(
    path,
  );
}
function blogContainer(path: string, container: string): boolean {
  if (['blog', 'blogs', 'recentBlogs', 'follows'].includes(container)) return true;
  if (container === 'nodes' && /\/relations$/.test(path)) return true;
  return container === 'items' && path === '/api/v1/blogs';
}
const plain = (value: unknown): value is Node => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Fixed-count queries; all paths are minted by the registry helper, never labels. */
async function loadLinks(pool: Pool, refs: Ref[]): Promise<Map<string, string>> {
  const entities = new Map<string, string>();
  for (const kind of ['blog', 'topic'] as PublicPageKind[]) {
    const selected = refs.filter((r) => r.kind === (kind === 'blog' ? 'blog-slug' : 'topic'));
    if (!selected.length) continue;
    const keys = selected.map((r) => r.value);
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT route_key,entity_id FROM public_route_keys WHERE kind=? AND route_key IN (?) AND BINARY route_key IN (?)',
      [kind, keys, keys],
    );
    const requested = new Map(selected.map((r) => [r.value, keyOf(r)]));
    for (const row of rows) {
      const key = requested.get(row.route_key);
      if (key) entities.set(key, String(row.entity_id));
    }
  }
  const blogSlugs = refs.filter((r) => r.kind === 'blog-slug' && !entities.has(keyOf(r)));
  if (blogSlugs.length) {
    const slugs = blogSlugs.map((r) => r.value);
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id,slug FROM blogs WHERE slug IN (?) AND BINARY slug IN (?) AND status='verified'",
      [slugs, slugs],
    );
    for (const row of rows) entities.set(keyOf({ kind: 'blog-slug', value: row.slug }), String(row.id));
  }
  const hashes = refs
    .filter((r) => r.kind === 'topic' && r.value.startsWith('tag:') && !entities.has(keyOf(r)))
    .map((r) => r.value.slice(4));
  if (hashes.length) {
    const [rows] = await pool.query<RowDataPacket[]>(
      historyReadsEnabled()
        ? 'SELECT canonical_id id FROM topic_pages WHERE canonical_id IN (?)'
        : 'SELECT t.id FROM topic_canonical_terms_v3 t JOIN topic_current c ON c.source=? AND c.snapshot_id=t.snapshot_id WHERE t.id IN (?)',
      historyReadsEnabled() ? [hashes] : [SOURCE, hashes],
    );
    for (const row of rows) entities.set(`topic:tag:${row.id}`, String(row.id));
    const missing = hashes.filter((id) => !entities.has(`topic:tag:${id}`));
    if (missing.length) {
      const [aliases] = await pool.query<RowDataPacket[]>(
        'SELECT a.term_id,a.canonical_id FROM topic_term_aliases_v3 a JOIN topic_current c ON c.source=? AND c.snapshot_id=a.snapshot_id WHERE a.term_id IN (?)',
        [SOURCE, missing],
      );
      for (const row of aliases) entities.set(`topic:tag:${row.term_id}`, String(row.canonical_id));
    }
  }
  const rss = refs.filter((r) => r.kind === 'topic' && r.value.startsWith('rss:'));
  // A persisted route key cannot bypass the RSS tag's current visibility.
  for (const ref of rss) entities.delete(keyOf(ref));
  if (rss.length) {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id,label FROM tags WHERE id IN (?) AND visibility='public' AND status='active'",
      [rss.map((r) => r.value.slice(4))],
    );
    for (const row of rows) entities.set(`topic:rss:${row.id}`, digest(normalizeTerm(row.label)));
  }
  for (const ref of refs) if (ref.kind === 'blog-id') entities.set(keyOf(ref), ref.value);
  if (historyReadsEnabled()) {
    const ids = [
      ...new Set(
        refs
          .filter((r) => r.kind === 'topic')
          .map((r) => entities.get(keyOf(r)))
          .filter((id): id is string => !!id),
      ),
    ];
    const graph = new Map<string, { state: string; target: string | null }>();
    let pending = ids;
    for (let depth = 0; depth < 16 && pending.length; depth++) {
      const [rows] = await pool.query<RowDataPacket[]>('SELECT canonical_id,state,merged_into FROM topic_pages WHERE canonical_id IN (?)', [
        pending,
      ]);
      const next = new Set<string>();
      for (const row of rows) {
        graph.set(row.canonical_id, { state: row.state, target: row.merged_into });
        if (row.state === 'merged' && /^[a-f0-9]{64}$/.test(row.merged_into ?? '') && !graph.has(row.merged_into))
          next.add(row.merged_into);
      }
      pending = [...next];
    }
    for (const [key, original] of entities) {
      if (!key.startsWith('topic:')) continue;
      let id = original;
      const visited = new Set<string>();
      while (graph.get(id)?.state === 'merged' && !visited.has(id)) {
        visited.add(id);
        id = graph.get(id)?.target ?? '';
      }
      if (!id || graph.get(id)?.state === 'merged') entities.delete(key);
      else entities.set(key, id);
    }
  }
  const result = new Map<string, string>();
  for (const kind of ['blog', 'topic'] as PublicPageKind[]) {
    const selected = refs.filter((r) => (r.kind === 'topic') === (kind === 'topic'));
    const ids = selected.map((r) => entities.get(keyOf(r))).filter((id): id is string => !!id);
    if (!ids.length) continue;
    const pages = await getPublicPages(pool, kind, ids);
    for (const ref of selected) {
      const id = entities.get(keyOf(ref));
      const page = id ? pages.get(id) : null;
      // Moved/unregistered/non-public entities retain their original link. The
      // HTML resolver handles moved ownership; enrichment never guesses it.
      if (page) result.set(keyOf(ref), page.canonicalPath);
    }
  }
  return result;
}

/** Canonical URLs are stable, but public eligibility is not. Never retain a
 * hidden publication's successful route resolution across completed requests. */
const flights = new WeakMap<Pool, TopicResponseCache>();
async function cachedLinks(pool: Pool, refs: Ref[]): Promise<Map<string, string>> {
  let cache = flights.get(pool);
  if (!cache) {
    cache = new TopicResponseCache();
    flights.set(pool, cache);
  }
  try {
    return await cache.get(refs.map(keyOf).sort().join('|'), () => loadLinks(pool, refs));
  } catch {
    return new Map();
  }
}

/** Copy-on-write preserves cached DTOs and every existing ID, slug and icon. */
export async function enrichPageLinks(pool: Pool, path: string, payload: unknown): Promise<unknown> {
  if (!pageLinksEndpoint(path) || (!plain(payload) && !Array.isArray(payload))) return payload;
  const refs = new Map<string, Ref>();
  const targets = new Map<Node, Map<string, string>>();
  const publicBlogNodes = new Map<Node, string>();
  const publicTopicNodes = new Map<Node, string>();
  const seen = new WeakSet<object>();
  let visited = 0;
  let overBudget = false;
  const add = (node: Node, field: string, ref: Ref) => {
    const key = keyOf(ref);
    if (!refs.has(key) && refs.size >= PAGE_LINK_LIMITS.references) return;
    refs.set(key, ref);
    if (!targets.has(node)) targets.set(node, new Map());
    targets.get(node)!.set(field, key);
  };
  const walk = (value: unknown, container: string, depth: number) => {
    if (++visited > PAGE_LINK_LIMITS.nodes || depth > PAGE_LINK_LIMITS.depth) {
      overBudget = true;
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        if (overBudget) break;
        walk(item, container, depth + 1);
      }
      return;
    }
    if (!plain(value)) return;
    if (
      typeof value.slug === 'string' &&
      typeof value.name === 'string' &&
      blogContainer(path, container) &&
      isPublicRouteKey('blog', value.slug)
    ) {
      add(value, 'canonicalPath', { kind: 'blog-slug', value: value.slug });
      if ((path === '/api/v1/blogs' && container === 'items') || (/^\/api\/v1\/blogs\/[^/]+$/.test(path) && container === 'blog'))
        publicBlogNodes.set(value, `/blogs/${encodeURIComponent(value.slug)}/`);
    }
    if (typeof value.blogSlug === 'string' && isPublicRouteKey('blog', value.blogSlug))
      add(value, 'blogCanonicalPath', { kind: 'blog-slug', value: value.blogSlug });
    for (const [idField, pathField] of [
      ['blogId', 'blogCanonicalPath'],
      ['sourceBlogId', 'sourceBlogCanonicalPath'],
      ['targetBlogId', 'targetBlogCanonicalPath'],
    ] as const) {
      const id = value[idField];
      if ((typeof id === 'number' || typeof id === 'string') && numericId.test(String(id)))
        add(value, pathField, { kind: 'blog-id', value: String(id) });
    }
    if (
      typeof value.id === 'string' &&
      topicId.test(value.id) &&
      typeof value.label === 'string' &&
      !publicationExclusionReason(value.label)
    ) {
      add(value, 'canonicalPath', { kind: 'topic', value: value.id });
      if (/^\/api\/v1\/topics(?:\/[^/]+)?$/.test(path)) publicTopicNodes.set(value, `/topics/${encodeURIComponent(value.id)}/`);
    }
    for (const property in value) {
      if (overBudget) break;
      if (Object.hasOwn(value, property)) walk(value[property], property, depth + 1);
    }
  };
  walk(payload, '', 0);
  if (overBudget || !refs.size) return payload;
  const links = await cachedLinks(pool, [...refs.values()]);
  if (!links.size && !publicBlogNodes.size && !publicTopicNodes.size) return payload;
  // Traverse only the bounded graph visited above. Large untouched subtrees are
  // shared; no stringify/parse or deep clone of article bodies is necessary.
  const copies = new WeakMap<object, unknown>();
  const copy = (value: unknown): unknown => {
    if (!value || typeof value !== 'object' || !seen.has(value)) return value;
    if (copies.has(value)) return copies.get(value);
    if (!Array.isArray(value) && !plain(value)) return value;
    const output = Array.isArray(value) ? value.slice() : { ...value };
    copies.set(value, output);
    let changed = false;
    if (plain(value))
      for (const [field, key] of targets.get(value) ?? []) {
        const link = links.get(key);
        if (link && value[field] !== link) {
          (output as Node)[field] = link;
          changed = true;
        }
      }
    if (plain(value) && (publicBlogNodes.has(value) || publicTopicNodes.has(value))) {
      const reference = targets.get(value)?.get('canonicalPath');
      // Public v1 explicitly changed blog.url to the local page on 2026-10-12.
      // Keep source URL separately; internal DTOs and article.url are untouched.
      const fallback = publicBlogNodes.get(value) ?? publicTopicNodes.get(value)!;
      const canonicalUrl = PAGE_ORIGIN + ((reference && links.get(reference)) || fallback);
      if (publicBlogNodes.has(value))
        (output as Node).sourceUrl = Object.hasOwn(value, 'sourceUrl') ? value.sourceUrl : (value.url ?? null);
      (output as Node).url = canonicalUrl;
      changed = true;
    }
    for (const property of Object.keys(value)) {
      const previous = (value as Node)[property];
      if (!previous || typeof previous !== 'object' || !seen.has(previous)) continue;
      const next = copy(previous);
      if (next !== previous) {
        (output as Node)[property] = next;
        changed = true;
      }
    }
    if (!changed) copies.set(value, value);
    return changed ? output : value;
  };
  return copy(payload);
}

export function registerPageLinks(app: FastifyInstance, pool: Pool) {
  app.addHook('preSerialization', async (request, reply, payload) => {
    if (!['GET', 'HEAD'].includes(request.method) || reply.statusCode !== 200) return payload;
    const path = request.url.split('?')[0];
    // Do not alter Cache-Control/Vary or authentication. /api/me/follows remains
    // private and no-store; route eligibility is rechecked on every completed request.
    try {
      return await enrichPageLinks(pool, path, payload);
    } catch {
      return payload;
    }
  });
}
