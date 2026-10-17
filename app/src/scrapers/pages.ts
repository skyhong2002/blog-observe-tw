import { type FeedCrawlerOptions, politeFetch, readFeedBody } from '../crawl/feed.ts';
import type { SandboxPage } from './sandbox.ts';

/** Trusted fetching for generated scrapers: politeFetch's robots, host delay, DNS pinning and size cap.
 * Listings may be XML (a feed the publication hides in a section); articles are always HTML. */
export async function fetchHtml(url: string, options: FeedCrawlerOptions, allowXml = false): Promise<SandboxPage> {
  const response = await politeFetch(url, { accept: 'text/html,application/xhtml+xml;q=0.9' }, options);
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(`http_${response.status}`);
  }
  const mime = response.headers.get('content-type') || '';
  const xml = allowXml && /(?:application|text)\/(?:[\w.+-]+\+)?xml/i.test(mime) && !/xhtml/i.test(mime);
  if (!xml && !/text\/html|application\/xhtml/i.test(mime)) {
    await response.body?.cancel();
    throw Error('content_type_mismatch');
  }
  const html = await readFeedBody(response);
  if (xml && /<!DOCTYPE|<!ENTITY/i.test(html)) throw Error('unsafe_xml');
  return { url: response.url || url, html, ...(xml ? { xml: true } : {}) };
}
export const fetchFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (/^(?:http_\d{3}|content_type_mismatch|unsafe_xml)$/.test(message)) return message;
  if (/robots/i.test(message)) return 'robots_disallowed';
  if (/timeout|abort/i.test(message)) return 'timeout';
  if (/exceeds/i.test(message)) return 'response_too_large';
  return 'fetch_failed';
};
