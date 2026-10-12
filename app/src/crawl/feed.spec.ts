import net, { type LookupFunction, type TcpNetConnectOpts } from 'node:net';
import { gzipSync } from 'node:zlib';
import { type Agent, fetch as undiciFetch } from 'undici';
import { describe, expect, it, vi } from 'vitest';
import {
  type FeedFetcher,
  isAllowedCrawlUrl,
  isBlockedAddress,
  MAX_RESPONSE_BYTES,
  parseFeed,
  parseSitemap,
  politeFetch,
  rankedSitemapUrls,
  readFeedBody,
  validateCrawlUrl,
} from './feed.ts';

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
    for (const url of ['http://[::ffff:7f00:1]/', 'http://2130706433/', 'http://0x7f.1/']) expect(isAllowedCrawlUrl(url)).toBe(false);
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('100.64.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('2001:db8::1')).toBe(true);
    for (const address of [
      'fd00::1',
      'fc00::1',
      'fe80::1',
      'fec0::1',
      'ff02::1',
      '::ffff:5db8:d822',
      '::ffff:93.184.216.34',
      '::93.184.216.34',
      '64:ff9b::7f00:1',
      '2001::1',
      '2002:7f00:1::',
      '2001:2::1',
      '3fff::1',
      '5f00::1',
      '2606:4700::1%eth0',
    ])
      expect(isBlockedAddress(address)).toBe(true);
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
    expect(isBlockedAddress('2001:4860:4860::8888')).toBe(false);
  });

  it('uses exact special-purpose CIDRs without blocking public neighboring networks', () => {
    for (const address of ['192.0.0.1', '192.0.2.1', '192.88.99.1', '198.51.100.1', '203.0.113.1', '192.168.1.1', '198.18.1.1'])
      expect(isBlockedAddress(address)).toBe(true);
    for (const address of [
      '192.0.78.12',
      '192.0.78.13',
      '192.0.1.1',
      '192.0.3.1',
      '192.88.98.1',
      '192.88.100.1',
      '198.51.99.1',
      '198.51.101.1',
      '203.0.112.1',
      '203.0.114.1',
    ])
      expect(isBlockedAddress(address)).toBe(false);
  });

  it('removes stale compressed wire headers from the consumed body while preserving final URL and validators', async () => {
    const fetcher: FeedFetcher = async (input) =>
      String(input).endsWith('/robots.txt')
        ? new Response('')
        : new Response('already decompressed', {
            headers: { 'content-encoding': 'gzip', 'content-length': '7', etag: 'compressed-v1', 'content-type': 'text/html' },
          });
    const result = await politeFetch('https://decompressed-headers.test/page', {}, { fetcher, resolveHost: async () => ['93.184.216.34'] });
    expect(await result.text()).toBe('already decompressed');
    expect(result.headers.has('content-encoding')).toBe(false);
    expect(result.headers.has('content-length')).toBe(false);
    expect(result.headers.get('etag')).toBe('compressed-v1');
    expect(result.url).toBe('https://decompressed-headers.test/page');
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
  it('rejects mixed public/private DNS answers as a whole', async () => {
    const fetcher = vi.fn();
    await expect(
      politeFetch(
        'https://mixed-addresses.test/feed',
        {},
        {
          fetcher,
          resolveHost: async () => ['93.184.216.34', 'fd00::1'],
        },
      ),
    ).rejects.toThrow('unsafe crawl address');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('pins the real fetch socket lookup to validated DNS even after the answer changes', async () => {
    // Intercept the socket boundary, not fetch or the dispatcher: no network
    // connection is made, but Node/undici must actually use our lookup.
    const connections: Array<{ host: string; lookup: LookupFunction }> = [];
    const connect = vi.spyOn(net, 'connect').mockImplementation((...args: unknown[]) => {
      const options = args[0] as TcpNetConnectOpts;
      const socket = new net.Socket();
      if (options.lookup) connections.push({ host: options.host ?? '', lookup: options.lookup });
      queueMicrotask(() => socket.destroy(new Error('test socket boundary: network disabled')));
      return socket;
    });
    let answer = ['93.184.216.34', '2606:4700:4700::1111'];
    const resolveHost = vi.fn(async () => [...answer]);
    const dispatchers: Agent[] = [];
    const fetcher: FeedFetcher = async (input, init) => {
      dispatchers.push(init?.dispatcher as Agent);
      if (String(input).endsWith('/robots.txt')) {
        answer = ['127.0.0.1']; // Attacker rebinds after validation.
        return new Response('');
      }
      return (undiciFetch as FeedFetcher)(input, init);
    };
    try {
      await expect(politeFetch('http://pinned-socket.test/feed.xml', {}, { fetcher, resolveHost })).rejects.toThrow('fetch failed');
      expect(connections).toHaveLength(1);
      expect(connections[0].host).toBe('pinned-socket.test');
      const pinned = connections[0].lookup;
      const one = vi.fn();
      pinned('pinned-socket.test', {}, one);
      expect(one).toHaveBeenCalledWith(null, '93.184.216.34', 4);
      const all = vi.fn();
      pinned('pinned-socket.test', { all: true }, all);
      expect(all).toHaveBeenCalledWith(null, [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ]);
      const ipv6 = vi.fn();
      pinned('pinned-socket.test', { family: 6, all: true }, ipv6);
      expect(ipv6).toHaveBeenCalledWith(null, [{ address: '2606:4700:4700::1111', family: 6 }]);
      const wrongHost = vi.fn();
      pinned('another-host.test', {}, wrongHost);
      expect(wrongHost.mock.calls[0][0]?.code).toBe('ENOTFOUND');
      expect(resolveHost).toHaveBeenCalledTimes(2); // Initial URL plus robots; socket never resolves again.
      expect(dispatchers).toHaveLength(2);
      expect(dispatchers.every((dispatcher) => dispatcher.destroyed)).toBe(true);
    } finally {
      connect.mockRestore();
    }
  });

  it('uses the pinned dispatcher with the production fetch implementation', async () => {
    const lookups: LookupFunction[] = [];
    const connect = vi.spyOn(net, 'connect').mockImplementation((...args: unknown[]) => {
      const options = args[0] as TcpNetConnectOpts;
      if (options.lookup) lookups.push(options.lookup);
      const socket = new net.Socket();
      queueMicrotask(() => socket.destroy(new Error('test socket boundary: network disabled')));
      return socket;
    });
    try {
      // No injected fetcher: catches mismatches between installed undici Agent
      // and Node's bundled fetch before they silently break all real crawls.
      await expect(
        politeFetch(
          'http://production-pinned.test/feed',
          {},
          {
            resolveHost: async () => ['93.184.216.34'],
          },
        ),
      ).rejects.toThrow('robots disallow');
      expect(lookups).toHaveLength(1);
      const callback = vi.fn();
      lookups[0]('production-pinned.test', { all: true }, callback);
      expect(callback).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
      const absentFamily = vi.fn();
      lookups[0]('production-pinned.test', { family: 6 }, absentFamily);
      expect(absentFamily.mock.calls[0][0]?.code).toBe('ENOTFOUND');
    } finally {
      connect.mockRestore();
    }
  });

  it('pins robots redirects and content redirects separately and preserves the final response URL', async () => {
    const dispatchers: Agent[] = [];
    const requested: string[] = [];
    const resolveHost = vi.fn(async () => ['93.184.216.34']);
    const fetcher: FeedFetcher = async (input, init) => {
      const url = String(input);
      requested.push(url);
      dispatchers.push(init?.dispatcher as Agent);
      expect(init?.redirect).toBe('manual');
      if (url === 'https://redirect-pinned.test/robots.txt')
        return new Response('', { status: 302, headers: { location: 'https://robots-pinned.test/rules' } });
      if (url.endsWith('/rules') || url.endsWith('/robots.txt')) return new Response('');
      if (url.endsWith('/start')) return new Response('', { status: 302, headers: { location: 'https://final-pinned.test/blog/' } });
      return new Response('<link rel="icon" href="favicon.png">');
    };
    const response = await politeFetch('https://redirect-pinned.test/start', {}, { fetcher, resolveHost });
    expect(response.url).toBe('https://final-pinned.test/blog/');
    expect(new URL('favicon.png', response.url).toString()).toBe('https://final-pinned.test/blog/favicon.png');
    expect(requested).toEqual([
      'https://redirect-pinned.test/robots.txt',
      'https://robots-pinned.test/rules',
      'https://redirect-pinned.test/start',
      'https://final-pinned.test/robots.txt',
      'https://final-pinned.test/blog/',
    ]);
    expect(resolveHost.mock.calls).toHaveLength(5);
    expect(dispatchers).toHaveLength(5);
    expect(new Set(dispatchers).size).toBe(5);
    expect(dispatchers.every((dispatcher) => dispatcher.destroyed)).toBe(true);
  });

  it('blocks a private robots redirect before requesting its destination', async () => {
    const calls: string[] = [];
    const fetcher: FeedFetcher = async (input) => {
      calls.push(String(input));
      return new Response('', { status: 302, headers: { location: 'http://[fd00::1]/rules' } });
    };
    await expect(
      politeFetch(
        'https://private-robots-redirect.test/feed',
        {},
        {
          fetcher,
          resolveHost: async () => ['93.184.216.34'],
        },
      ),
    ).rejects.toThrow('robots disallow');
    expect(calls).toEqual(['https://private-robots-redirect.test/robots.txt']);
  });

  it('destroys the pinned dispatcher when a streamed response exceeds the limit', async () => {
    const dispatchers: Agent[] = [];
    const fetcher: FeedFetcher = async (input, init) => {
      dispatchers.push(init?.dispatcher as Agent);
      return String(input).endsWith('/robots.txt') ? new Response('') : new Response('x'.repeat(MAX_RESPONSE_BYTES + 1));
    };
    await expect(
      politeFetch(
        'https://oversize-cleanup.test/feed',
        {},
        {
          fetcher,
          resolveHost: async () => ['93.184.216.34'],
        },
      ),
    ).rejects.toThrow('crawl response exceeds');
    expect(dispatchers).toHaveLength(2);
    expect(dispatchers.every((dispatcher) => dispatcher.destroyed)).toBe(true);
  });
});

describe('bounded compressed XML sources', () => {
  it('reads a gzip sitemap without Content-Encoding and preserves actual XML URLs', async () => {
    const xml = '<urlset><url><loc>https://gzip-feed.test/post</loc></url></urlset>';
    const response = new Response(gzipSync(xml), { headers: { 'content-type': 'application/gzip' } });
    const decoded = await readFeedBody(response);
    expect(decoded).toBe(xml);
    expect(parseSitemap(decoded, 'https://gzip-feed.test/')).toMatchObject([{ url: 'https://gzip-feed.test/post', publishedAt: null }]);
  });

  it('does not decompress already-decoded XML a second time based on a stale gzip header', async () => {
    const xml = '<rss><channel><title>Plain XML</title></channel></rss>';
    expect(await readFeedBody(new Response(xml, { headers: { 'content-encoding': 'gzip' } }))).toBe(xml);
  });

  it('rejects gzip output exceeding 5 MiB, even with a tiny compressed body', async () => {
    const compressed = gzipSync('x'.repeat(MAX_RESPONSE_BYTES + 1));
    expect(compressed.length).toBeLessThan(10_000);
    await expect(readFeedBody(new Response(compressed))).rejects.toThrow(`decompressed crawl response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  });

  it('rejects corrupt gzip and oversized plain XML bodies', async () => {
    await expect(readFeedBody(new Response(Buffer.from([0x1f, 0x8b, 0, 0])))).rejects.toThrow('invalid gzip feed response');
    await expect(readFeedBody(new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)))).rejects.toThrow('crawl response exceeds');
  });
});

it('defensively ignores malformed or unsafe direct sitemap ranking inputs', () => {
  expect(
    rankedSitemapUrls([
      'https://rank-safe.test/misc.xml',
      'http://[',
      '/relative.xml',
      'http://127.0.0.1/private.xml',
      'https://rank-safe.test/post.xml',
    ]),
  ).toEqual(['https://rank-safe.test/post.xml', 'https://rank-safe.test/misc.xml']);
});
