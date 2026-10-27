import { normalizeSimilarDomain, readTagSimilarwebToken } from '../crawl/similarweb-client.ts';

// Since 2026-10-24 a blog's tags live on site.observe.tw (traffic src/crowd.ts, docs/README.md 「標籤投票」), keyed
// by the blog's domain and shared by every observe site. Since gen106 blog only reads them (and sends its AI
// suggestions); readers vote and add tags on traffic itself, which the blog page links as 編輯標籤, like
// tag.observe.tw. blog_genre_assignments / blog_genre_votes are kept unwritten, for a rollback.
// Same loopback service and token as the Similarweb client (crawl/similarweb-client.ts); every refusal there is a 404.
export const TRAFFIC_TAGS_BASE = 'http://127.0.0.1:18150/internal/v1/tags';
export const TRAFFIC_ORIGIN = 'https://site.observe.tw';
/** Where a reader edits a blog's tags: its page on site.observe.tw, at the tag block. */
export const trafficTagsUrl = (domain: string) => `${TRAFFIC_ORIGIN}/site/${encodeURIComponent(domain)}/#tags`;
const READ_TIMEOUT_MS = 5_000;
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
export type TagRead = { domains: Record<string, TrafficTagItem[]> };
/** Each tag may carry its own reason (traffic 2cb1a66); `reason` is the fallback for tags without one. */
export type AiSite = { domain: string; tags: Array<string | { tag: string; reason?: string }>; reason?: string };

export interface TagClient {
  /** Every tag (shown or not) of the domains traffic knows. */
  read(domains: string[]): Promise<TagRead>;
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
    async read(domains) {
      if (domains.length > TAG_READ_LIMIT) throw new TagServiceError('tag-read-bound');
      const { status, json } = await call('POST', '', { domains }, READ_TIMEOUT_MS);
      if (status !== 200 || !object(json) || !object(json.domains)) throw new TagServiceError(`tag-service-${status}`);
      const out: TagRead = { domains: {} };
      for (const [domain, list] of Object.entries(json.domains)) out.domains[domain] = items(list);
      return out;
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
/** The client every read and AI write goes through; tests replace it (app/test/tag-client-setup.ts). */
export const tagClient = () => current;
export function setTagClient(client: TagClient) {
  current = client;
}
