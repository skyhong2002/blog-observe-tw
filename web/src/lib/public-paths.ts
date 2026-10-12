/**
 * The public, cookie-free gateway reads that public pages may share through
 * ISR (server) or same-origin fetches (browser). Pure: no origin, no fetch,
 * safe in client bundles and node --test. Anything not listed here — /api/me,
 * /api/admin, /auth, /me, reader data, other methods — is private and must go
 * through the no-store gateway instead (see server-gateway.ts).
 */

/** Seconds a public page (and its gateway reads) may be served before regenerating. Pages repeat it as a literal. */
export const PUBLIC_REVALIDATE_SECONDS = 120;

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
  'authors',
  'search',
  'topics',
  'topic',
  'relations',
  'traffic',
  'tag',
  'blog',
  'blogRelations',
  'blogTopics',
  'blogInference',
  'blogContent',
] as const;
export type PublicKind = (typeof PUBLIC_KINDS)[number];

type Rule = { kind: PublicKind; path: RegExp; query: readonly string[] };
const blogPath = (tail: string) => new RegExp(`^/api/blogs/${SEGMENT}${tail}$`);
const RULES: readonly Rule[] = [
  { kind: 'overview', path: /^\/api\/overview$/, query: [] },
  { kind: 'catalog', path: /^\/api\/catalog$/, query: ['q', 'category', 'status', 'sort', 'dir', 'page', 'limit'] },
  { kind: 'authors', path: /^\/api\/catalog\/authors$/, query: ['author', 'page', 'limit'] },
  { kind: 'search', path: /^\/api\/search$/, query: ['q', 'page', 'limit', 'blog'] },
  { kind: 'topics', path: /^\/api\/topics$/, query: ['days'] },
  { kind: 'topic', path: new RegExp(`^/api/topics/${SEGMENT}$`), query: ['days'] },
  { kind: 'relations', path: /^\/api\/relations$/, query: ['days'] },
  { kind: 'traffic', path: /^\/api\/traffic$/, query: ['blog'] },
  { kind: 'tag', path: new RegExp(`^/api/tags/${SEGMENT}$`), query: [] },
  { kind: 'blog', path: blogPath(''), query: [] },
  { kind: 'blogRelations', path: blogPath('/relations'), query: ['days'] },
  { kind: 'blogTopics', path: blogPath('/topics'), query: ['days'] },
  { kind: 'blogInference', path: blogPath('/inference'), query: [] },
  { kind: 'blogContent', path: blogPath('/content'), query: [] },
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
  for (const [key, value] of params) {
    if (!rule.query.includes(key) || seen.has(key) || value.length > VALUE_MAX) return null;
    seen.add(key);
  }
  return rule.kind;
}

export const isPublicApiPath = (path: string) => publicKindOf(path) !== null;

/** Throws unless `path` is public; callers build paths with the helpers in public-query.ts. */
export function assertPublicApiPath(path: string): PublicKind {
  const kind = publicKindOf(path);
  if (!kind) throw new Error(`Not a public gateway path: ${path.slice(0, 120)}`);
  return kind;
}
