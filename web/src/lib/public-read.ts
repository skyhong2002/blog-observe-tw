/**
 * The status rules behind public-api.ts, kept free of `server-only`, React and
 * the gateway origin so node --test can drive them with a fake fetch.
 *
 * - Only public-paths.ts paths, only GET, a fixed init: no caller headers,
 *   so no Cookie or Authorization can reach a shared response.
 * - 2xx: the JSON body, if it has the fields public-contracts.ts requires for
 *   that path. 404, and 410 (a topic whose evidence was all revoked; the
 *   gateway answers it for the page URL itself): "not found" for the caller
 *   to decide on, never a thrown 500.
 * - 502/503/504: one retry after a short wait (the relation projection answers
 *   503 with retry-after: 2 while it rebuilds); then, like any other status,
 *   network failure, unreadable JSON or a wrong-shaped 200, a thrown
 *   PublicGatewayError. Throwing is what keeps the last good ISR page;
 *   returning empty data would cache it.
 * - Topic detail and topic page-registry reads (NO_STORE_KINDS) are never
 *   kept in Next's fetch cache: whether a topic's articles may still be shown
 *   is decided by the gateway on every request, so a stored answer could keep
 *   serving an article the gateway already hides. Every other kind is kept for
 *   PUBLIC_REVALIDATE_SECONDS.
 * - A response that is not used has its body cancelled, so it does not hold
 *   the connection.
 */
// The extensions let node --test load this file directly.
import { validPublicPayload } from './public-contracts.ts';
import { assertPublicApiPath, PUBLIC_REVALIDATE_SECONDS, type PublicKind } from './public-paths.ts';

export class PublicGatewayError extends Error {
  readonly path: string;
  readonly status: number | null;
  constructor(path: string, status: number | null, reason = status === null ? 'network' : String(status), options?: ErrorOptions) {
    super(`Public gateway read failed: ${path} (${reason})`, options);
    this.name = 'PublicGatewayError';
    this.path = path;
    this.status = status;
  }
}

export type PublicRead = { found: true; body: unknown } | { found: false; gone?: true };
type PublicInit = RequestInit & { next?: { revalidate: number } };
type Fetch = (url: string, init: PublicInit) => Promise<Response>;

/** Kinds read fresh on every request, server and browser alike (public-loader.ts). */
export const NO_STORE_KINDS: ReadonlySet<PublicKind> = new Set<PublicKind>(['topic', 'topicPage']);
export const isNoStoreKind = (kind: PublicKind | null) => kind !== null && NO_STORE_KINDS.has(kind);

export const PUBLIC_TIMEOUT_MS = 10_000;
export const PUBLIC_RETRY_MS = 2_000;
const transient = (status: number) => status === 502 || status === 503 || status === 504;
/** Releases an unread body; a body that is already gone or locked is fine. */
export const discard = (response: Response) => response.body?.cancel().catch(() => {});

/** The only inits a public read sends: ISR-cached, or `cache: 'no-store'` for NO_STORE_KINDS. */
export function publicInit(kind: PublicKind | null = null): PublicInit {
  const base = { method: 'GET', headers: { accept: 'application/json' }, redirect: 'error' } as const;
  const signal = AbortSignal.timeout(PUBLIC_TIMEOUT_MS);
  if (isNoStoreKind(kind)) return { ...base, cache: 'no-store', signal };
  return { ...base, next: { revalidate: PUBLIC_REVALIDATE_SECONDS }, signal };
}

export async function readPublic(
  origin: string,
  path: string,
  fetcher: Fetch = fetch as Fetch,
  wait: (ms: number) => Promise<unknown> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<PublicRead> {
  const kind = assertPublicApiPath(path);
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetcher(`${origin}${path}`, publicInit(kind));
    } catch (error) {
      throw new PublicGatewayError(path, null, undefined, { cause: error });
    }
    if (response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        throw new PublicGatewayError(path, response.status, 'unreadable JSON', { cause: error });
      }
      if (!validPublicPayload(kind, body)) throw new PublicGatewayError(path, response.status, `unexpected ${kind} payload`);
      return { found: true, body };
    }
    await discard(response);
    if (response.status === 404) return { found: false };
    if (response.status === 410) return { found: false, gone: true };
    if (attempt === 0 && transient(response.status)) {
      await wait(PUBLIC_RETRY_MS);
      continue;
    }
    throw new PublicGatewayError(path, response.status);
  }
}
