// Adapted from youtube-board TagArticleSource, exact public tag article contract.
import { TagApiTransport, type TagTransportOptions } from './transport.ts';
import { type ArticlePage, type ArticleSource, SOURCE, validateWindow, type Window } from './window-contract.ts';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Fixed loopback/public endpoint only. No credentials, bodies, or rankings are ingested. */
export class TagArticleSource implements ArticleSource {
  private readonly transport: TagApiTransport;
  constructor(fetcher: typeof fetch = fetch, delayMs = 500, signal?: AbortSignal, options: TagTransportOptions = {}) {
    this.transport = new TagApiTransport(fetcher, { ...options, delayMs, signal: signal ?? options.signal });
  }
  get diagnostics() {
    return this.transport.diagnostics;
  }
  async page(window: Window, cursor: string | null): Promise<ArticlePage> {
    validateWindow(window);
    if (cursor !== null && !/^\d{1,15}_\d{1,19}$/.test(cursor)) throw new Error('Invalid stored source cursor');
    const url = new URL('/api/v1/articles', SOURCE);
    url.search = new URLSearchParams({ since: window.since, until: window.until, limit: '200', ...(cursor ? { cursor } : {}) }).toString();
    const data = await this.transport.json(url.pathname + url.search, 4_000_000, 'Tag source');
    if (
      !record(data) ||
      !Array.isArray(data.articles) ||
      data.articles.length > 200 ||
      !(data.nextCursor === null || typeof data.nextCursor === 'string')
    )
      throw new Error('Invalid tag source page');
    const query = data.query;
    if (
      !record(query) ||
      Date.parse(String(query.since)) !== Date.parse(window.since) ||
      Date.parse(String(query.until)) !== Date.parse(window.until)
    )
      throw new Error('Tag source changed requested window');
    const articles = data.articles.map((a: unknown) => {
      if (
        !record(a) ||
        !(typeof a.id === 'number' && Number.isSafeInteger(a.id) && a.id > 0) ||
        typeof a.media !== 'string' ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(a.media) ||
        typeof a.publishedAt !== 'string' ||
        !Array.isArray(a.tags)
      )
        throw new Error('Invalid tag source article');
      const at = Date.parse(a.publishedAt);
      if (!(at >= Date.parse(window.since) && at < Date.parse(window.until))) throw new Error('Tag article outside requested window');
      // A live source tag may contain a leading zero-width space/BOM from
      // editorial copy/paste. Normalize only boundaries, preserve raw labels
      // in staging, and continue rejecting embedded controls and malformed data.
      if (a.tags.length > 500 || !a.tags.every((t) => typeof t === 'string' && t.length <= 240))
        throw new Error('Invalid tag source terms');
      const rawTags = a.tags as string[];
      const tags = rawTags.map((t) => t.replace(/^[\s\u200B\uFEFF]+|[\s\u200B\uFEFF]+$/gu, ''));
      if (!tags.every((t) => t.length > 0 && !/[\p{Cc}\p{Cf}]/u.test(t))) throw new Error('Invalid tag source terms');
      const changed = tags.some((t, i) => t !== rawTags[i]);
      return {
        id: String(a.id),
        media: a.media,
        publishedAt: a.publishedAt,
        tags,
        ...(changed ? { rawTags, tagNormalization: 'boundary-whitespace-v1' as const } : {}),
      };
    });
    const nextCursor = data.nextCursor as string | null;
    if (nextCursor && (!/^\d{1,15}_\d{1,19}$/.test(nextCursor) || !articles.length)) throw new Error('Invalid continuation cursor');
    const position = (value: string) => {
      const [time, id] = value.split('_');
      return { time: BigInt(time!), id: BigInt(id!) };
    };
    const before = (a: ReturnType<typeof position>, b: ReturnType<typeof position>) =>
      a.time < b.time || (a.time === b.time && a.id < b.id);
    let previous = cursor ? position(cursor) : null;
    for (const article of articles) {
      const current = { time: BigInt(Date.parse(article.publishedAt)), id: BigInt(article.id) };
      if (previous && !before(current, previous)) throw new Error('Tag source cursor order did not advance');
      previous = current;
    }
    const last = articles.at(-1);
    if (nextCursor && last && nextCursor !== `${Date.parse(last.publishedAt)}_${last.id}`)
      throw new Error('Tag source continuation does not match last article');
    return { articles, nextCursor };
  }
}
