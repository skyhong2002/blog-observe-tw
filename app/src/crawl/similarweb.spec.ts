import * as filesystem from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { discoverSimilarSites, type TagSimilarSitesPayload } from './similarweb.ts';
import {
  createTagSimilarSitesClient,
  normalizeSimilarDomain,
  readTagSimilarwebToken,
  registerBlogWatchList,
  TAG_SIMILARWEB_BODY_LIMIT,
  TRAFFIC_SIMILARWEB_BASE,
  TRAFFIC_WATCH_URL,
} from './similarweb-client.ts';

// Fail the assertions if a future implementation revives local lock/budget I/O.
vi.mock('node:fs/promises', () => ({
  open: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
}));

const network = vi.fn(() => {
  throw new Error('Provider requests must remain disabled until the tag contract exists');
});

function expectNoIO() {
  expect(network).not.toHaveBeenCalled();
  for (const operation of Object.values(filesystem)) expect(operation).not.toHaveBeenCalled();
}

describe('Similarweb integration waits for the approved tag contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', network);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns no candidates or I/O by default and when explicitly disabled', async () => {
    await expect(discoverSimilarSites('  WWW.Example.com  ')).resolves.toEqual({
      enabled: false,
      domain: 'example.com',
      status: 'disabled',
      candidates: [],
    });
    await expect(discoverSimilarSites('example.com', { enabled: false })).resolves.toMatchObject({
      status: 'disabled',
      candidates: [],
    });
    expectNoIO();
  });

  it('cannot fetch or produce candidates when enabled without a tag adapter', async () => {
    await expect(discoverSimilarSites('example.com', { enabled: true })).resolves.toEqual({
      enabled: true,
      domain: 'example.com',
      status: 'awaiting-contract',
      candidates: [],
    });
    expectNoIO();
  });

  it('opts in only through enabled while ignoring retired endpoints and filesystem settings', async () => {
    const legacy = {
      BLOG_SIMILARWEB_ENABLED: 'true',
      BLOG_SIMILARWEB_ENDPOINT: 'http://127.0.0.1:18160/healthz',
      BLOG_SIMILARWEB_LOCK_PATH: '/tmp/retired-blog-similarweb-lock',
      BLOG_SIMILARWEB_BUDGET_PATH: '/tmp/retired-blog-similarweb-budget.json',
      BLOG_SIMILARWEB_MAX_PER_DAY: '9999',
    };
    for (const [name, value] of Object.entries(legacy)) vi.stubEnv(name, value);
    const config = loadConfig({ BLOG_DB_URL: 'mysql://blog:unused@127.0.0.1/blog_observe', ...legacy });
    expect(config.similarWeb).toEqual({ enabled: true });
    expect(loadConfig({ BLOG_DB_URL: 'mysql://blog:unused@127.0.0.1/blog_observe' }).similarWeb.enabled).toBe(false);
    await expect(discoverSimilarSites('example.com')).resolves.toMatchObject({ status: 'disabled', candidates: [] });
    await expect(discoverSimilarSites('example.com', config.similarWeb)).resolves.toMatchObject({
      status: 'awaiting-contract',
      candidates: [],
    });
    await expect(discoverSimilarSites('example.com', { enabled: true })).resolves.toMatchObject({
      status: 'awaiting-contract',
      candidates: [],
    });
    expectNoIO();
  });
});

