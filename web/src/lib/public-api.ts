import 'server-only';
import { cache } from 'react';
import type { AuthorCatalog, AuthorCatalogQuery, Blog, Catalog, CatalogQuery, Overview, Post } from './api';
import { authorApiPath, catalogApiPath } from './public-query';
import { PublicGatewayError, readPublic } from './public-read';
import { gatewayOrigin } from './server-gateway';

/**
 * Shared reads for ISR pages: GETs of the public, cookie-free gateway paths in
 * public-paths.ts, kept in Next's fetch cache for PUBLIC_REVALIDATE_SECONDS
 * (only 200s are stored). There is no init or header parameter.
 *
 * Failures, including a 200 missing the fields public-contracts.ts requires,
 * throw instead of returning empty data (rules in public-read.ts): a
 * background regeneration that throws keeps the last good page, and a first
 * render that throws is an uncached error. Only publicJsonOrNull turns a 404,
 * from a path where 404 means "no such thing", into data (null).
 */

/** One read per path per render (generateMetadata and the page share it). */
const read = cache((path: string) => readPublic(gatewayOrigin(), path));

/** A public read that must succeed; any non-2xx (404 included) throws. */
export async function publicJson<T>(path: string): Promise<T> {
  const result = await read(path);
  if (!result.found) throw new PublicGatewayError(path, 404);
  return result.body as T;
}

/** A public read where 404 means "not there" (null); every other failure throws. */
export async function publicJsonOrNull<T>(path: string): Promise<T | null> {
  const result = await read(path);
  return result.found ? (result.body as T) : null;
}

export const overview = () => publicJson<Overview>('/api/overview');
export const catalog = (query: CatalogQuery = {}) => publicJson<Catalog>(catalogApiPath(query));
export const authorCatalog = (query: AuthorCatalogQuery = {}) => publicJson<AuthorCatalog>(authorApiPath(query));

/** null only for the gateway's real 404; a 200 without `blog` already threw (public-contracts.ts). */
export async function getBlog(slug: string): Promise<Blog | null> {
  const data = await publicJsonOrNull<{ blog: Blog; posts: Post[] }>(`/api/blogs/${encodeURIComponent(slug)}`);
  return data ? { ...data.blog, posts: data.posts } : null;
}
