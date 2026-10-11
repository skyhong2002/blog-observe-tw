import { describe, expect, it } from 'vitest';
import { isAllowedCrawlUrl, isBlockedAddress, MAX_RESPONSE_BYTES, parseFeed, parseSitemap, politeFetch, validateCrawlUrl } from './feed.ts';

describe('feed parsing', () => {
  it('parses RSS and Atom links without fetching article bodies', () => {
    const rss =
      '<rss><channel><item><guid>r1</guid><title>RSS</title><link>https://example.test/rss/1</link><description>short</description></item></channel></rss>';
    const atom =
      '<feed><entry><id>a1</id><title>Atom</title><link href="https://example.test/atom/1" rel="alternate"/><updated>2025-01-01T00:00:00Z</updated></entry></feed>';
    expect(parseFeed(rss, 'https://example.test')).toMatchObject([{ guid: 'r1', title: 'RSS', url: 'https://example.test/rss/1' }]);
    expect(parseFeed(atom, 'https://example.test')).toMatchObject([{ guid: 'a1', title: 'Atom', url: 'https://example.test/atom/1' }]);
  });

  it('drops unsafe discovered article links instead of falling back to the feed URL', () => {
    const xml =
      '<rss><channel><item><guid>private</guid><title>Private</title><link>http://127.0.0.1/secret</link></item><item><guid>ftp</guid><title>FTP</title><link>ftp://example.test/post</link></item></channel></rss>';
    expect(parseFeed(xml, 'https://example.test/feed.xml')).toEqual([]);
  });

  it('treats sitemap lastmod as updatedAt and keeps the URL as guid', () => {
    const [item] = parseSitemap(
      '<urlset><url><loc>https://example.test/post</loc><lastmod>2025-01-02</lastmod></url></urlset>',
      'https://example.test',
    );
    expect(item).toMatchObject({ guid: 'https://example.test/post', url: 'https://example.test/post' });
    expect(item.updatedAt?.toISOString()).toContain('2025-01-02');
  });
});

describe('crawl request safety', () => {
  it('allows only default web ports and blocks private, link-local, and CGNAT addresses', () => {
    expect(isAllowedCrawlUrl('https://example.test/')).toBe(true);
    expect(isAllowedCrawlUrl('https://example.test:8443/')).toBe(false);
    expect(isAllowedCrawlUrl('http://127.0.0.1/')).toBe(false);
    expect(isAllowedCrawlUrl('http://[::1]/')).toBe(false);
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('100.64.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('2001:db8::1')).toBe(true);
  });

  it('rejects unresolved and private DNS answers before fetch', async () => {
    const fetcher = async () => {
      throw new Error('must not fetch');
    };
    await expect(validateCrawlUrl('https://missing.test/', async () => [])).rejects.toThrow('unsafe crawl address');
    await expect(validateCrawlUrl('https://private.test/', async () => ['192.168.1.20'])).rejects.toThrow('unsafe crawl address');
    await expect(politeFetch('https://private.test/', {}, { fetcher, resolveHost: async () => ['10.0.0.4'] })).rejects.toThrow(
      'unsafe crawl address',
    );
  });

  it('checks robots and redirect targets through the same URL gate', async () => {
    const host = `redirect-${Date.now()}.test`;
    const calls: string[] = [];
    const fetcher = async (input: string | Request | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/robots.txt')) return new Response('', { status: 200 });
      return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
    };
    await expect(
      politeFetch(`https://${host}/feed.xml`, {}, { delayMs: 250, fetcher, resolveHost: async () => ['93.184.216.34'] }),
    ).rejects.toThrow('unsafe crawl URL');
    expect(calls).toEqual([`https://${host}/robots.txt`, `https://${host}/feed.xml`]);
  });

  it('honors a matching robots disallow rule before requesting the feed', async () => {
    const host = `robots-${Date.now()}.test`;
    const calls: string[] = [];
    const fetcher = async (input: string | Request | URL) => {
      const url = String(input);
      calls.push(url);
      return url.endsWith('/robots.txt') ? new Response('User-agent: blog.observe.tw\nDisallow: /private\n') : new Response('');
    };
    await expect(
      politeFetch(`https://${host}/private/post.xml`, {}, { delayMs: 250, fetcher, resolveHost: async () => ['93.184.216.34'] }),
    ).rejects.toThrow('robots disallow');
    expect(calls).toEqual([`https://${host}/robots.txt`]);
  });

  it('rejects response bodies larger than 5 MB, including chunked responses', async () => {
    const host = `large-${Date.now()}.test`;
    const tooLarge = 'x'.repeat(MAX_RESPONSE_BYTES + 1);
    const fetcher = async (input: string | Request | URL) =>
      String(input).endsWith('/robots.txt') ? new Response('') : new Response(tooLarge, { headers: { 'content-type': 'text/xml' } });
    await expect(
      politeFetch(`https://${host}/feed.xml`, {}, { delayMs: 250, fetcher, resolveHost: async () => ['93.184.216.34'] }),
    ).rejects.toThrow(`crawl response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  });
});