const TOKEN = 'client-test-token-'.repeat(3);
const validPayload = (): TagSimilarSitesPayload => ({
  domain: 'medium.com',
  source: 'similarweb-extension',
  fetchedAt: '2026-10-12T10:00:00.000Z',
  requests: [{ kind: 'similar_sites', status: 'ok', requestedAt: '2026-10-12T01:00:00.000Z', attempts: 1, nextAttemptAt: null }],
  traffic: {
    monthly: [{ month: '202609', visits: 1200 }],
    globalRank: 12,
    countryRank: { code: 'TW', rank: 4 },
    category: 'blogs',
    topCountries: [{ code: 'TW', share: 0.8 }],
  },
  similarSites: ['other-blog.com'],
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

describe('tag-only Similarweb client', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });
  it('uses only the fixed loopback contract and does not forward credentials or follow redirects', async () => {
    const fetcher = vi.fn(async () => json(validPayload()));
    const client = createTagSimilarSitesClient({ fetcher, readToken: async () => TOKEN });
    const output = await client.getResult('https://www.Medium.com/path');
    expect(output).toMatchObject({
      status: 'ready',
      domain: 'medium.com',
      candidates: ['other-blog.com'],
      fetchedAt: '2026-10-12T10:00:00.000Z',
    });
    expect(output.sourceEvidence).toEqual(validPayload());
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${TRAFFIC_SIMILARWEB_BASE}/results?domain=medium.com`);
    expect(init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: { accept: 'application/json', authorization: `Bearer ${TOKEN}` },
    });
    expect(Object.keys(init.headers ?? {}).sort()).toEqual(['accept', 'authorization']);
    expect(JSON.stringify(output)).not.toContain(TOKEN);
  });
  it('submits only on explicit request, with no implicit GET or retry', async () => {
    const fetcher = vi.fn(async () => json({ domain: 'medium.com', kind: 'similar_sites', status: 'pending', created: true }, 202));
    const client = createTagSimilarSitesClient({ fetcher, readToken: async () => TOKEN });
    await expect(client.submit('medium.com')).resolves.toMatchObject({ status: 'pending', created: true, candidates: [] });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${TRAFFIC_SIMILARWEB_BASE}/requests`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ domain: 'medium.com', kind: 'similar_sites' });
  });
  it('distinguishes not_requested from authentication 404 without resubmitting', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ error: 'not_requested', domain: 'medium.com' }, 404))
      .mockResolvedValueOnce(json({ error: 'not found' }, 404));
    const client = createTagSimilarSitesClient({ fetcher, readToken: async () => TOKEN });
    await expect(client.getResult('medium.com')).resolves.toMatchObject({ status: 'not-requested', httpStatus: 404 });
    await expect(client.getResult('medium.com')).resolves.toMatchObject({ status: 'auth', httpStatus: 404 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['pending', 'pending'],
    ['no-data', 'no-data'],
    ['blocked', 'blocked'],
  ] as const)('never promotes cached similar sites when request status is %s', async (status, expected) => {
    const payload = validPayload();
    payload.requests[0].status = status;
    payload.requests[0].nextAttemptAt = '2026-10-12T16:00:00.000Z';
    const client = createTagSimilarSitesClient({ fetcher: vi.fn(async () => json(payload)), readToken: async () => TOKEN });
    await expect(client.getResult('medium.com')).resolves.toMatchObject({
      status: expected,
      candidates: [],
      nextAttemptAt: '2026-10-12T16:00:00.000Z',
    });
  });
  it('treats blocked traffic as a global stop even if similar_sites is ready', async () => {
    const payload = validPayload();
    payload.requests.push({ ...payload.requests[0], kind: 'traffic', status: 'blocked' });
    const client = createTagSimilarSitesClient({ fetcher: vi.fn(async () => json(payload)), readToken: async () => TOKEN });
    await expect(client.getResult('medium.com')).resolves.toMatchObject({ status: 'blocked', candidates: [] });
  });
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'blocked'],
  ] as const)('returns a stop status on HTTP %s without retries', async (code, status) => {
    const fetcher = vi.fn(async () => json({ error: 'daily_limit' }, code));
    const client = createTagSimilarSitesClient({ fetcher, readToken: async () => TOKEN });
    await expect(client.submit('medium.com')).resolves.toMatchObject({ status, httpStatus: code, candidates: [] });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects redirects and malformed/domain-mismatched responses without exposing their content', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://evil.com/' } }))
      .mockResolvedValueOnce(json({ ...validPayload(), domain: 'wrong.com' }))
      .mockResolvedValueOnce(json({ ...validPayload(), traffic: { ...validPayload().traffic, countryRank: 7 } }));
    const client = createTagSimilarSitesClient({ fetcher, readToken: async () => TOKEN });
    for (let index = 0; index < 3; index++)
      await expect(client.getResult('medium.com')).resolves.toMatchObject({ status: 'error', candidates: [] });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('retains only official nested evidence fields and strips incidental secrets', async () => {
    const expected = validPayload();
    const payload = {
      ...expected,
      authorization: TOKEN,
      token: TOKEN,
      headers: { 'Set-Cookie': TOKEN },
      requests: expected.requests.map((row) => ({ ...row, password: TOKEN })),
      traffic: {
        ...expected.traffic,
        monthly: expected.traffic?.monthly.map((row) => ({ ...row, secret: TOKEN })),
        countryRank: { ...expected.traffic?.countryRank, authorization: TOKEN },
        topCountries: expected.traffic?.topCountries.map((row) => ({ ...row, headers: TOKEN })),
        token: TOKEN,
      },
    };
    const fetcher = vi.fn(async () => json(payload));
    const client = createTagSimilarSitesClient({ fetcher, readToken: async () => TOKEN });
    const result = await client.getResult('medium.com');
    expect(result.sourceEvidence).toEqual(expected);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
  it('cancels a hanging streamed body when the 10-second deadline aborts', async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetcher = vi.fn(async () => new Response(body));
    const pending = createTagSimilarSitesClient({ fetcher, readToken: async () => TOKEN }).getResult('medium.com');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    deadline.abort();
    await expect(pending).resolves.toMatchObject({ status: 'error', candidates: [] });
    expect(cancelled).toBe(true);
    expect(timeout).toHaveBeenCalledWith(10_000);
  });
  it('cancels responses over 1 MiB instead of buffering unbounded data', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(TAG_SIMILARWEB_BODY_LIMIT + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const client = createTagSimilarSitesClient({ fetcher: vi.fn(async () => new Response(body)), readToken: async () => TOKEN });
    await expect(client.getResult('medium.com')).resolves.toMatchObject({ status: 'error', candidates: [] });
    expect(cancelled).toBe(true);
  });
  it('rejects declared oversized bodies before reading them', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const client = createTagSimilarSitesClient({
      fetcher: vi.fn(async () => new Response(body, { headers: { 'content-length': String(TAG_SIMILARWEB_BODY_LIMIT + 1) } })),
      readToken: async () => TOKEN,
    });
    await expect(client.getResult('medium.com')).resolves.toMatchObject({ status: 'error' });
    expect(cancelled).toBe(true);
  });
  it('does not request anything when token configuration is missing, invalid or throws', async () => {
    const fetcher = vi.fn();
    for (const readToken of [
      async () => null,
      async () => '',
      async () => `${TOKEN}\nheader`,
      async () => {
        throw new Error(TOKEN);
      },
    ]) {
      const result = await createTagSimilarSitesClient({ fetcher, readToken }).getResult('medium.com');
      expect(result).toMatchObject({ status: 'config', errorCode: 'token-unavailable' });
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    'localhost',
    'http://127.0.0.1/',
    'https://[::1]/',
    'blog.observe.tw',
    'x.ts.net',
    'name.internal',
    'user:pass@evil.com',
    'evil.com:123',
    'a..com',
    'x.test',
  ])('rejects invalid/private domain %s before token or network I/O', async (domain) => {
    const fetcher = vi.fn();
    const readToken = vi.fn();
    await expect(createTagSimilarSitesClient({ fetcher, readToken }).getResult(domain)).resolves.toMatchObject({
      status: 'error',
      errorCode: 'invalid-domain',
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(readToken).not.toHaveBeenCalled();
    expect(normalizeSimilarDomain(domain)).toBeNull();
  });
  it('ignores legacy endpoint overrides even with valid credentials', async () => {
    const fetcher = vi.fn(async () => json(validPayload()));
    const client = createTagSimilarSitesClient({
      fetcher,
      env: { BLOG_SIMILARWEB_TOKEN: TOKEN, BLOG_SIMILARWEB_ENDPOINT: 'https://evil.com/' },
    });
    await client.getResult('medium.com');
    expect(String((fetcher.mock.calls[0] as unknown as [string])[0])).toMatch(
      /^http:\/\/127\.0\.0\.1:18150\/internal\/similarweb\/results/,
    );
  });
  it('wrapper requires explicit client injection and never submits a request', async () => {
    const client = {
      getResult: vi.fn(async () => ({ enabled: true, domain: 'medium.com', status: 'pending' as const, candidates: [] })),
      submit: vi.fn(),
    };
    await expect(discoverSimilarSites('medium.com', { enabled: false, client })).resolves.toMatchObject({ status: 'disabled' });
    expect(client.getResult).not.toHaveBeenCalled();
    await expect(discoverSimilarSites('medium.com', { enabled: true, client })).resolves.toMatchObject({ status: 'pending' });
    expect(client.getResult).toHaveBeenCalledOnce();
    expect(client.submit).not.toHaveBeenCalled();
  });
});

describe('tag service token loading', () => {
  afterEach(() => vi.clearAllMocks());
  it('uses an explicit valid environment token without file I/O and fails closed on an invalid override', async () => {
    await expect(readTagSimilarwebToken({ BLOG_SIMILARWEB_TOKEN: TOKEN })).resolves.toBe(TOKEN);
    await expect(readTagSimilarwebToken({ BLOG_SIMILARWEB_TOKEN: 'short' })).resolves.toBeNull();
    expect(filesystem.open).not.toHaveBeenCalled();
  });
  it.each([0o644, 0o640, 0o400])('refuses token file mode %s', async (mode) => {
    const close = vi.fn(async () => {});
    const read = vi.fn();
    vi.mocked(filesystem.open).mockResolvedValue({
      stat: async () => ({ isFile: () => true, mode, uid: process.getuid?.(), size: 48 }),
      close,
      read,
    } as unknown as Awaited<ReturnType<typeof filesystem.open>>);
    await expect(readTagSimilarwebToken({})).resolves.toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
  it('opens only a non-symlink owned 600 file and strips its trailing newline', async () => {
    const close = vi.fn(async () => {});
    vi.mocked(filesystem.open).mockResolvedValue({
      stat: async () => ({ isFile: () => true, mode: 0o100600, uid: process.getuid?.(), size: TOKEN.length + 1 }),
      read: async (buffer: Buffer) => {
        buffer.write(`${TOKEN}\n`);
        return { bytesRead: TOKEN.length + 1 };
      },
      close,
    } as unknown as Awaited<ReturnType<typeof filesystem.open>>);
    await expect(readTagSimilarwebToken({})).resolves.toBe(TOKEN);
    expect(String(vi.mocked(filesystem.open).mock.calls[0][0])).toMatch(/\/.config\/observe-similarweb\/blog-token$/);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('registerBlogWatchList', () => {
  it("replaces blog's standing list at traffic.observe.tw with every normalised blog domain", async () => {
    const fetcher = vi.fn(async () => Response.json({ watched: 2, refused: [] }));
    const result = await registerBlogWatchList(['WWW.Example.com', 'example.com', 'other.blog', 'localhost'], {
      fetcher,
      tokenReader: async () => TOKEN,
    });
    expect(result).toEqual({ status: 'ok', watched: 2, refused: 0 });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TRAFFIC_WATCH_URL);
    expect(init.method).toBe('PUT');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body as string)).toEqual({ domains: ['example.com', 'other.blog'], refreshDays: 30 });
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
  });
  it('reports a missing token or a refusal without throwing', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 404 }));
    expect(await registerBlogWatchList(['example.com'], { fetcher, tokenReader: async () => null })).toEqual({ status: 'config' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await registerBlogWatchList(['example.com'], { fetcher, tokenReader: async () => TOKEN })).toEqual({
      status: 'error',
      httpStatus: 404,
    });
  });
});
