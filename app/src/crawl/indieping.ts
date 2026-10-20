// IndiePing (indieping.giveanornot.com, run by JN) checks a hand-approved list of Chinese indie blogs for links to
// each other. Its list is not public, but `/api/query?domain=` names every member blog that linked to a domain, so
// asking about our own blogs (and then about the members found) walks the list. Reuse agreed with JN 2026-10-21.
// New members become `indieping` candidates carrying the listing; the ordinary review checks Chinese, home and feed.
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { publicationDecision } from '../relations/identity.ts';
import { INDIEPING_LISTING } from './directory-listing.ts';
import { type FeedCrawlerOptions, isAllowedCrawlUrl, politeFetch, readFeedBody } from './feed.ts';

const API = `${INDIEPING_LISTING}api/query?domain=`;
/** The site allows about 100 queries per ~20-minute window; the owner asked us to use at most half. */
export const INDIEPING_SHARE = 0.5;
/** Steady pace inside that share: 50 queries per 20 minutes. */
export const INDIEPING_DELAY_MS = 25_000;

export type IndiepingMember = { home: string; name: string | null; linkedTo: string; postUrl: string | null };

/** The member blogs in one query answer, by publication home (one row per home). */
export function indiepingMembers(body: unknown, domain: string): IndiepingMember[] {
  const links = (body as { links?: unknown })?.links;
  if (!Array.isArray(links)) return [];
  const found = new Map<string, IndiepingMember>();
  for (const link of links) {
    const { blog_url: url, blog_name: name, post_url: postUrl } = (link ?? {}) as Record<string, unknown>;
    if (typeof url !== 'string' || !isAllowedCrawlUrl(url)) continue;
    const home = publicationDecision(url).home;
    if (!home || found.has(home)) continue;
    found.set(home, {
      home,
      name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 255) : null,
      linkedTo: domain,
      postUrl: typeof postUrl === 'string' ? postUrl.slice(0, 1024) : null,
    });
  }
  return [...found.values()];
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
};
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

type Options = FeedCrawlerOptions & {
  maxQueries?: number;
  /** Test seam; production waits. */
  wait?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  log?: (event: Record<string, unknown>) => void;
};

/**
 * Ask about every verified blog's host, then about each newly found member (breadth first), at most `maxQueries`
 * times. Paced at INDIEPING_DELAY_MS, and whenever the window has used half its allowance (x-ratelimit-remaining at
 * or below half of the limit seen at the window's start) it waits for the reset. A 429 waits too; other errors skip.
 */
export async function discoverIndieping(pool: Pool, options: Options = {}, now = () => new Date()) {
  const { maxQueries = 2000, signal, log = () => {} } = options;
  const wait = options.wait ?? ((ms: number) => sleep(ms, signal));
  const [blogs] = await pool.query<RowDataPacket[]>(
    `SELECT b.url FROM blogs b WHERE b.status='verified' AND b.url IS NOT NULL
     UNION SELECT u.url FROM blog_urls u JOIN blogs b ON b.id=u.blog_id WHERE b.status='verified'`,
  );
  const known = new Set(blogs.map((row) => hostOf(String(row.url))).filter((host): host is string => Boolean(host)));
  const queue = [...known].sort();
  const asked = new Set<string>();
  const result = { queries: 0, members: 0, added: 0, alreadyCollected: 0, errors: 0 };
  let windowStart: number | null = null;
  while (queue.length && result.queries < maxQueries && !signal?.aborted) {
    const domain = queue.shift()!;
    if (asked.has(domain)) continue;
    asked.add(domain);
    if (result.queries) await wait(INDIEPING_DELAY_MS);
    let response: Response;
    try {
      response = await politeFetch(`${API}${encodeURIComponent(domain)}`, { accept: 'application/json' }, options);
    } catch {
      result.errors++;
      continue;
    }
    result.queries++;
    const limit = Number(response.headers.get('x-ratelimit-limit'));
    const remaining = Number(response.headers.get('x-ratelimit-remaining'));
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    // The window's allowance is what was left at its first answer (the limit header is not the per-window count).
    if (windowStart === null || remaining > windowStart) windowStart = remaining + 1;
    const untilReset = Number.isFinite(reset) && reset > 0 ? Math.max(0, reset * 1000 - Date.now()) + 5000 : 20 * 60_000;
    if (response.status === 429) {
      await response.body?.cancel();
      log({ waiting: 'rate-limited', ms: untilReset });
      await wait(Math.min(untilReset, 30 * 60_000));
      asked.delete(domain);
      queue.unshift(domain);
      windowStart = null;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      result.errors++;
      continue;
    }
    let body: unknown;
    try {
      body = JSON.parse(await readFeedBody(response));
    } catch {
      result.errors++;
      continue;
    }
    for (const member of indiepingMembers(body, domain)) {
      result.members++;
      const host = hostOf(member.home);
      if (host && !asked.has(host)) queue.push(host);
      if (host && known.has(host)) {
        result.alreadyCollected++;
        continue;
      }
      const listing = JSON.stringify({
        page: INDIEPING_LISTING,
        blogName: member.name,
        linkedTo: member.linkedTo,
        postUrl: member.postUrl,
      });
      const [insert] = await pool.execute<ResultSetHeader>(
        `INSERT INTO discovery_candidates (url,name,source_type,source_url,source_evidence,status,discovered_at)
         VALUES (?,NULL,'indieping',?,JSON_OBJECT('indiepingListing',JSON_EXTRACT(?,'$'),'discoveryDepth',1),'candidate',?)
         ON DUPLICATE KEY UPDATE id=id`,
        [member.home.slice(0, 1024), `${INDIEPING_LISTING}${encodeURIComponent(member.linkedTo)}`, listing, now()],
      );
      if (insert.affectedRows === 1) {
        result.added++;
        log({ added: member.home });
      }
    }
    // Half of this window is spent: wait for the next one.
    if (Number.isFinite(remaining) && windowStart !== null && remaining <= windowStart * (1 - INDIEPING_SHARE)) {
      log({ waiting: 'half-window-used', ms: untilReset, limit });
      await wait(Math.min(untilReset, 30 * 60_000));
      windowStart = null;
    }
  }
  return { ...result, pending: queue.filter((domain) => !asked.has(domain)).length };
}
