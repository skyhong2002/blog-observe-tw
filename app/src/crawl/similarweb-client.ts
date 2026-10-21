import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SimilarWebResult, TagRequestKind, TagRequestStatus, TagSimilarSitesClient, TagSimilarSitesPayload } from './similarweb.ts';

// traffic.observe.tw (the machine's only Similarweb requester since 2026-10-21)
// serves the same contract tag did (tag 898f463), with the same blog token.
// No caller-controlled origin, endpoint, headers, redirect or provider fallback.
export const TRAFFIC_SIMILARWEB_BASE = 'http://127.0.0.1:18150/internal/similarweb';
export const TAG_SIMILARWEB_BODY_LIMIT = 1024 * 1024;
/** traffic.observe.tw's standing list for this requester: refreshed on its interval, replaced as a whole on every PUT. */
export const TRAFFIC_WATCH_URL = 'http://127.0.0.1:18150/internal/v1/watch';
const TIMEOUT_MS = 10_000;
const TOKEN_LIMIT = 4096;
const PRIVATE_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'intranet',
  'lan',
  'home',
  'corp',
  'test',
  'example',
  'invalid',
  'arpa',
  'onion',
  'ts.net',
  'observe.tw',
];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const nullableDate = (value: unknown): value is string | null => value === null || date(value);
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validToken = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 32 && value.length <= TOKEN_LIMIT && /^[\x21-\x7e]+$/.test(value);

