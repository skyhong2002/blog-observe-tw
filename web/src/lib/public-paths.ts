/**
 * The public, cookie-free gateway reads that public pages make on the server
 * (public-api.ts) or as same-origin fetches in the browser (public-loader.ts),
 * every one of them no-store (public-read.ts). Pure: no origin, no fetch,
 * safe in client bundles and node --test. Anything not listed here — /api/me,
 * /api/admin, /auth, /me, reader data, other methods — is private and must go
 * through the no-store gateway instead (see server-gateway.ts).
 */

/** Longest query value accepted; the gateway clamps its own inputs further. */
const VALUE_MAX = 300;
/** Room for every catalog key at VALUE_MAX percent-encoded CJK characters. */
const PATH_MAX = 8192;
/** One encoded path segment: no slash, dot-only segments are rejected separately. */
const SEGMENT = '[^/?#\\\\]{1,765}';

/** Which payload a public path answers with; public-contracts.ts checks each kind. */
export const PUBLIC_KINDS = [
  'overview',
  'catalog',
  'collectionCount',
  'authors',
  'search',
  'topics',
  'topic',
  'relations',
  'traffic',
  'tag',
  'blog',
  'blogRelations',
  'blogMentions',
  'blogTopics',
  'blogInference',
  'blogContent',
  'tech',
  'blogTech',
  'blogPage',
  'topicPage',
  'homeOverview',
  'homeTopics',
  'blogQueue',
  'mentions',
] as const;
export type PublicKind = (typeof PUBLIC_KINDS)[number];

/**
 * `views`: the only `?view=` values a rule takes, each answering with its own kind (and contract). Exact text,
 * once; any other value, or `view` on a rule without views, is not a public path.
 */
type Rule = { kind: PublicKind; path: RegExp; query: readonly string[]; views?: Readonly<Record<string, PublicKind>> };
const blogPath = (tail: string) => new RegExp(`^/api/blogs/${SEGMENT}${tail}$`);
const RULES: readonly Rule[] = [
  // view=home: the homepage's bounded projections (app/src/app.js, overview.js; topics/routes.ts).
  { kind: 'overview', path: /^\/api\/overview$/, query: [], views: { home: 'homeOverview' } },
  { kind: 'catalog', path: /^\/api\/catalog$/, query: ['q', 'category', 'genre', 'status', 'kind', 'sort', 'dir', 'page', 'limit'] },
  { kind: 'collectionCount', path: /^\/api\/collection-count$/, query: [] },
  { kind: 'authors', path: /^\/api\/catalog\/authors$/, query: ['author', 'page', 'limit'] },
  { kind: 'search', path: /^\/api\/search$/, query: ['q', 'page', 'limit', 'blog'] },
  { kind: 'topics', path: /^\/api\/topics$/, query: ['days', 'order'], views: { home: 'homeTopics' } },
  { kind: 'topic', path: new RegExp(`^/api/topics/${SEGMENT}$`), query: ['days', 'historyCursor'] },
  { kind: 'relations', path: /^\/api\/relations$/, query: ['days'] },
  // /mentions/: the homepage's body citations as a feed, older pages by cursor (app/src/relations/home-feed.ts).
  { kind: 'mentions', path: /^\/api\/mentions$/, query: ['cursor'] },
  { kind: 'traffic', path: /^\/api\/traffic$/, query: ['blog'] },
  { kind: 'tag', path: new RegExp(`^/api/tags/${SEGMENT}$`), query: [] },
  { kind: 'blog', path: blogPath(''), query: [] },
  { kind: 'blogRelations', path: blogPath('/relations'), query: ['days'] },
  { kind: 'blogMentions', path: blogPath('/mentions'), query: [] },
  { kind: 'blogTopics', path: blogPath('/topics'), query: ['days'] },
  { kind: 'blogInference', path: blogPath('/inference'), query: [] },
  { kind: 'blogContent', path: blogPath('/content'), query: [] },
  // Passive technology observations (app/src/tech/routes.ts); the gateway answers 404 while they are off.
  { kind: 'tech', path: /^\/api\/tech$/, query: ['q', 'technology', 'status', 'limit', 'cursor'] },
  { kind: 'blogTech', path: blogPath('/tech'), query: [] },
  // Page registry reads (app/src/seo/page-api.ts): one encoded key, no query.
  { kind: 'blogPage', path: new RegExp(`^/api/pages/blogs/${SEGMENT}$`), query: [] },
  { kind: 'topicPage', path: new RegExp(`^/api/pages/topics/${SEGMENT}$`), query: [] },
  // The public 待查清單 (app/src/blog-suggestions.ts loadBlogQueue).
  { kind: 'blogQueue', path: /^\/api\/blog-queue$/, query: ['q', 'state', 'source', 'page', 'sort', 'dir'] },
];

/** Never public, whatever a rule above might match. */
const PRIVATE = /^\/(?:api\/(?:me|admin|reader|auth)|auth|me|admin|reader)(?:[/?#]|$)/i;

/**
 * The payload kind when `path` is a same-origin public GET path, else null:
 * starts with a single `/`, matches a rule, carries only that rule's query
 * keys (each once, bounded), and has no encoded slash, dot segment, backslash,
 * fragment or control text that could reach a different gateway route.
 */
export function publicKindOf(path: string): PublicKind | null {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.length > PATH_MAX) return null;
  if (/[\\#\s\p{Cc}]/u.test(path) || PRIVATE.test(path)) return null;
  const [pathname, search = '', ...extra] = path.split('?');
  if (extra.length) return null;
  const decoded: string[] = [];
  for (const segment of pathname.split('/').slice(1)) {
    let text: string;
    try {
      text = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (!text || text === '.' || text === '..' || /[/\\?#\s\p{Cc}]/u.test(text)) return null;
    decoded.push(text);
  }
  if (PRIVATE.test(`/${decoded.join('/')}`)) return null;
  const rule = RULES.find((candidate) => candidate.path.test(pathname));
  if (!rule) return null;
  if (!search) return path.endsWith('?') ? null : rule.kind;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  const seen = new Set<string>();
  let kind = rule.kind;
  for (const [key, value] of params) {
    if (seen.has(key) || value.length > VALUE_MAX) return null;
    seen.add(key);
    if (key === 'view') {
      if (!rule.views || !Object.hasOwn(rule.views, value)) return null;
      kind = rule.views[value];
    } else if (!rule.query.includes(key)) return null;
  }
  return kind;
}

export const isPublicApiPath = (path: string) => publicKindOf(path) !== null;

/** Throws unless `path` is public; callers build paths with the helpers in public-query.ts. */
export function assertPublicApiPath(path: string): PublicKind {
  const kind = publicKindOf(path);
  if (!kind) throw new Error(`Not a public gateway path: ${path.slice(0, 120)}`);
  return kind;
}
