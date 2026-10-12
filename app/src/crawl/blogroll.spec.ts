import { describe, expect, it, vi } from 'vitest';
import { BLOGROLL_PARSER_VERSION, discoverBlogrolls, parseBlogrollPage } from './blogroll.ts';
import type { BlogrollObservation, BlogrollStore, DiscoveryPage } from './blogroll-contract.ts';
import type { FeedFetcher } from './feed.ts';

const root = 'https://directory.test/blogrollroll';
const one = 'https://first.test/blogroll';
const two = 'https://second.test/blogroll';
const target = 'https://writer.test/@author';
const table = (urls: string[]) =>
  `<main><table>${urls.map((u) => `<tr><td><a href="${u}">站主</a></td><td><a href="https://irrelevant.test">備註</a></td></tr>`).join('')}</table></main>`;
const child = `<main><table><tr><td>作者名稱</td><td><a href="${target}">Writer</a></td></tr></table><a href="https://third.test/blogroll">更多朋友</a></main><footer><a href="https://footer.test">Footer</a></footer>`;
function fixture(routes: Record<string, string | { status: number; headers?: Record<string, string> }>) {
  const pages = new Map<string, DiscoveryPage>();
  const observations: BlogrollObservation[] = [];
  const candidates = new Set<string>();
  const store: BlogrollStore = {
    acquire: vi.fn(async () => true),
    release: vi.fn(async () => undefined),
    getPage: vi.fn(async (url) => pages.get(url) ?? null),
    savePage: vi.fn(async (page) => {
      pages.set(page.url, page);
    }),
    observe: vi.fn(async (observation) => {
      observations.push(observation);
      const inserted = !candidates.has(observation.targetUrl);
      candidates.add(observation.targetUrl);
      return { inserted };
    }),
  };
  const fetcher = vi.fn<FeedFetcher>(async (input, init) => {
    const url = String(input);
    expect(init?.redirect).toBe('manual');
    expect(init?.dispatcher).toBeDefined();
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
    const value = routes[url];
    if (typeof value === 'string') return new Response(value, { headers: { 'content-type': 'text/html', etag: '"v1"' } });
    return new Response(null, { status: value?.status ?? 404, headers: value?.headers });
  });
  return {
    store,
    pages,
    observations,
    fetcher,
    options: { roots: [{ url: root, kind: 'directory' as const }], fetcher, resolveHost: async () => ['93.184.216.34'], delayMs: 250 },
  };
}