/** Same public-domain boundary as tag, with ports/credentials refused before normalization. */
export function normalizeSimilarDomain(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > 253 || /[\s@\\]/.test(raw)) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    const domain = url.hostname.toLowerCase().replace(/^www\./, '');
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.port ||
      url.username ||
      url.password ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(domain)
    )
      return null;
    if (
      domain.length > 253 ||
      domain.split('.').some((label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))
    )
      return null;
    return PRIVATE_SUFFIXES.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`)) ? null : domain;
  } catch {
    return null;
  }
}

/** Owner-only, regular, non-symlink token file; no credential ever appears in an error. */
export async function readTagSimilarwebToken(env: Record<string, string | undefined> = process.env): Promise<string | null> {
  if (env.BLOG_SIMILARWEB_TOKEN !== undefined) return validToken(env.BLOG_SIMILARWEB_TOKEN) ? env.BLOG_SIMILARWEB_TOKEN : null;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(join(homedir(), '.config/observe-similarweb/blog-token'), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid?.() || stat.size > TOKEN_LIMIT) return null;
    const buffer = Buffer.alloc(TOKEN_LIMIT + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > TOKEN_LIMIT) return null;
    const token = buffer.subarray(0, bytesRead).toString('utf8').trim();
    return validToken(token) ? token : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseTraffic(value: unknown): TagSimilarSitesPayload['traffic'] | undefined {
  if (value === null) return null;
  if (
    !object(value) ||
    !Array.isArray(value.monthly) ||
    value.monthly.length > 120 ||
    !Array.isArray(value.topCountries) ||
    value.topCountries.length > 250
  )
    return undefined;
  if (
    !(value.globalRank === null || nonnegative(value.globalRank)) ||
    !(value.category === null || (typeof value.category === 'string' && value.category.length <= 64))
  )
    return undefined;
  if (
    !(
      value.countryRank === null ||
      (object(value.countryRank) &&
        typeof value.countryRank.code === 'string' &&
        value.countryRank.code.length <= 8 &&
        nonnegative(value.countryRank.rank))
    )
  )
    return undefined;
  const monthly: Array<{ month: string; visits: number }> = [];
  for (const item of value.monthly) {
    if (!object(item) || typeof item.month !== 'string' || !/^\d{4}(0[1-9]|1[0-2])$/.test(item.month) || !nonnegative(item.visits))
      return undefined;
    monthly.push({ month: item.month, visits: item.visits });
  }
  const topCountries: Array<{ code: string; share: number }> = [];
  for (const item of value.topCountries) {
    if (!object(item) || typeof item.code !== 'string' || item.code.length > 8 || !nonnegative(item.share) || item.share > 1)
      return undefined;
    topCountries.push({ code: item.code, share: item.share });
  }
  return {
    monthly,
    globalRank: value.globalRank,
    category: value.category,
    countryRank: value.countryRank === null ? null : { code: value.countryRank.code as string, rank: value.countryRank.rank as number },
    topCountries,
  };
}

function parsePayload(value: unknown, domain: string): TagSimilarSitesPayload | null {
  if (
    !object(value) ||
    value.domain !== domain ||
    value.source !== 'similarweb-extension' ||
    !nullableDate(value.fetchedAt) ||
    !Array.isArray(value.requests) ||
    !value.requests.length ||
    value.requests.length > 2 ||
    !Array.isArray(value.similarSites) ||
    value.similarSites.length > 20
  )
    return null;
  const traffic = parseTraffic(value.traffic);
  if (traffic === undefined) return null;
  const requests: TagSimilarSitesPayload['requests'] = [];
  const seen = new Set<string>();
  for (const item of value.requests) {
    if (
      !object(item) ||
      !['traffic', 'similar_sites'].includes(String(item.kind)) ||
      !['pending', 'ok', 'no-data', 'blocked'].includes(String(item.status)) ||
      !date(item.requestedAt) ||
      !nullableDate(item.nextAttemptAt) ||
      !Number.isSafeInteger(item.attempts) ||
      (item.attempts as number) < 0 ||
      seen.has(String(item.kind))
    )
      return null;
    seen.add(String(item.kind));
    requests.push({
      kind: item.kind as TagRequestKind,
      status: item.status as TagRequestStatus,
      requestedAt: item.requestedAt,
      attempts: item.attempts as number,
      nextAttemptAt: item.nextAttemptAt,
    });
  }
  const similarSites: string[] = [];
  for (const item of value.similarSites) {
    if (typeof item !== 'string') return null;
    const candidate = normalizeSimilarDomain(item);
    if (!candidate || candidate !== item || candidate === domain) return null;
    if (!similarSites.includes(candidate)) similarSites.push(candidate);
  }
  return { domain, source: 'similarweb-extension', fetchedAt: value.fetchedAt, requests, traffic, similarSites };
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > TAG_SIMILARWEB_BODY_LIMIT) {
    await response.body?.cancel();
    throw new Error('response-too-large');
  }
  if (!response.body) throw new Error('empty-response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > TAG_SIMILARWEB_BODY_LIMIT) throw new Error('response-too-large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

type ClientOptions = {
  fetcher?: typeof fetch;
  readToken?: () => Promise<string | null>;
  env?: Record<string, string | undefined>;
};

export function createTagSimilarSitesClient(options: ClientOptions = {}): TagSimilarSitesClient {
  const fetcher = options.fetcher ?? fetch;
  const tokenReader = options.readToken ?? (() => readTagSimilarwebToken(options.env));
  async function request(raw: string, kind?: TagRequestKind): Promise<SimilarWebResult> {
    const domain = normalizeSimilarDomain(raw);
    const result = (status: SimilarWebResult['status'], extras: Partial<SimilarWebResult> = {}): SimilarWebResult => ({
      enabled: true,
      domain: domain ?? '',
      candidates: [],
      status,
      ...extras,
    });
    if (!domain) return result('error', { errorCode: 'invalid-domain' });
    if (kind !== undefined && kind !== 'similar_sites' && kind !== 'traffic') return result('error', { errorCode: 'invalid-kind' });
    let token: string | null;
    try {
      token = await tokenReader();
    } catch {
      return result('config', { errorCode: 'token-unavailable' });
    }
    if (!validToken(token)) return result('config', { errorCode: 'token-unavailable' });
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let responseStatus: number | undefined;
    try {
      const response = await fetcher(
        kind ? `${TRAFFIC_SIMILARWEB_BASE}/requests` : `${TRAFFIC_SIMILARWEB_BASE}/results?${new URLSearchParams({ domain })}`,
        {
          method: kind ? 'POST' : 'GET',
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
          signal,
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${token}`,
            ...(kind ? { 'content-type': 'application/json' } : {}),
          },
          ...(kind ? { body: JSON.stringify({ domain, kind }) } : {}),
        },
      );
      const httpStatus = response.status;
      responseStatus = httpStatus;
      // Never accept a fetch implementation that followed a redirect despite the policy.
      if (response.redirected || (httpStatus >= 300 && httpStatus < 400)) {
        await response.body?.cancel();
        return result('error', { httpStatus, errorCode: 'invalid-response' });
      }
      if ([401, 403, 429].includes(httpStatus)) {
        await response.body?.cancel();
        return result(httpStatus === 429 ? 'blocked' : 'auth', { httpStatus });
      }
      if (![200, 202, 404].includes(httpStatus)) {
        await response.body?.cancel();
        return result('error', { httpStatus, errorCode: 'request-failed' });
      }
      const payload = await readJson(response, signal);
      if (httpStatus === 404)
        return !kind && object(payload) && payload.error === 'not_requested' && payload.domain === domain
          ? result('not-requested', { httpStatus })
          : result('auth', { httpStatus });
      if (!response.ok) return result('error', { httpStatus, errorCode: 'request-failed' });
      if (kind) {
        if (
          !object(payload) ||
          payload.domain !== domain ||
          payload.kind !== kind ||
          typeof payload.created !== 'boolean' ||
          !['pending', 'ok', 'no-data', 'blocked'].includes(String(payload.status))
        )
          return result('error', { httpStatus, errorCode: 'invalid-response' });
        const status = payload.status === 'ok' ? 'ready' : (payload.status as 'pending' | 'no-data' | 'blocked');
        return result(status, { httpStatus, created: payload.created });
      }
      if (httpStatus !== 200) return result('error', { httpStatus, errorCode: 'invalid-response' });
      const evidence = parsePayload(payload, domain);
      if (!evidence) return result('error', { httpStatus, errorCode: 'invalid-response' });
      const blocked = evidence.requests.some((row) => row.status === 'blocked');
      const similar = evidence.requests.find((row) => row.kind === 'similar_sites');
      const status = blocked ? 'blocked' : !similar ? 'not-requested' : similar.status === 'ok' ? 'ready' : similar.status;
      if (status === 'ready' && (!evidence.fetchedAt || !evidence.similarSites.length))
        return result('error', { httpStatus, errorCode: 'invalid-response' });
      const nextAttemptAt =
        evidence.requests
          .map((row) => row.nextAttemptAt)
          .filter((time): time is string => !!time)
          .sort()
          .at(-1) ?? null;
      return result(status, {
        httpStatus,
        fetchedAt: evidence.fetchedAt,
        nextAttemptAt,
        sourceEvidence: evidence,
        candidates: status === 'ready' ? evidence.similarSites : [],
      });
    } catch {
      // Only the exact authenticated not_requested JSON is a submission signal.
      if (responseStatus === 404) return result('auth', { httpStatus: 404 });
      return result('error', { errorCode: 'request-failed' });
    }
  }
  return { getResult: (domain) => request(domain), submit: (domain, kind = 'similar_sites') => request(domain, kind) };
}

