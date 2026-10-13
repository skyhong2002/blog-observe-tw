import { isIP } from 'node:net';
import { articleIdentityKey } from '../crawl/feed.ts';
import { compilePublicationAliases, normalizeLink, publicationDecision, publicationHome } from './identity.ts';

export const TARGET_CANONICAL_VERSION = 'stored-target-canonical-v1' as const;
const validId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const iso = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
/** Selected data properties only, captured once. Extra objects/secrets and accessors are never consumed. */
function fields(raw: unknown, names: readonly string[]): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  try {
    const out: Record<string, unknown> = {};
    for (const name of names) {
      const d = Object.getOwnPropertyDescriptor(raw, name);
      if (!d || !Object.hasOwn(d, 'value')) return null;
      out[name] = d.value;
    }
    return out;
  } catch {
    return null;
  }
}
function list(raw: unknown, max: number): unknown[] | null {
  if (!Array.isArray(raw)) return null;
  try {
    const length = Object.getOwnPropertyDescriptor(raw, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > max) return null;
    const out: unknown[] = [];
    for (let i = 0; i < length; i++) {
      const d = Object.getOwnPropertyDescriptor(raw, String(i));
      if (!d || !Object.hasOwn(d, 'value')) return null;
      out.push(d.value);
    }
    return out;
  } catch {
    return null;
  }
}
function safeUrl(v: unknown): string | null {
  if (typeof v !== 'string' || Buffer.byteLength(v) > 1024) return null;
  const n = normalizeLink(v);
  if (!n) return null;
  if (['platform-root', 'non-publication-host'].includes(publicationDecision(n).reason)) return null;
  let fragment = new URL(v).hash;
  try {
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(fragment);
      if (next === fragment) break;
      fragment = next;
    }
  } catch {
    return null;
  }
  if (/(?:^|[?&#])(?:access_token|token|api_key|apikey|authorization|password|secret|session|signature)=/i.test(fragment)) return null;
  const u = new URL(n);
  if (isIP(u.hostname.replace(/^\[|\]$/g, ''))) return null;
  if (
    [...u.searchParams.keys()].some((k) =>
      /^(?:access_token|token|api_key|apikey|authorization|password|secret|session|signature)$/i.test(k),
    )
  )
    return null;
  let path = u.pathname;
  try {
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(path);
      if (next === path) break;
      path = next;
    }
  } catch {
    return null;
  }
  if (/\/(?:admin|auth|login|my|me|reader)(?:\/|$)/i.test(path)) return null;
  return n;
}
/** These are injected assertions, not a persisted proof schema or verified authentication. */
export type CurrentPublicationAssertion = { blogId: number; url: string; status: string };
export type CurrentArticleAssertion = {
  articleId: number;
  blogId: number;
  url: string;
  publishedAt: string | null;
  status: string;
  ownerVerified: boolean;
};
export type StoredTargetHopAssertion = {
  kind: 'redirect' | 'canonical';
  fromUrl: string;
  toUrl: string;
  status: number;
  fetchId: string;
  sourceFetchUrl: string;
  observedAt: string;
  safe: boolean;
  robotsAllowed: boolean;
  ownerVerified: boolean;
  ownerBindingVerified: boolean;
  fromOwnerBlogId: number | null;
  toOwnerBlogId: number;
};
export type TargetCanonicalInput = {
  originalTargetUrl: string;
  expectedTargetBlogId: number | null;
  registry: readonly CurrentPublicationAssertion[];
  postCandidates: readonly CurrentArticleAssertion[];
  savedObservations: readonly StoredTargetHopAssertion[];
  sourceArticle: CurrentArticleAssertion;
  location: 'body' | 'blogroll' | 'sidebar' | 'comment';
};
export type ResolvedArticle = { articleId: number; blogId: number; url: string; publishedAt: string | null };
export type TargetCanonicalResult = {
  status: 'resolved' | 'unresolved';
  reason: string;
  originalTargetUrl: string | null;
  targetBlogId: number | null;
  targetArticle: ResolvedArticle | null;
  sourceArticle: ResolvedArticle | null;
  location: 'body' | 'blogroll' | 'sidebar' | 'comment' | null;
  observedAt: string | null;
  proofVersion: typeof TARGET_CANONICAL_VERSION;
  trust: 'caller-supplied-current-rows-and-stored-assertions';
};
function article(raw: unknown, now: number): ResolvedArticle | null {
  const v = fields(raw, ['articleId', 'blogId', 'url', 'publishedAt', 'status', 'ownerVerified']);
  if (
    !v ||
    !validId(v.articleId) ||
    !validId(v.blogId) ||
    v.status !== 'public' ||
    v.ownerVerified !== true ||
    !safeUrl(v.url) ||
    (v.publishedAt !== null && (!iso(v.publishedAt) || Date.parse(v.publishedAt) > now))
  )
    return null;
  return { articleId: v.articleId, blogId: v.blogId, url: v.url as string, publishedAt: v.publishedAt as string | null };
}
/** No proof store/authentication/network here. SQL callers must freshly supply public/ownership assertions.
 * Registry is primary current verified publications, never blog_urls aliases or name-based equivalences.
 */
export function resolveTargetCanonical(raw: unknown, now = new Date()): TargetCanonicalResult {
  let nowMs: number;
  try {
    nowMs = Date.prototype.getTime.call(now);
  } catch {
    nowMs = NaN;
  }
  const input = fields(raw, [
    'originalTargetUrl',
    'expectedTargetBlogId',
    'registry',
    'postCandidates',
    'savedObservations',
    'sourceArticle',
    'location',
  ]);
  const base: TargetCanonicalResult = {
    status: 'unresolved',
    reason: 'invalid-input',
    originalTargetUrl: null,
    targetBlogId: null,
    targetArticle: null,
    sourceArticle: null,
    location: null,
    observedAt: null,
    proofVersion: TARGET_CANONICAL_VERSION,
    trust: 'caller-supplied-current-rows-and-stored-assertions',
  };
  if (!input || !Number.isFinite(nowMs)) return base;
  const original = safeUrl(input.originalTargetUrl);
  if (!['body', 'blogroll', 'sidebar', 'comment'].includes(input.location as string)) return base;
  base.location = input.location as TargetCanonicalResult['location'];
  const registry = list(input.registry, 4096),
    candidates = list(input.postCandidates, 10),
    observations = list(input.savedObservations, 10);
  if (!registry || !candidates || !observations || (input.expectedTargetBlogId !== null && !validId(input.expectedTargetBlogId)))
    return base;
  const aliases: { blogId: number; url: string }[] = [],
    inactive = new Set<number>();
  const current = new Set<number>();
  for (const rawRow of registry) {
    const row = fields(rawRow, ['blogId', 'url', 'status']);
    if (!row || !validId(row.blogId) || !safeUrl(row.url) || !publicationHome(row.url as string)) return base;
    if (row.status !== 'verified') {
      inactive.add(row.blogId);
      continue;
    }
    current.add(row.blogId);
    aliases.push({ blogId: row.blogId, url: row.url as string });
  }
  for (const id of inactive) current.delete(id);
  const resolver = compilePublicationAliases(aliases.filter((a) => current.has(a.blogId)));
  const source = article(input.sourceArticle, nowMs);
  if (!source || !current.has(source.blogId) || resolver.resolve(source.url) !== source.blogId)
    return { ...base, reason: 'source-not-current-public' };
  base.sourceArticle = source;
  if (!original) return { ...base, reason: 'unsafe-url' };
  base.originalTargetUrl = input.originalTargetUrl as string;
  const posts: ResolvedArticle[] = [];
  for (const row of candidates) {
    const post = article(row, nowMs);
    if (post && current.has(post.blogId) && resolver.resolve(post.url) === post.blogId) posts.push(post);
  }
  const selectPost = (url: string, owner: number) => {
    const key = articleIdentityKey(url);
    if (!key) return null;
    const matches = posts.filter(
      (p) => p.blogId === owner && new URL(p.url).origin === new URL(url).origin && articleIdentityKey(p.url) === key,
    );
    if (!matches.length) return null;
    const first = matches[0];
    return matches.every((p) => p.articleId === first.articleId && p.url === first.url && p.publishedAt === first.publishedAt)
      ? first
      : null;
  };
  let cursor = original,
    owner = resolver.resolve(original),
    observedAt: string | null = null;
  if (owner !== null && !current.has(owner)) owner = null;
  if (
    input.expectedTargetBlogId !== null &&
    (!current.has(input.expectedTargetBlogId) || (owner !== null && owner !== input.expectedTargetBlogId))
  )
    return { ...base, reason: 'expected-owner-mismatch' };
  if (owner !== null) {
    base.targetBlogId = owner;
    const direct = selectPost(cursor, owner);
    if (direct) return { ...base, status: 'resolved', reason: 'known-exact-current-post', targetArticle: direct };
  }
  if (!observations.length) return { ...base, reason: 'missing-stored-proof' };
  if (observations.length > 5) return { ...base, reason: 'hop-limit' };
  // A list is the complete ordered chain for one saved fetch, not fragments to stitch heuristically.
  let fetchId: string | undefined,
    priorTime = -Infinity,
    redirects = 0,
    canonicalSeen = false;
  const seen = new Set([cursor]);
  for (const rawObservation of observations) {
    const hop = fields(rawObservation, [
      'kind',
      'fromUrl',
      'toUrl',
      'status',
      'fetchId',
      'sourceFetchUrl',
      'observedAt',
      'safe',
      'robotsAllowed',
      'ownerVerified',
      'ownerBindingVerified',
      'fromOwnerBlogId',
      'toOwnerBlogId',
    ]);
    if (
      !hop ||
      !['redirect', 'canonical'].includes(hop.kind as string) ||
      !safeUrl(hop.fromUrl) ||
      !safeUrl(hop.toUrl) ||
      !safeUrl(hop.sourceFetchUrl) ||
      safeUrl(hop.fromUrl) !== cursor ||
      safeUrl(hop.sourceFetchUrl) !== original ||
      typeof hop.fetchId !== 'string' ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(hop.fetchId) ||
      !iso(hop.observedAt) ||
      Date.parse(hop.observedAt) > nowMs ||
      Date.parse(hop.observedAt) < priorTime ||
      hop.safe !== true ||
      hop.robotsAllowed !== true ||
      hop.ownerVerified !== true ||
      hop.ownerBindingVerified !== true ||
      !validId(hop.toOwnerBlogId) ||
      !current.has(hop.toOwnerBlogId) ||
      (hop.fromOwnerBlogId !== null && (!validId(hop.fromOwnerBlogId) || !current.has(hop.fromOwnerBlogId)))
    )
      return { ...base, reason: 'invalid-stored-proof' };
    if (fetchId !== undefined && fetchId !== hop.fetchId) return { ...base, reason: 'fetch-identity-mismatch' };
    fetchId = hop.fetchId;
    if (canonicalSeen) return { ...base, reason: 'canonical-not-terminal' };
    if (hop.kind === 'redirect') {
      if (++redirects > 5 || ![301, 302, 303, 307, 308].includes(hop.status as number)) return { ...base, reason: 'invalid-redirect' };
    } else {
      if (hop.status !== 200 || owner === null || hop.toOwnerBlogId !== owner) return { ...base, reason: 'foreign-canonical' };
      canonicalSeen = true;
    }
    const fromOwner = resolver.resolve(hop.fromUrl as string),
      toOwner = resolver.resolve(hop.toUrl as string);
    // Even an explicit binding cannot override a different currently registered owner.
    if (
      (fromOwner !== null && fromOwner !== hop.fromOwnerBlogId) ||
      (owner !== null && hop.fromOwnerBlogId !== owner) ||
      (toOwner !== null && toOwner !== hop.toOwnerBlogId)
    )
      return { ...base, reason: 'conflicting-owner' };
    const nextKey = safeUrl(hop.toUrl);
    if (!nextKey || seen.has(nextKey)) return { ...base, reason: 'redirect-cycle' };
    seen.add(nextKey);
    cursor = safeUrl(hop.toUrl)!;
    owner = hop.toOwnerBlogId;
    observedAt = hop.observedAt;
    priorTime = Date.parse(hop.observedAt);
  }
  if (owner === null || resolver.resolve(cursor) !== owner) return { ...base, reason: 'terminal-owner-unresolved' };
  if (input.expectedTargetBlogId !== null && owner !== input.expectedTargetBlogId) return { ...base, reason: 'expected-owner-mismatch' };
  const target = selectPost(cursor, owner);
  if (!target) return { ...base, targetBlogId: owner, observedAt, reason: 'terminal-post-missing' };
  return {
    ...base,
    status: 'resolved',
    reason: canonicalSeen ? 'stored-same-owner-canonical' : 'stored-exact-redirect',
    targetBlogId: owner,
    targetArticle: target,
    observedAt,
  };
}
