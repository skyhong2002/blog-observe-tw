/**
 * The status rules behind public-api.ts, kept free of `server-only`, React and
 * the gateway origin so node --test can drive them with a fake fetch.
 *
 * - Only public-paths.ts paths, only GET, a fixed init: no caller headers,
 *   so no Cookie or Authorization can reach a shared response.
 * - 2xx: the JSON body, if it has the fields public-contracts.ts requires for
 *   that path. 404: "not found" for the caller to decide on.
 * - 502/503/504: one retry after a short wait (the relation projection answers
 *   503 with retry-after: 2 while it rebuilds); then, like any other status,
 *   network failure, unreadable JSON or a wrong-shaped 200, a thrown
 *   PublicGatewayError. Throwing is what keeps the last good ISR page;
 *   returning empty data would cache it.
 * - A response that is not used has its body cancelled, so it does not hold
 *   the connection.
 */
// The extensions let node --test load this file directly.
import { validPublicPayload } from './public-contracts.ts';
import { assertPublicApiPath, PUBLIC_REVALIDATE_SECONDS } from './public-paths.ts';

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

export type PublicRead = { found: true; body: unknown } | { found: false };
type Fetch = (url: string, init: RequestInit & { next: { revalidate: number } }) => Promise<Response>;

export const PUBLIC_TIMEOUT_MS = 10_000;
export const PUBLIC_RETRY_MS = 2_000;
const transient = (status: number) => status === 502 || status === 503 || status === 504;
/** Releases an unread body; a body that is already gone or locked is fine. */
export const discard = (response: Response) => response.body?.cancel().catch(() => {});

/** The only init a public read sends. */
export function publicInit(): RequestInit & { next: { revalidate: number } } {
  return {
    method: 'GET',
    headers: { accept: 'application/json' },
    redirect: 'error',
    next: { revalidate: PUBLIC_REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(PUBLIC_TIMEOUT_MS),
  };
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
      response = await fetcher(`${origin}${path}`, publicInit());
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
    if (attempt === 0 && transient(response.status)) {
      await wait(PUBLIC_RETRY_MS);
      continue;
    }
    throw new PublicGatewayError(path, response.status);
  }
}
