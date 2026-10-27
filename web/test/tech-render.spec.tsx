/**
 * /tech/, the profile's 使用的技術 and the nav switch, rendered for real
 * (react-dom/server) and read back with cheerio. Next's hooks, links and images,
 * usePublicJson, the server-only gateway reads and the feature flag are mocked;
 * nothing is fetched. Every payload is a synthetic fixture (no real blog,
 * site or measurement). Server markup only: phone geometry, the sticky column
 * while scrolling, truncation as drawn and tapping <details> are not exercised.
 */
import { type CheerioAPI, load } from 'cheerio';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import ErrorPage from '@/app/error';
import NotFound from '@/app/not-found';
import TechPage from '@/app/tech/page';
import BlogTech, { distinctTechEvidence, techEvidenceKey } from '@/components/BlogTech';
import FooterMethod from '@/components/FooterMethod';
import TechStatsView, { TechStatsFromUrl } from '@/components/public/TechStats';
import SiteNavigation from '@/components/SiteNavigation';
import { taipei } from '@/lib/api';
import { PublicGatewayError } from '@/lib/public-read';
import type { BlogTechPayload, TechBlog, TechDetection, TechStats } from '@/lib/tech';
import type { PublicLoad } from '@/lib/use-public-json';

const nav = vi.hoisted(() => ({ pathname: '/tech/', search: '' }));
const publicJson = vi.hoisted(() => ({ load: null as unknown, paths: [] as Array<string | null> }));
const gateway = vi.hoisted(() => ({ answer: (_path: string): Promise<unknown> => Promise.resolve(null), paths: [] as string[] }));
const flag = vi.hoisted(() => ({ on: true }));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
// The prefetch value NoPrefetchLink passes is kept as data-prefetch, so the markup shows it.
vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ prefetch, scroll: _scroll, ...props }: Record<string, unknown>) =>
      createElement('a', { ...props, 'data-prefetch': String(prefetch) }),
    useLinkStatus: () => ({ pending: false }),
  };
});
vi.mock('next/image', async () => {
  const { createElement } = await import('react');
  return { default: ({ unoptimized: _unoptimized, ...props }: Record<string, unknown>) => createElement('img', props) };
});
vi.mock('@/lib/use-public-json', () => ({
  usePublicJson: (path: string | null) => {
    publicJson.paths.push(path);
    return path ? publicJson.load : null;
  },
  asIs: (raw: unknown) => raw,
}));
// The server-only gateway reads: every path asked is recorded and answered by gateway.answer.
vi.mock('@/lib/public-api', () => ({
  publicJsonOrNull: (path: string) => {
    gateway.paths.push(path);
    return gateway.answer(path);
  },
}));
vi.mock('@/lib/tech-flag', () => ({ techPublicEnabled: () => flag.on }));

beforeEach(() => {
  nav.pathname = '/tech/';
  nav.search = '';
  publicJson.load = { status: 'pending' };
  publicJson.paths = [];
  gateway.answer = () => Promise.resolve(null);
  gateway.paths = [];
  flag.on = true;
});

// app/layout.tsx: the page, then SiteFooter, whose only method piece is <FooterMethod />.
function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <main>{children}</main>
      <footer>
        <FooterMethod />
      </footer>
    </>
  );
}
const render = (page: ReactNode) => load(renderToString(<Layout>{page}</Layout>));

const SUMMARY = '本頁的資料來源與計算方式';
const methodBlocks = ($: CheerioAPI) => $('details').filter((_, el) => $(el).children('summary').text().includes(SUMMARY));
/** Page text with every <details> taken out: what a reader sees before opening anything. */
function outsideText($: CheerioAPI) {
  const copy = load($.html());
  copy('details').remove();
  return copy('main').text();
}
/** Exactly one closed method block, inside the page; the layout footer's copy is left out on /tech/. */
function expectOneBlock($: CheerioAPI) {
  const blocks = methodBlocks($);
  expect(blocks.length).toBe(1);
  expect($('details').length).toBe(1);
  expect($('#method').length).toBe(1);
  expect(blocks.attr('open')).toBeUndefined();
  expect(blocks.closest('main').length).toBe(1);
  expect($('footer details').length).toBe(0);
  return blocks;
}
/** Every internal link went through NoPrefetchLink, which turns prefetch off. */
function expectNoPrefetch($: CheerioAPI) {
  const internal = $('a[href^="/"], a[href^="#"]');
  expect(internal.length).toBeGreaterThan(0);
  internal.each((_, el) => {
    expect($(el).attr('data-prefetch'), $(el).attr('href')).toBe('false');
  });
}
const card = ($: CheerioAPI, label: string) =>
  $('main a, main div')
    .filter((_, el) => $(el).children('div').first().text() === label)
    .first();