describe('bounded blogroll discovery', () => {
  it('follows directory first-column blogrolls and reads links in any child column, without fetching candidates', async () => {
    const f = fixture({ [root]: table([one, two]), [one]: child, [two]: child });
    const r = await discoverBlogrolls(f.store, f.options);
    expect(r.requests).toBe(3);
    expect(r.inserted).toBe(4);
    expect(f.observations.filter((o) => o.targetUrl === target).map((o) => o.path)).toEqual([
      [root, one, target],
      [root, two, target],
    ]);
    expect(f.fetcher.mock.calls.some(([url]) => /writer|third|footer|irrelevant/.test(String(url)))).toBe(false);
    expect(f.store.release).toHaveBeenCalledOnce();
  });

  it('reuses both 304 root and child caches while replaying provenance and child traversal', async () => {
    const routes: Parameters<typeof fixture>[0] = { [root]: table([one]), [one]: child };
    const f = fixture(routes);
    await discoverBlogrolls(f.store, f.options);
    routes[root] = { status: 304 };
    routes[one] = { status: 304 };
    f.observations.length = 0;
    const r = await discoverBlogrolls(f.store, f.options);
    expect(r.inserted).toBe(0);
    expect(r.requests).toBe(2);
    expect(r.pages.every((p) => p.status === 'not-modified')).toBe(true);
    expect(f.observations.some((o) => o.targetUrl === target && o.path.join(' -> ') === `${root} -> ${one} -> ${target}`)).toBe(true);
    expect(f.fetcher.mock.calls.filter(([url]) => String(url) === root).at(-1)?.[1]?.headers).toMatchObject({ 'if-none-match': '"v1"' });
  });

  it('does not share cached parse modes or obsolete versions', async () => {
    const f = fixture({ [root]: table([one]), [one]: child });
    await discoverBlogrolls(f.store, f.options);
    f.pages.set(root, { ...f.pages.get(root)!, parserVersion: BLOGROLL_PARSER_VERSION - 1 });
    await discoverBlogrolls(f.store, f.options);
    expect(f.fetcher.mock.calls.filter(([url]) => String(url) === root).at(-1)?.[1]?.headers).not.toHaveProperty('if-none-match');
  });

  it('re-fetches an unexpected 304 without a compatible cache only once and counts it in the budget', async () => {
    const f = fixture({ [root]: { status: 304 } });
    const r = await discoverBlogrolls(f.store, { ...f.options, maxPages: 2 });
    expect(r.requests).toBe(2);
    expect(r.pages[0]).toMatchObject({ status: 'error', error: 'HTTP 304' });
    expect(f.store.observe).not.toHaveBeenCalled();
  });

  it('fetches shared child once but preserves each root path; cached follow flags cannot create a third hop', async () => {
    const other = 'https://directory-two.test/roll';
    const f = fixture({ [root]: table([one]), [other]: table([one]), [one]: child });
    const r = await discoverBlogrolls(f.store, {
      ...f.options,
      roots: [
        { url: root, kind: 'directory' },
        { url: other, kind: 'directory' },
      ],
    });
    expect(r.requests).toBe(3);
    expect(f.observations.filter((o) => o.targetUrl === target).map((o) => o.rootUrl)).toEqual([root, other]);
    expect(f.fetcher.mock.calls.filter(([url]) => String(url) === one)).toHaveLength(1);
  });

  it('enforces observation limits even for already-known candidates and releases the lease on write failure', async () => {
    const f = fixture({ [root]: table([one, two]), [one]: child, [two]: child });
    const r = await discoverBlogrolls(f.store, { ...f.options, maxObservations: 2 });
    expect(r.observations).toBe(2);
    expect(r.truncated).toBe(true);
    vi.mocked(f.store.observe).mockRejectedValueOnce(new Error('write failed'));
    await expect(discoverBlogrolls(f.store, f.options)).rejects.toThrow('write failed');
    expect(f.store.release).toHaveBeenCalledTimes(2);
  });

  it('does no network work when another process holds the lease', async () => {
    const f = fixture({});
    vi.mocked(f.store.acquire).mockResolvedValue(false);
    expect((await discoverBlogrolls(f.store, f.options)).skipped).toBe('discovery-already-running');
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.store.release).not.toHaveBeenCalled();
  });

  it('does not expand party links and preserves distinct author paths', async () => {
    const f = fixture({ [root]: `<main><a href="https://medium.com/@one">One</a><a href="https://medium.com/@two">Two</a></main>` });
    const r = await discoverBlogrolls(f.store, { ...f.options, roots: [{ url: root, kind: 'party' }] });
    expect(r.requests).toBe(1);
    expect(f.observations.map((o) => o.targetUrl)).toEqual(['https://medium.com/@one', 'https://medium.com/@two']);
  });

  it('keeps SSRF protections on private DNS children and redirects, and continues safe sources', async () => {
    const unsafe = 'https://private-child.test/blogroll';
    const redirect = 'https://redirect-child.test/blogroll';
    const f = fixture({
      [root]: table([unsafe, redirect, one]),
      [redirect]: { status: 302, headers: { location: 'http://127.0.0.1:18160/healthz' } },
      [one]: child,
    });
    const r = await discoverBlogrolls(f.store, {
      ...f.options,
      resolveHost: async (host) => (host === 'private-child.test' ? ['127.0.0.1'] : ['93.184.216.34']),
    });
    expect(r.pages.filter((p) => p.error === 'unsafe-target')).toHaveLength(2);
    expect(f.observations.some((o) => o.targetUrl === target)).toBe(true);
    expect(f.fetcher.mock.calls.some(([url]) => /127\.0\.0\.1|private-child/.test(String(url)))).toBe(false);
  });

  it('rejects robots-disallowed children and literal private/nonstandard-port links', async () => {
    const f = fixture({ [root]: table([one, 'http://127.0.0.1/x', 'https://public.test:8080/x']) });
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (input, init) =>
      String(input) === `${new URL(one).origin}/robots.txt` ? new Response('User-agent: *\nDisallow: /') : original(input, init),
    );
    // Distinct host avoids another test's deliberately cached robots decision.
    const blocked = 'https://robots-child.test/blogroll';
    f.fetcher.mockImplementation(async (input, init) =>
      String(input) === 'https://robots-child.test/robots.txt'
        ? new Response('User-agent: *\nDisallow: /')
        : String(input) === root
          ? new Response(table([blocked, 'http://127.0.0.1/x', 'https://public.test:8080/x']), { headers: { 'content-type': 'text/html' } })
          : original(input, init),
    );
    const r = await discoverBlogrolls(f.store, f.options);
    expect(r.pages.find((p) => p.url === blocked)?.error).toBe('robots-disallowed');
    expect(f.fetcher.mock.calls.some(([url]) => String(url) === blocked)).toBe(false);
    expect(f.observations).toHaveLength(1);
  });
  it('rejects oversized child HTML and still releases the lease', async () => {
    const huge = 'https://huge-child.test/blogroll';
    const f = fixture({ [root]: table([huge]), [huge]: 'x'.repeat(5 * 1024 * 1024 + 1) });
    const r = await discoverBlogrolls(f.store, f.options);
    expect(r.pages.find((p) => p.url === huge)?.error).toBe('response-too-large');
    expect(f.store.release).toHaveBeenCalledOnce();
  });

  it('does not reuse a 304 cache after its final redirect destination changes', async () => {
    const moved = 'https://moved-directory.test/roll';
    const routes: Parameters<typeof fixture>[0] = { [root]: table([one]), [one]: child };
    const f = fixture(routes);
    await discoverBlogrolls(f.store, f.options);
    routes[root] = { status: 302, headers: { location: moved } };
    routes[moved] = { status: 304 };
    const r = await discoverBlogrolls(f.store, { ...f.options, maxPages: 2 });
    expect(r.requests).toBe(2);
    expect(r.pages[0]).toMatchObject({ status: 'error' });
    expect(r.pages.some((p) => p.url === one)).toBe(false);
  });

  it('preserves original root and final source URL when the root redirects', async () => {
    const moved = 'https://valid-moved-directory.test/roll';
    const f = fixture({ [root]: { status: 301, headers: { location: moved } }, [moved]: table([one]), [one]: child });
    await discoverBlogrolls(f.store, f.options);
    expect(f.observations[0].path).toEqual([root, moved, one]);
  });

  it('caps cached links too and never expands a cached child follow flag or cycle', async () => {
    const f = fixture({ [root]: table([one]), [one]: child });
    await discoverBlogrolls(f.store, f.options);
    const page = f.pages.get(one)!;
    f.pages.set(one, {
      ...page,
      links: [
        { url: root, text: 'Back', follow: true },
        { url: target, text: 'Author', follow: true },
      ],
    });
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (input, init) =>
      [root, one].includes(String(input)) ? new Response(null, { status: 304 }) : original(input, init),
    );
    const r = await discoverBlogrolls(f.store, { ...f.options, maxLinksPerPage: 1 });
    expect(r.requests).toBe(2);
    expect(r.observations).toBe(2);
    expect(r.truncated).toBe(true);
    expect(f.observations.at(-1)?.path).toEqual([root, one, root]);
  });
});