/**
 * Hands traffic.observe.tw every verified blog as blog's standing list
 * (Similarweb monthly, Cloudflare Radar daily), so the whole directory is
 * tracked, not just the ones looked up one by one. Same token and loopback
 * rules as the lookups; never throws, never reports the token.
 */
export async function registerBlogWatchList(
  domains: string[],
  {
    fetcher = fetch,
    tokenReader = readTagSimilarwebToken,
    refreshDays = 30,
  }: { fetcher?: typeof fetch; tokenReader?: () => Promise<string | null>; refreshDays?: number } = {},
): Promise<{ status: 'ok'; watched: number; refused: number } | { status: 'config' | 'error'; httpStatus?: number }> {
  const list = [...new Set(domains.map(normalizeSimilarDomain).filter((d): d is string => !!d))].sort();
  let token: string | null;
  try {
    token = await tokenReader();
  } catch {
    return { status: 'config' };
  }
  if (!validToken(token)) return { status: 'config' };
  try {
    const response = await fetcher(TRAFFIC_WATCH_URL, {
      method: 'PUT',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ domains: list, refreshDays }),
    });
    if (response.status !== 200 || response.redirected) {
      await response.body?.cancel();
      return { status: 'error', httpStatus: response.status };
    }
    const payload = (await readJson(response, AbortSignal.timeout(TIMEOUT_MS))) as { watched?: unknown; refused?: unknown };
    return {
      status: 'ok',
      watched: typeof payload?.watched === 'number' ? payload.watched : 0,
      refused: Array.isArray(payload?.refused) ? payload.refused.length : 0,
    };
  } catch {
    return { status: 'error' };
  }
}