/** The blog list's rows and table; the ranking above is a table of its own. */
const blogRows = ($: CheerioAPI) => $('section[aria-labelledby="tech-blogs"] tbody tr');
const blogTable = ($: CheerioAPI) => $('section[aria-labelledby="tech-blogs"] table');
const rowOf = ($: CheerioAPI, name: string) => blogRows($).filter((_, el) => $(el).find('td').first().text().includes(name));
/** A status filter chip (FilterChips), found by its label. */
const statusChip = ($: CheerioAPI, label: string) =>
  $('nav[aria-label="辨識狀態"] a').filter((_, el) => $(el).text().startsWith(`${label} `));
const rankRow = ($: CheerioAPI, name: string) =>
  $('section[aria-labelledby="tech-ranking"] tbody tr').filter((_, el) => $(el).find('td').first().text() === name);

/* Synthetic fixtures ------------------------------------------------------- */

const OBSERVED = '2026-10-10T02:00:00.000Z';
const OLD_SUCCESS = '2026-09-01T02:00:00.000Z';
const LAST_ATTEMPT = '2026-10-11T02:00:00.000Z';
const htmlCoverage = {
  partial: true,
  method: 'passive-existing-response',
  sourceType: 'html',
  htmlTruncated: false,
  inspectedNodes: 120,
} as const;
const fragmentCoverage = { ...htmlCoverage, sourceType: 'body-fragment' } as const;
const detection = (patch: Partial<TechDetection> & Pick<TechDetection, 'id' | 'name' | 'category'>): TechDetection => ({
  version: 'unknown',
  confidence: 0.95,
  ruleId: `synthetic-${patch.id}`,
  ruleVersion: 'passive-tech-v1',
  observedAt: OBSERVED,
  evidence: [{ kind: 'marker', value: `synthetic-${patch.id}` }],
  ...patch,
});
const cms = detection({
  id: 'wordpress',
  name: 'WordPress',
  category: 'cms',
  version: '6.4',
  evidence: [{ kind: 'generator', value: 'WordPress 6.4' }],
});
const plugin = detection({ id: 'wp-plugin:elementor', name: 'Elementor', category: 'plugin', confidence: 0.7 });
const cdn = detection({
  id: 'cloudflare',
  name: 'Cloudflare',
  category: 'cdn',
  confidence: 0.3,
  evidence: [{ kind: 'header', value: 'cf-ray' }],
});
// A version sent without evidence: never shown.
const unprovenCms = detection({
  id: 'wordpress',
  name: 'WordPress',
  category: 'cms',
  version: '6.5',
  evidence: [],
  observedAt: OLD_SUCCESS,
});

const blog = (id: number, name: string, patch: Partial<TechBlog>): TechBlog => ({
  id,
  slug: `synthetic-${id}`,
  name,
  url: `https://weblog.tw/blogs/s${id}.example/`,
  sourceUrl: `https://s${id}.example/`,
  iconUrl: null,
  status: 'not-observed',
  observedAt: null,
  lastAttemptAt: null,
  errorCode: null,
  evidenceSourceUrl: null,
  coverage: null,
  detections: [],
  ...patch,
});
const detectedBlog = blog(1, '測試站甲', {
  status: 'detected',
  observedAt: OBSERVED,
  lastAttemptAt: OBSERVED,
  evidenceSourceUrl: 'https://s1.example/',
  coverage: htmlCoverage,
  detections: [cdn, cms, plugin],
});
const unknownBlog = blog(2, '測試站乙', { status: 'unknown', observedAt: OBSERVED, lastAttemptAt: OBSERVED, coverage: fragmentCoverage });
const failedBlog = blog(3, '測試站丙', {
  status: 'failed',
  observedAt: OLD_SUCCESS,
  lastAttemptAt: LAST_ATTEMPT,
  errorCode: 'timeout',
  coverage: htmlCoverage,
  detections: [unprovenCms],
});
const blockedBlog = blog(4, '測試站丁', { status: 'blocked', lastAttemptAt: LAST_ATTEMPT, errorCode: 'robots' });
// No registry page: shown as text, never a link built from the slug.
const unregisteredBlog = blog(5, '測試站戊', { url: null });