it('extracts the real two-column blogroll pattern without special-casing the acceptance domain', () => {
  expect(
    parseBlogrollPage(
      '<main><table><tr><td>Skychopath.</td><td><a href="https://skyhong.tw/">Sky Hong</a></td></tr></table></main>',
      one,
      'blogroll',
    ),
  ).toEqual([{ url: 'https://skyhong.tw', text: 'Sky Hong', follow: false }]);
});

it('stops fetching when the discovery lease is lost', async () => {
  const f = fixture({ [root]: table([one]), [one]: child });
  f.store.assertLease = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('lease lost'));
  await expect(discoverBlogrolls(f.store, f.options)).rejects.toThrow('lease lost');
  expect(f.fetcher.mock.calls.some(([url]) => String(url) === one)).toBe(false);
  expect(f.store.release).toHaveBeenCalledOnce();
});

it('aborts on page cache storage errors rather than reporting an upstream fetch failure', async () => {
  const f = fixture({ [root]: table([one]) });
  vi.mocked(f.store.savePage).mockRejectedValue(new Error('database unavailable'));
  await expect(discoverBlogrolls(f.store, f.options)).rejects.toThrow('database unavailable');
  expect(f.store.release).toHaveBeenCalledOnce();
});

const partyRoot = 'https://blogblog.club/party';
const monthRecap = 'https://host.test/month-recap';
const monthTopic = 'https://host.test/month-topic';
const monthSection = (participants: string[], recap = true) => `<h3>第 1 期：推坑</h3><ul>
<li>主題頁面：<a href="${monthTopic}">本月主題</a></li>
${recap ? `<li>回顧文章：<a href="${monthRecap}">本月回顧</a></li>` : ''}
<li>參與者（共 ${participants.length} 篇）：${participants.map((url) => `<a href="${url}">投稿作者</a>`).join('')}</li></ul>`;

