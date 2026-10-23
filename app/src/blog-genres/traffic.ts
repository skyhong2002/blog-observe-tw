import { normalizeSimilarDomain, readTagSimilarwebToken } from '../crawl/similarweb-client.ts';

// Since 2026-10-24 a blog's tags live on traffic.observe.tw (traffic src/crowd.ts, docs/README.md 「標籤投票」), keyed
// by the blog's domain: one vote per Google account and tag, shared by every observe site. blog only proxies its
// signed-in readers' votes, proposals and admin overrides there; the voter is the reader's Google email and traffic
// alone decides who is an admin. blog_genre_assignments / blog_genre_votes are kept unwritten, for a rollback.
// Same loopback service and token as the Similarweb client (crawl/similarweb-client.ts); every refusal there is a 404.
export const TRAFFIC_TAGS_BASE = 'http://127.0.0.1:18150/internal/v1/tags';
const READ_TIMEOUT_MS = 5_000;
const WRITE_TIMEOUT_MS = 8_000;
const BODY_LIMIT = 4 * 1024 * 1024;
/** traffic's own bounds: domains per read, sites per AI replacement. */
export const TAG_READ_LIMIT = 2000;
export const AI_SITES_LIMIT = 500;

export type TrafficTagItem = {
  tag: string;
  source: 'editor' | 'sheet' | 'ai' | 'community' | 'admin';
  visible: boolean;
  agrees: number;
  disagrees: number;
  adminOverride: 'set' | 'hide' | null;
};
export type TagRead = {
  domains: Record<string, TrafficTagItem[]>;
  voter?: { email: string; admin: boolean; votes: Record<string, Record<string, number>> };
};
/** A refused write as traffic answered it (400 invalid_tag, 403 not_admin, 404 unknown_domain/unknown_tag, 429 rate_limited). */
export type TagWriteRefusal = { status: number; error: string; message?: string };
export type TagWriteResult = { ok: true; domain: string; tag: string; tags: TrafficTagItem[] } | TagWriteRefusal;
export type TagWrite =
  | { kind: 'vote'; voter: string; domain: string; tag: string; vote: 1 | -1 | 0 }
  | { kind: 'propose'; voter: string; domain: string; tag: string }
  | { kind: 'admin'; voter: string; domain: string; tag: string; action: 'set' | 'hide' | 'release' };
export type AiSite = { domain: string; tags: string[]; reason?: string };

export interface TagClient {
  /** Every tag (shown or not) of the domains traffic knows; with `voter`, that reader's votes and admin flag. */
  read(domains: string[], voter?: string): Promise<TagRead>;
  write(change: TagWrite): Promise<TagWriteResult>;
  /** Replaces blog's AI suggestions for the listed domains. */
  putAi(sites: AiSite[]): Promise<{ ok: true; sites: number; changed: number; skipped: unknown[] }>;
}

/** The domain traffic keys a blog by: its canonical host, lower case, without www. (traffic publicDomain). */
export const tagDomain = (host: unknown) => (typeof host === 'string' && host ? normalizeSimilarDomain(host) : null);

export class TagServiceError extends Error {}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isItem = (value: unknown): value is TrafficTagItem =>
  object(value) &&
  typeof value.tag === 'string' &&
  ['editor', 'sheet', 'ai', 'community', 'admin'].includes(value.source as string) &&
  typeof value.visible === 'boolean' &&
  count(value.agrees) &&
  count(value.disagrees) &&
  [null, 'set', 'hide'].includes(value.adminOverride as string | null);
const items = (value: unknown) => {
  if (!Array.isArray(value) || !value.every(isItem)) throw new TagServiceError('tag-service-shape');
  return value;
};

const REFUSALS = new Set([
  'invalid_tag',
  'invalid_vote',
  'invalid_action',
  'invalid_voter',
  'invalid_domain',
  'not_admin',
  'unknown_domain',
  'unknown_tag',
  'rate_limited',
]);

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export function trafficTagClient({
  fetcher = fetch as Fetcher,
  readToken = () => readTagSimilarwebToken(),
}: {
  fetcher?: Fetcher;
  readToken?: () => Promise<string | null>;
} = {}): TagClient {
  const call = async (method: string, path: string, body: unknown, timeout: number) => {
    const token = await readToken();
    if (!token) throw new TagServiceError('tag-service-token');
    let response: Response;
    try {
      response = await fetcher(`${TRAFFIC_TAGS_BASE}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new TagServiceError('tag-service-unreachable');
    }
    const text = await response.text().catch(() => '');
    if (text.length > BODY_LIMIT) throw new TagServiceError('tag-service-body');
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new TagServiceError('tag-service-body');
    }
    return { status: response.status, json };
  };
  return {
    async read(domains, voter) {
      if (domains.length > TAG_READ_LIMIT) throw new TagServiceError('tag-read-bound');
      const { status, json } = await call('POST', '', voter ? { domains, voter } : { domains }, READ_TIMEOUT_MS);
      if (status !== 200 || !object(json) || !object(json.domains)) throw new TagServiceError(`tag-service-${status}`);
      const out: TagRead = { domains: {} };
      for (const [domain, list] of Object.entries(json.domains)) out.domains[domain] = items(list);
      if (voter) {
        const v = json.voter;
        if (!object(v) || typeof v.admin !== 'boolean' || !object(v.votes)) throw new TagServiceError('tag-service-shape');
        out.voter = { email: String(v.email), admin: v.admin, votes: v.votes as Record<string, Record<string, number>> };
      }
      return out;
    },
    async write(change) {
      const { kind, ...body } = change;
      const { status, json } = await call('POST', `/${kind}`, body, WRITE_TIMEOUT_MS);
      if (status === 200 && object(json) && json.ok === true && typeof json.tag === 'string')
        return { ok: true, domain: String(json.domain), tag: json.tag, tags: items(json.tags) };
      // traffic answers 404 { error: 'not found' } when it refuses the caller (token, not loopback); only its documented
      // codes refuse this change, anything else is the service being unavailable.
      if (status >= 400 && status < 500 && object(json) && REFUSALS.has(json.error as string))
        return { status, error: json.error as string, ...(typeof json.message === 'string' ? { message: json.message } : {}) };
      throw new TagServiceError(`tag-service-${status}`);
    },
    async putAi(sites) {
      if (sites.length > AI_SITES_LIMIT) throw new TagServiceError('tag-ai-bound');
      const { status, json } = await call('PUT', '/ai', { sites }, 30_000);
      if (status !== 200 || !object(json) || json.ok !== true) throw new TagServiceError(`tag-service-${status}`);
      return json as { ok: true; sites: number; changed: number; skipped: unknown[] };
    },
  };
}

let current: TagClient = trafficTagClient();
/** The client every read and write goes through; tests replace it (app/test/tag-client-setup.ts). */
export const tagClient = () => current;
export function setTagClient(client: TagClient) {
  current = client;
}
