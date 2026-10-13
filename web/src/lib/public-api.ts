import 'server-only';
import { cache } from 'react';
import type { AuthorCatalog, AuthorCatalogQuery, Blog, Catalog, CatalogQuery, Overview, Post } from './api';
import { type PageKind, type PublicPageInfo, pageApiPath, pageInfoOf, pageKeyOfParam } from './page-links';
import { authorApiPath, catalogApiPath, HOME_OVERVIEW_PATH } from './public-query';
import { PublicGatewayError, readPublic } from './public-read';
import { gatewayOrigin } from './server-gateway';

/**
 * Reads for the public pages: GETs of the public, cookie-free gateway paths in
 * public-paths.ts, every one `cache: 'no-store'` (public-read.ts), for pages
 * that are all force-dynamic. Nothing is kept across requests: whether an
 * article may be shown is the gateway's answer to this request. There is no
 * init or header parameter.
 *
 * Failures, including a 200 missing the fields public-contracts.ts requires,
 * throw instead of returning empty data (rules in public-read.ts), so the
 * request fails rather than rendering a wrong page. Only publicJsonOrNull
 * turns a 404, from a path where 404 means "no such thing", into data (null).
 */

/** One read per path per request (generateMetadata and the page share it); React's cache never spans requests. */
const read = cache((path: string) => readPublic(gatewayOrigin(), path));

/** A public read that must succeed; any non-2xx (404 included) throws. */
export async function publicJson<T>(path: string): Promise<T> {
  const result = await read(path);
  if (!result.found) throw new PublicGatewayError(path, 404);
  return result.body as T;
}

/** A public read where 404 or 410 means "not there" (null); every other failure throws. */
export async function publicJsonOrNull<T>(path: string): Promise<T | null> {
  const result = await read(path);
  return result.found ? (result.body as T) : null;
}

export const overview = () => publicJson<Overview>('/api/overview');
/** The homepage's bounded overview (homeOverview contract): the same shape, a few rows of each. */
export const homeOverview = () => publicJson<Overview>(HOME_OVERVIEW_PATH);
export const catalog = (query: CatalogQuery = {}) => publicJson<Catalog>(catalogApiPath(query));
export const authorCatalog = (query: AuthorCatalogQuery = {}) => publicJson<AuthorCatalog>(authorApiPath(query));

/**
 * The page registry entry for a /blogs/<key>/ or /topics/<key>/ param: null for
 * a key the registry could not have minted or the gateway's 404. `param` is the
 * raw Next param (percent-encoded); pageKeyOfParam decodes it exactly once.
 */
export async function getPublicPage(kind: PageKind, param: string): Promise<PublicPageInfo | null> {
  const key = pageKeyOfParam(kind, param);
  if (key === null) return null;
  // A 200 that pageInfoOf rejects already threw in readPublic (public-contracts.ts).
  return pageInfoOf(kind, await publicJsonOrNull<unknown>(pageApiPath(kind, key)));
}

/** null only for the gateway's real 404; a 200 without `blog` already threw (public-contracts.ts). */
export async function getBlog(slug: string): Promise<Blog | null> {
  const data = await publicJsonOrNull<{ blog: Blog; posts: Post[] }>(`/api/blogs/${encodeURIComponent(slug)}`);
  return data ? { ...data.blog, posts: data.posts } : null;
}