it('keeps late monthly sources within the link budget and prefers recap to topic', () => {
  const submissions = Array.from({ length: 1010 }, (_, i) => `https://writer${i}.test/post`);
  const html = `<main><h2>第 2 期：新主題</h2><ul><li>主題頁面：<a href="https://current.test/topic">主題</a></li>
  <li>參與者（共 1010 篇）：${submissions.map((url) => `<a href="${url}">投稿</a>`).join('')}</li></ul>${monthSection([target])}</main>`;
  const links = parseBlogrollPage(html, partyRoot, 'party');
  expect(links).toHaveLength(1000);
  expect(links.filter((link) => link.follow).map((link) => link.url)).toEqual(['https://current.test/topic', monthRecap]);
  expect(links.find((link) => link.url === monthTopic)?.follow).toBe(false);
  expect(parseBlogrollPage(html, 'https://elsewhere.test/party', 'party').some((link) => link.follow)).toBe(false);
  expect(parseBlogrollPage(html, 'https://blogblog.club/random', 'party').some((link) => link.follow)).toBe(false);
});

it('recovers omitted party links via one labelled month source and measures exact URL coverage', async () => {
  const f = fixture({
    [partyRoot]: `<main>${monthSection([target])}</main>`,
    [monthRecap]: `<main><a href="${target}">投稿者</a><a href="https://third.test/more">更多文章</a></main>`,
  });
  const report = await discoverBlogrolls(f.store, {
    ...f.options,
    roots: [{ url: partyRoot, kind: 'party' }],
    maxLinksPerPage: 2,
  });
  expect(report.requests).toBe(2);
  expect(report.truncated).toBe(true);
  expect(report.blogrollEdges).toBe(0);
  expect(report.partyCoverage).toEqual([
    { rootUrl: partyRoot, status: 'measured', omitted: 1, recovered: 1, remaining: 0, overflow: false },
  ]);
  expect(f.observations.find((o) => o.targetUrl === target)).toMatchObject({
    relation: 'party',
    sourceUrl: monthRecap,
    path: [partyRoot, monthRecap, target],
  });
  expect(f.fetcher.mock.calls.some(([url]) => [target, monthTopic, 'https://third.test/more'].includes(String(url)))).toBe(false);
});

it('replays cached party month sources after 304 without claiming unmeasured omission coverage', async () => {
  const f = fixture({ [partyRoot]: `<main>${monthSection([target])}</main>`, [monthRecap]: `<main><a href="${target}">投稿者</a></main>` });
  const options = { ...f.options, roots: [{ url: partyRoot, kind: 'party' as const }] };
  await discoverBlogrolls(f.store, options);
  f.pages.get(monthRecap)!.links[0].follow = true; // Cached child metadata must not enable a third hop.
  const original = f.fetcher.getMockImplementation()!;
  f.fetcher.mockImplementation(async (input, init) =>
    [partyRoot, monthRecap].includes(String(input)) ? new Response(null, { status: 304 }) : original(input, init),
  );
  const report = await discoverBlogrolls(f.store, options);
  expect(report.requests).toBe(2);
  expect(report.pages.map((page) => page.status)).toEqual(['not-modified', 'not-modified']);
  expect(report.partyCoverage).toEqual([
    { rootUrl: partyRoot, status: 'cached-unknown', omitted: null, recovered: 0, remaining: null, overflow: false },
  ]);
  expect(f.observations.filter((o) => o.sourceUrl === monthRecap)).toHaveLength(2);
  expect(f.fetcher.mock.calls.some(([url]) => String(url) === target)).toBe(false);
});

it('counts party month fetches and failures in page budgets without retrying a forbidden source', async () => {
  const f = fixture({ [partyRoot]: `<main>${monthSection([target], false)}</main>`, [monthTopic]: { status: 403 } });
  const options = { ...f.options, roots: [{ url: partyRoot, kind: 'party' as const }] };
  const capped = await discoverBlogrolls(f.store, { ...options, maxPages: 1 });
  expect(capped.requests).toBe(1);
  expect(capped.truncated).toBe(true);
  expect(f.fetcher.mock.calls.some(([url]) => String(url) === monthTopic)).toBe(false);
  const report = await discoverBlogrolls(f.store, options);
  expect(report.requests).toBe(2);
  expect(report.pages.at(-1)).toMatchObject({ url: monthTopic, status: 'error', error: 'HTTP 403' });
  expect(f.fetcher.mock.calls.filter(([url]) => String(url) === monthTopic)).toHaveLength(1);
});

it('retains the monthly host submissions before other participants because recap parsing excludes its own host', () => {
  const links = parseBlogrollPage(
    `<main>${monthSection(['https://other.test/post', 'https://host.test/my-submission'])}</main>`,
    partyRoot,
    'party',
    3,
  );
  expect(links.map((link) => link.url)).toEqual([monthRecap, monthTopic, 'https://host.test/my-submission']);
});