const method = {
  id: 'passive-existing-response',
  partial: true,
  additionalRequests: false,
  description: '合成方法說明：僅辨識既有公開回應中的部分線索。',
} as const;
const stats = (patch: Partial<TechStats> = {}): TechStats => ({
  generatedAt: '2026-10-12T04:00:00.000Z',
  method,
  // Partial scan: 2,000 of 2,400 public blogs read; counts sum to the scanned 2,000.
  coverage: { totalBlogs: 2400, scannedBlogs: 2000, truncated: true, detected: 30, unknown: 20, failed: 10, blocked: 5, notObserved: 1935 },
  technologies: [
    {
      id: 'wordpress',
      name: 'WordPress',
      category: 'cms',
      blogs: 31,
      versions: [
        { version: '6.4', blogs: 1 },
        { version: 'unknown', blogs: 30 },
      ],
    },
    { id: 'wp-plugin:elementor', name: 'Elementor', category: 'plugin', blogs: 5, versions: [{ version: 'unknown', blogs: 5 }] },
    { id: 'cloudflare', name: 'Cloudflare', category: 'cdn', blogs: 12, versions: [{ version: 'unknown', blogs: 12 }] },
  ],
  items: [detectedBlog, unknownBlog, failedBlog, blockedBlog, unregisteredBlog],
  pagination: { limit: 50, nextCursor: '5', total: 2000 },
  filters: { q: '', technology: '', status: '' },
  ...patch,
});
const EMPTY_STATS = stats({
  coverage: { totalBlogs: 0, scannedBlogs: 0, truncated: false, detected: 0, unknown: 0, failed: 0, blocked: 0, notObserved: 0 },
  technologies: [],
  items: [],
  pagination: { limit: 50, nextCursor: null, total: 0 },
});
const ready = <T,>(data: T): PublicLoad<T> => ({ status: 'ready', data });
const baselineFilters = { q: '', technology: '', status: '' };

/* /tech/ ------------------------------------------------------------------- */

describe('/tech/ baseline', () => {
  test('denominators, four state chips (未辨識 includes not-observed), partial scan and the ranking table above the blog table', () => {
    const $ = render(<TechStatsView data={stats()} filters={baselineFilters} status="ready" />);
    expect($('h1').text()).toBe('部落格使用的技術');
    expect(card($, '公開部落格').text()).toContain('2,400');
    expect(card($, '本次讀取').text()).toContain('2,000');
    expect(card($, '本次讀取').text()).toContain('部分截斷');
    for (const [label, count, status, pct] of [
      ['有辨識', '30', 'detected', '1.5%'],
      ['未辨識', '1,955', 'unknown', '97.8%'],
      ['觀測失敗', '10', 'failed', '0.5%'],
      ['來源阻擋', '5', 'blocked', '0.3%'],
    ]) {
      const state = statusChip($, label);
      expect(state.length, label).toBe(1);
      expect(state.attr('href')).toBe(`/tech/?status=${status}`);
      expect(state.text()).toBe(`${label} ${count}（${pct}）`);
      expect(state.attr('title')).toBe(`佔已讀取 ${pct}`);
    }
    expect($('body').text()).not.toContain('未觀測');
    // The partial scan is said in the method block, not above the ranking.
    expect(outsideText($)).not.toContain('其餘 400 個');
    expect(methodBlocks($).text()).toContain('其餘 400 個不計入任何狀態、排行或篩選');

    // One ranking table: site software first, then hosting / CDN marked low confidence.
    const ranking = $('section[aria-labelledby="tech-ranking"]');
    expect(
      ranking
        .find('thead th')
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(['技術', '類別', '部落格', '佔比', '明確版本']);
    const wordpress = rankRow($, 'WordPress');
    expect(wordpress.find('a').attr('href')).toBe('/tech/?technology=wordpress');
    expect(wordpress.find('td').eq(1).text()).toBe('CMS／平台');
    expect(wordpress.find('td').eq(4).text()).toContain('6.4（1）');
    expect(ranking.text()).not.toContain('unknown');
    expect(rankRow($, 'Elementor').find('a').attr('href')).toBe('/tech/?technology=wp-plugin%3Aelementor');
    const cloudflare = rankRow($, 'Cloudflare');
    expect(cloudflare.find('a').attr('href')).toBe('/tech/?technology=cloudflare');
    expect(cloudflare.find('td').eq(1).text()).toContain('（低信心）');
    const names = ranking
      .find('tbody tr td:first-child')
      .map((_, el) => $(el).text())
      .get();
    expect(names.indexOf('Cloudflare')).toBe(names.length - 1);
    expectNoPrefetch($);
  });

  test('the table: shared scroller, sticky one-line lead, truncated titled cells, each state per row', () => {
    const $ = render(<TechStatsView data={stats()} filters={baselineFilters} status="ready" />);
    const scroller = $('section[aria-label="部落格技術觀測表格，可左右捲動"]');
    expect(scroller.hasClass('table-scroller')).toBe(true);
    const tableEl = scroller.find('table');
    expect(tableEl.hasClass('whitespace-nowrap')).toBe(true);
    const lead = tableEl.find('thead th').first();
    for (const name of ['table-lead', 'sticky', 'left-0']) expect(lead.hasClass(name), name).toBe(true);
    expect(
      tableEl
        .find('thead th')
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(['部落格', '狀態', '技術數', '辨識到的技術', '觀測範圍', '成功觀測']);
    expect(tableEl.find('tbody tr').length).toBe(5);
    tableEl.find('tbody tr').each((_, row) => {
      const first = $(row).find('td').first();
      expect(first.hasClass('table-lead')).toBe(true);
      expect(first.find('.table-lead-box').length).toBe(1);
      const name = first.find('span.truncate[title]').first();
      expect(name.attr('title')).toBe(name.text());
      // The host is a lead extra: hidden while scrolled on phones (globals.css), one line, titled.
      expect(first.find('.table-lead-extra.truncate').attr('title')).toMatch(/^https:\/\/s\d\.example\/$/);
      // Status, technologies and scope never wrap: one truncating line with the whole text as title.
      const [, state, , techs, scope] = $(row).find('td').toArray();
      expect($(state).find('span.truncate').attr('title')).toBe($(state).text());
      expect($(scope).find('span.truncate').attr('title')).toBe($(scope).text());
      if ($(techs).text() !== '—') expect($(techs).children('span.truncate').attr('title')).toBeTruthy();
    });

    // Detected: canonical link from the payload url (not the slug); software then low-confidence CDN; version with evidence only.
    const detected = rowOf($, '測試站甲');
    expect(detected.find('td').first().find('a').attr('href')).toBe('/blogs/s1.example/');
    expect(detected.find('td').eq(1).text()).toBe('有辨識');
    expect(detected.find('td').eq(2).text()).toBe('3');
    const techs = detected.find('td').eq(3);
    expect(techs.children('span').attr('title')).toBe('WordPress 6.4、Elementor、Cloudflare（低信心）');
    expect(techs.text()).toBe('WordPress6.4、Elementor·主機／CDN（低信心）Cloudflare');
    expect(techs.find('a[href="/tech/?technology=wp-plugin%3Aelementor"]').length).toBe(1);
    expect(detected.find('td').eq(4).text()).toBe('首頁 HTML');
    // One time column: the success; the last attempt is its title (and shown only when it failed).
    expect(detected.find('td').eq(5).text()).toBe(taipei(OBSERVED));
    expect(detected.find('td').eq(5).attr('title')).toBe(`最後嘗試：${taipei(OBSERVED)}`);

    expect(rowOf($, '測試站乙').find('td').eq(1).text()).toBe('未辨識');
    expect(rowOf($, '測試站乙').find('td').eq(4).text()).toBe('文章內文片段（部分）');

    // Failed: the kept detections are history, both times shown; a version without evidence is not.
    const failed = rowOf($, '測試站丙');
    expect(failed.find('td').eq(1).text()).toBe('觀測失敗 · 連線逾時');
    expect(failed.find('td').eq(3).text()).toBe('上次成功：WordPress');
    expect(failed.find('td').eq(5).text()).toBe(`${taipei(OLD_SUCCESS)}嘗試 ${taipei(LAST_ATTEMPT)}`);

    const blocked = rowOf($, '測試站丁');
    expect(blocked.find('td').eq(1).text()).toBe('來源阻擋 · robots.txt 不允許');
    expect(blocked.find('td').eq(3).text()).toBe('—');
    expect(blocked.find('td').eq(5).text()).toMatch(/^尚無成功觀測嘗試 /);

    const unregistered = rowOf($, '測試站戊');
    expect(unregistered.find('td').first().find('a').length).toBe(0);
    expect(unregistered.find('td').eq(1).text()).toBe('未辨識');
    expect(unregistered.find('td').eq(5).attr('title')).toBe('尚未嘗試');

    const main = $('main').text();
    expect(main).not.toContain('6.5');
    expect(main).not.toContain('unknown');
    const pager = $('nav[aria-label="部落格分頁"]');
    expect(pager.find('a').text()).toBe('下一頁 →');
    expect(pager.find('a').attr('href')).toBe('/tech/?cursor=5');
    expectNoPrefetch($);
  });

  test('the method is in the one closed block after the content, not repeated above it', () => {
    const $ = render(<TechStatsView data={stats()} filters={baselineFilters} status="ready" />);
    const block = expectOneBlock($);
    const inside = block.text();
    for (const text of ['技術觀測方式', '本次統計範圍', '公開部落格共 2,400 個；本次讀取 2,000 個', '合成方法說明', '每月抓取一次首頁'])
      expect(inside, text).toContain(text);
    const outside = outsideText($);
    for (const text of ['技術觀測方式', '本次統計範圍', '合成方法說明', '每月抓取一次首頁']) expect(outside, text).not.toContain(text);
    expect($('main header a').attr('href')).toBe('#method');
    const tablePosition = ($('*').toArray() as unknown[]).indexOf($('table').get(0));
    expect(tablePosition).toBeLessThan(($('*').toArray() as unknown[]).indexOf(block.get(0)));
  });

  test('empty: zero public blogs is data with "—" shares and an empty table, never an error; no ranking is drawn', () => {
    const $ = render(<TechStatsView data={EMPTY_STATS} filters={baselineFilters} status="ready" />);
    expect(methodBlocks($).text()).toContain('目前沒有可統計的公開部落格。');
    expect(statusChip($, '有辨識').text()).toBe('有辨識 0（—）');
    expect(card($, '本次讀取').text()).toContain('已全部讀取');
    expect(blogRows($).length).toBe(0);
    expect($('main').text()).toContain('沒有符合條件的部落格。');
    expect($('span[role="status"]').text()).toBe('共 0 個部落格符合');
    expect($('[role="alert"]').length).toBe(0);
    // No technologies: the ranking table is left out, with no "nothing recognized" sentence.
    expect($('section[aria-labelledby="tech-ranking"] table').length).toBe(0);
    expect($('main').text()).not.toContain('目前沒有辨識到網站軟體');
    expect(outsideText($)).not.toContain('不代表');
    expectOneBlock($);
  });

  test('low data: few observed blogs are flagged; a full scan has no truncation note', () => {
    const $ = render(
      <TechStatsView
        data={stats({
          coverage: { totalBlogs: 50, scannedBlogs: 50, truncated: false, detected: 1, unknown: 1, failed: 1, blocked: 0, notObserved: 47 },
          technologies: [],
          pagination: { limit: 50, nextCursor: null, total: 5 },
        })}
        filters={baselineFilters}
        status="ready"
      />,
    );
    expect(methodBlocks($).text()).toContain('目前只有 3 個部落格有觀測紀錄，排行與百分比的代表性有限。');
    expect($('main').text()).not.toContain('本次統計只讀取前');
    expect(methodBlocks($).text()).toContain('（已全部讀取）');
  });
});

describe('/tech/ query views', () => {
  test('no query: the baseline renders and nothing is read in the browser', () => {
    const $ = render(<TechStatsFromUrl baseline={stats()} />);
    expect(publicJson.paths.filter(Boolean)).toEqual([]);
    expect(blogRows($).length).toBe(5);
  });

  test('a query the gateway would refuse is dropped and said, not sent', () => {
    nav.search = 'status=gone&technology=Bad';
    const $ = render(<TechStatsFromUrl baseline={stats()} />);
    expect(publicJson.paths.filter(Boolean)).toEqual([]);
    expect($('main').text()).toContain('網址中有無法辨識的篩選條件，已略過。');
  });

  test('pending: the asked filters with the baseline counts, no rows from another query', () => {
    nav.search = 'status=failed';
    const $ = render(<TechStatsFromUrl baseline={stats()} />);
    expect(publicJson.paths).toContain('/api/tech?status=failed');
    expect($('p[aria-busy="true"]').text()).toBe('正在載入符合條件的部落格…');
    expect(blogTable($).length).toBe(0);
    expect(statusChip($, '觀測失敗').attr('aria-current')).toBe('page');
    expectOneBlock($);
  });

  for (const state of [{ status: 'error' }, { status: 'missing' }] as const) {
    test(`${state.status}: an error with a retry, never an empty result or a 404`, () => {
      nav.search = 'q=x';
      publicJson.load = state;
      const $ = render(<TechStatsFromUrl baseline={stats()} />);
      const alert = $('[role="alert"]');
      expect(alert.text()).toBe('技術統計暫時無法載入，請稍後再試。重新載入');
      // "Not a zero" is said once, in the method block, not in the alert.
      expect(methodBlocks($).text()).toContain('留白或載入失敗都不表示沒有收錄、沒有符合的結果或數量為 0');
      expect(alert.find('button').text()).toBe('重新載入');
      expect(blogTable($).length).toBe(0);
      expect($('main p').filter((_, element) => $(element).text() === '沒有符合條件的部落格。').length).toBe(0);
      expectOneBlock($);
    });
  }

  test('ready with a technology: the list of its blogs, the filter chip and the next page keep the filter', () => {
    nav.search = 'technology=wordpress&cursor=3';
    publicJson.load = ready(
      stats({
        items: [failedBlog],
        pagination: { limit: 50, nextCursor: '9', total: 31 },
        filters: { q: '', technology: 'wordpress', status: '' },
      }),
    );
    const $ = render(<TechStatsFromUrl baseline={stats()} />);
    expect(publicJson.paths).toContain('/api/tech?technology=wordpress&cursor=3');
    expect($('#tech-blogs').text()).toBe('保留證據中有「WordPress」的部落格');
    expect($('main').text()).toContain('列出不代表目前仍確認使用');
    expect(blogRows($).length).toBe(1);
    expect(
      $('a')
        .filter((_, el) => $(el).text().startsWith('技術：WordPress'))
        .attr('href'),
    ).toBe('/tech/');
    const pager = $('nav[aria-label="部落格分頁"] a');
    expect(pager.map((_, el) => $(el).attr('href')).get()).toEqual(['/tech/?technology=wordpress', '/tech/?technology=wordpress&cursor=9']);
    expect($('input[type="hidden"][name="technology"]').attr('value')).toBe('wordpress');
    expectNoPrefetch($);
  });
});

describe('/tech/ server page and its switches', () => {
  test('site switch off: a 404 before any gateway read', async () => {
    flag.on = false;
    await expect(TechPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(gateway.paths).toEqual([]);
  });

  test("site on, gateway's own switch off (its 404): said plainly, no counts and no table", async () => {
    gateway.answer = () => Promise.resolve(null);
    const $ = render(await TechPage());
    expect(gateway.paths).toEqual(['/api/tech']);
    expect($('[role="alert"]').text()).toBe('技術觀測資料目前沒有開放讀取。');
    expect(blogTable($).length).toBe(0);
    // No counts outside the method block (whose general note mentions 0 as what a blank does not mean).
    expect(outsideText($)).not.toMatch(/\d/);
    expectOneBlock($);
  });

  test('a gateway failure is thrown to the error page, which keeps one method block on /tech/', async () => {
    gateway.answer = () => Promise.reject(new PublicGatewayError('/api/tech', 503));
    await expect(TechPage()).rejects.toBeInstanceOf(PublicGatewayError);
    for (const page of [<ErrorPage key="error" error={new Error('boom')} retry={() => undefined} />, <NotFound key="404" />]) {
      const $ = render(page);
      expectOneBlock($);
      expect(blogTable($).length).toBe(0);
    }
  });

  test('on: the unfiltered first page is server-rendered', async () => {
    gateway.answer = () => Promise.resolve(stats());
    const $ = render(await TechPage());
    expect(gateway.paths).toEqual(['/api/tech']);
    expect(blogRows($).length).toBe(5);
    expectOneBlock($);
  });
});

/* Profile section ------------------------------------------------------------ */

const payload = (blogPatch: TechBlog): BlogTechPayload => ({ generatedAt: '2026-10-12T04:00:00.000Z', method, blog: blogPatch });
const renderSection = async (slug = 'synthetic-1') => {
  nav.pathname = '/blogs/s1.example/';
  return load(renderToString(await BlogTech({ slug })));
};

describe('profile 使用的技術 (optional)', () => {
  test('a gateway failure stays in the section with a retry; no observation is implied', async () => {
    gateway.answer = () => Promise.reject(new PublicGatewayError('/api/blogs/synthetic-1/tech', 500));
    const $ = await renderSection();
    expect($('section#tech h2').text()).toBe('使用的技術');
    expect($('[role="alert"]').text()).toContain('技術資料暫時無法讀取');
    expect($('button').text()).toBe('重新載入');
    for (const word of ['有辨識', '未辨識', '未觀測', '觀測失敗']) expect($('body').text()).not.toContain(word);
  });

  test("anything that is not the gateway's failure is not swallowed", async () => {
    gateway.answer = () => Promise.reject(new Error('bug'));
    await expect(BlogTech({ slug: 'synthetic-1' })).rejects.toThrow('bug');
  });

  test("the gateway's 404 and a key it cannot have render nothing, not a claim of no technology", async () => {
    let $ = await renderSection();
    expect($('section').length).toBe(0);
    expect($('body').text()).toBe('');
    gateway.paths = [];
    $ = await renderSection('../x');
    expect(gateway.paths).toEqual([]);
    expect($('section').length).toBe(0);
    expect($('body').text()).toBe('');
  });

  test('detected: software then low-confidence CDN, versions only with evidence, evidence and the success time', async () => {
    gateway.answer = () => Promise.resolve(payload(detectedBlog));
    const $ = await renderSection();
    expect(gateway.paths).toEqual(['/api/blogs/synthetic-1/tech']);
    const headings = $('h3')
      .map((_, el) => $(el).text())
      .get();
    expect(headings).toEqual(['辨識到的網站軟體', '主機與 CDN（低信心）']);
    const item = (name: string) => $('li').filter((_, el) => $(el).find('a').first().text() === name);
    const terms = (name: string) =>
      item(name)
        .find('dt')
        .map((_, el) => $(el).text())
        .get();
    expect(item('WordPress').find('dd').first().text()).toBe('6.4');
    // No version evidence: the 版本 row is left out, never 未知 or the gateway's 'unknown'.
    expect(terms('Elementor')).not.toContain('版本');
    expect(terms('Cloudflare')).not.toContain('版本');
    expect(item('Elementor').text()).not.toContain('未知');
    // The infrastructure caveat lives in the footer's 部落格頁 block, not on the row.
    expect(item('Cloudflare').text()).toContain('低');
    expect(item('Cloudflare').text()).not.toContain('不是 CMS');
    expect(item('Cloudflare').find('code').text()).toBe('cf-ray');
    expect(item('Elementor').find('a').attr('href')).toBe('/tech/?technology=wp-plugin%3Aelementor');
    expect($('body').text()).toContain(`成功觀測${taipei(OBSERVED)}`);
    // A detected blog says no 最近一次 failure row and no 最後嘗試 row.
    expect($('body').text()).not.toContain('最近一次');
    expect($('body').text()).not.toContain('最後嘗試');
    // Method text is not in the section: no partial-evidence sentence, no method link.
    expect($('body').text()).not.toContain('不是完整的技術清單');
    expect($('a[href="/tech/#method"]').length).toBe(0);
    expect($('details').length).toBe(0);
    expect($('body').text()).not.toContain('unknown');
    expectNoPrefetch($);
  });

  test("the profile footer's 部落格頁 block carries the technology caveats the section no longer prints", () => {
    nav.pathname = '/blogs/s1.example/';
    const $ = load(renderToString(<FooterMethod />));
    expect(methodBlocks($).length).toBe(1);
    const text = $('#method').text();
    for (const caveat of [
      '是部分證據，不是完整的技術清單',
      '版本只在有明確證據時顯示',
      '不代表用哪種 CMS 寫成',
      '列出的是上次成功觀測的結果',
      '沒有辨識到技術不代表沒有使用',
    ])
      expect(text, caveat).toContain(caveat);
  });

  test('failed with a kept success: marked as history with its date and the failure; an unproven version is left out', async () => {
    gateway.answer = () => Promise.resolve(payload(failedBlog));
    const $ = await renderSection();
    expect($('h2').text()).toBe('使用的技術');
    expect($('body').text()).toContain('最近一次觀測失敗 · 連線逾時');
    expect($('body').text()).toContain(`成功觀測${taipei(OLD_SUCCESS)}`);
    expect($('h3').first().text()).toBe('上次成功辨識到的網站軟體');
    const row = $('li').filter((_, el) => $(el).find('a').first().text() === 'WordPress');
    expect(row.find('dt').first().text()).not.toBe('版本');
    expect($('body').text()).not.toContain('6.5');
    expect($('body').text()).not.toContain('未知');
    expect(row.text()).toContain(`觀測於${taipei(OLD_SUCCESS)}`);
  });

  test('evidence keys are kind and value, not position: the same under any order, identical pairs listed once', async () => {
    const generator = { kind: 'generator', value: 'WordPress 6.4' } as const;
    const marker = { kind: 'marker', value: 'WordPress 6.4' } as const;
    const asset = { kind: 'asset', value: '/wp-content/x.js' } as const;
    const keys = [generator, marker, asset].map(techEvidenceKey);
    expect(new Set(keys).size).toBe(3);
    expect(distinctTechEvidence([asset, generator, marker]).map(([key]) => key)).toEqual([keys[2], keys[0], keys[1]]);

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const evidence of [
        [generator, { ...generator }, marker, asset],
        [asset, marker, { ...generator }, generator],
      ]) {
        const repeated = detection({ id: 'wordpress', name: 'WordPress', category: 'cms', version: '6.4', evidence });
        gateway.answer = () => Promise.resolve(payload({ ...detectedBlog, detections: [repeated] }));
        const $ = await renderSection();
        const items = $('li')
          .filter((_, el) => $(el).find('a').first().text() === 'WordPress')
          .find('dd li');
        expect(items.length).toBe(3);
        expect(
          items
            .map((_, el) => $(el).text())
            .get()
            .sort(),
        ).toEqual(['generator 標記：WordPress 6.4', '頁面標記：WordPress 6.4', '資源路徑：/wp-content/x.js'].sort());
      }
      expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    } finally {
      error.mockRestore();
    }
  });

  for (const [name, row] of [
    ['unknown', unknownBlog],
    ['blocked without a success', blockedBlog],
    ['not-observed', unregisteredBlog],
  ] as const) {
    test(`${name}: no detections, so BlogTech renders null (no status sentence, no "none")`, async () => {
      gateway.answer = () => Promise.resolve(payload(row));
      const $ = await renderSection();
      expect($('section').length).toBe(0);
      expect($('body').text()).toBe('');
      expect($('[role="alert"]').length).toBe(0);
    });
  }
});

/* Navigation ----------------------------------------------------------------- */

describe('navigation switch', () => {
  for (const [name, props, shown] of [
    ['default (no flag passed)', {}, false],
    ['flag false', { techEnabled: false }, false],
    ['flag true', { techEnabled: true }, true],
  ] as const) {
    test(`${name}: 技術 link ${shown ? 'shown' : 'absent'}`, () => {
      nav.pathname = '/blogs/';
      const $ = load(renderToString(<SiteNavigation {...props} />));
      const link = $('a[href="/tech/"]');
      expect(link.length).toBe(shown ? 1 : 0);
      if (shown) {
        expect(link.text()).toBe('技術');
        expect(link.attr('data-prefetch')).toBe('false');
      }
      expect($('a[href="/traffic/"]').length).toBe(1);
    });
  }
});
