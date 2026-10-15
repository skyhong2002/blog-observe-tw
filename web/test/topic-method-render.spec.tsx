/**
 * The topic pages' 資料來源與計算方式, rendered for real (react-dom/server) and read
 * back with cheerio: one closed block per page, after the page's content, holding
 * the long vocabulary record; the framework error and 404 pages keep exactly one.
 * Next's hooks, links and images and usePublicJson are mocked; nothing is fetched.
 * Server markup only: phone geometry, tapping the summary and keyboard focus are
 * not exercised here.
 */
import { type CheerioAPI, load } from 'cheerio';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import ErrorPage from '@/app/error';
import NotFound from '@/app/not-found';
import FooterMethod from '@/components/FooterMethod';
import TopicDetailView, { TopicDetailFromUrl } from '@/components/public/TopicDetail';
import TopicRankingView, { TopicRankingFromUrl } from '@/components/public/TopicRanking';
import { taipei } from '@/lib/api';
import { topicApiPath, topicsApiPath } from '@/lib/public-query';
import type { HistoryArticle, MatchingPolicy, TopicDetail, Topics, VocabularyStatus } from '@/lib/topics';
import type { PublicLoad } from '@/lib/use-public-json';
import { EMPTY } from './public-payloads.ts';

const nav = vi.hoisted(() => ({ pathname: '/', search: '' }));
const publicJson = vi.hoisted(() => ({ load: null as unknown, paths: [] as Array<string | null> }));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return { default: ({ prefetch: _prefetch, ...props }: Record<string, unknown>) => createElement('a', props) };
});
vi.mock('next/image', async () => {
  const { createElement } = await import('react');
  return { default: ({ unoptimized: _unoptimized, ...props }: Record<string, unknown>) => createElement('img', props) };
});
// Every read the views ask for is recorded; a non-null path answers with publicJson.load.
vi.mock('@/lib/use-public-json', () => ({
  usePublicJson: (path: string | null) => {
    publicJson.paths.push(path);
    return path ? publicJson.load : null;
  },
  asIs: (raw: unknown) => raw,
}));

beforeEach(() => {
  publicJson.load = { status: 'pending' };
  publicJson.paths = [];
});

// app/layout.tsx: the page, then SiteFooter, whose only method piece is <FooterMethod notes={notes} />
// (the rest of SiteFooter reads the catalog on the server and is not rendered here).
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

function render(page: ReactNode, pathname: string, search = '') {
  nav.pathname = pathname;
  nav.search = search;
  return load(renderToString(<Layout>{page}</Layout>));
}

const SUMMARY = '本頁的資料來源與計算方式';
const methodBlocks = ($: CheerioAPI) => $('details').filter((_, el) => $(el).children('summary').text().includes(SUMMARY));
const methodText = ($: CheerioAPI) => methodBlocks($).text();
/** Page text with every <details> taken out: what a reader sees before opening anything. */
function outsideText($: CheerioAPI) {
  const copy = load($.html());
  copy('details').remove();
  return copy('body').text();
}
/** Document-order position of the first node in `selection`. */
function position($: CheerioAPI, selection: { get(index: number): unknown; length: number }) {
  expect(selection.length).toBeGreaterThan(0);
  return ($('*').toArray() as unknown[]).indexOf(selection.get(0));
}
const sectionTitled = ($: CheerioAPI, title: string) =>
  $('h2')
    .filter((_, el) => $(el).text() === title)
    .closest('section');

/** The one block: closed, inside the page (not the layout footer), with the link to the full write-up. */
function expectOnePageBlock($: CheerioAPI) {
  const blocks = methodBlocks($);
  expect(blocks.length).toBe(1);
  expect($('details').length).toBe(1);
  expect($('#method').length).toBe(1);
  expect(blocks.attr('open')).toBeUndefined();
  expect(blocks.closest('main').length).toBe(1);
  expect($('footer details').length).toBe(0);
  expect(blocks.find('a[href="/about/"]').text()).toContain('完整的資料來源與計算方式');
  return blocks;
}

const HASH = 'a'.repeat(64);
const ID = `tag:${HASH}`;
const PATH = '/topics/%E6%97%85%E8%A1%8C/';

const vocabulary: VocabularyStatus = {
  status: 'ready',
  source: 'tag-vocabulary',
  version: 'tags-2026-10-12-0f3c9a7d2e',
  coverage: 'observed-article-window',
  syncedAt: '2026-10-12T04:00:00.000Z',
  window: { since: '2026-09-12T00:00:00.000Z', until: '2026-10-12T00:00:00.000Z' },
  invalidTagCount: 7,
  normalizedTagCount: 12,
  tagNormalization: 'boundary-whitespace-v1',
  excludedTermCount: 40,
  exclusionReasons: { 'pure-number': 30, 'too-short': 10 },
  totalSourceTerms: 50000,
  activeSet: {
    status: 'ready',
    version: 'active-1',
    asOf: '2026-10-12T03:00:00.000Z',
    eligibleTerms: 20000,
    activeTerms: 15000,
    termLimit: 15000,
    codePointLimit: 64,
    memoryBudgetBytes: 64 * 1024 ** 2,
    estimatedBytes: 48 * 1024 ** 2,
    inactiveReasons: { 'low-frequency': 30000, 'memory-budget': 5000 },
  },
  // Not fully re-matched yet: the summary warns above the fold, the record stays in the block.
  frequencyBaseline: {
    since: '2025-10-12T00:00:00.000Z',
    until: '2026-10-12T00:00:00.000Z',
    totalPosts: 90000,
    coveredPosts: 60000,
    thresholdRatio: 0.02,
    version: 'baseline-1',
  },
};
const matchingPolicy: MatchingPolicy = {
  version: 'm1',
  policyVersion: 'p1',
  titleWeight: 2,
  bodyWeight: 1,
  sameBlogDecay: 0.5,
  sources: ['title', 'body'],
  frequency: { baselineDays: 365, highFrequencyRatio: 0.02, reason: 'high-document-frequency-title-only', version: 'f1' },
};

/** The long record (upstream window, tag quality, capacity, baseline, weighting): only ever inside the block. */
const LONG_NOTES = [
  `上游窗口：${taipei(vocabulary.window?.since)} 至 ${taipei(vocabulary.window?.until)}`,
  `來源版本：${vocabulary.version}`,
  '標籤品質處理',
  '已略過的壞標籤',
  '來源詞庫完整保留；只用活躍比對集建立索引',
  '詞數上限',
  '記憶體估算／預算',
  '48 MiB／64 MiB',
  '高頻詞只計標題命中',
  '已完成比對／基準文章',
  '詞庫更新與補比對',
  '話題計算方式',
  '只比對文章標題與清理後的正文',
  '共同關鍵字詞庫',
];
function expectLongNotesInsideOnly($: CheerioAPI, extra: string[] = []) {
  const inside = methodText($);
  const outside = outsideText($);
  for (const note of [...LONG_NOTES, ...extra]) {
    expect(inside, note).toContain(note);
    expect(outside, note).not.toContain(note);
  }
}

const blogs: TopicDetail['blogs'] = [{ id: 1, slug: 'a', name: '甲', posts: 2, score: 3, titlePosts: 1, bodyOnlyPosts: 1 }];
const topic = { id: ID, label: '旅行', source: 'tag-vocabulary', canonicalId: ID, canonicalPath: PATH };
const detail = (more: Partial<TopicDetail> = {}): TopicDetail => ({
  days: 30,
  vocabulary,
  matchingPolicy,
  topic,
  blogs,
  articles: [
    {
      id: 11,
      title: '花蓮三天兩夜',
      url: 'https://a.example/hualien',
      publishedAt: '2026-10-10T02:00:00.000Z',
      blogSlug: 'a',
      blogName: '甲',
    },
  ],
  truncated: false,
  ...more,
});
const ready = <T,>(data: T): PublicLoad<T> => ({ status: 'ready', data });
const historyArticle = (id: number, evidenceState: HistoryArticle['evidenceState']): HistoryArticle => ({
  id,
  title: `舊文章 ${id}`,
  url: `https://a.example/old-${id}`,
  publishedAt: '2025-03-01T00:00:00.000Z',
  blogSlug: 'a',
  blogName: '甲',
  evidenceState,
  observedAt: `2026-0${id}-15T00:00:00.000Z`,
});

describe('topic detail article titles', () => {
  test('an entity-encoded title is decoded once for display, stays escaped text, and the payload is untouched', () => {
    const encoded = 'She Rarely Reaches Out But Our Chemistry &#038; Sex Are Great <script>x</script> &amp;#038;';
    const data = detail({ articles: [{ ...detail().articles[0], id: 12, title: encoded, url: 'https://a.example/chemistry' }] });
    const before = structuredClone(data);
    const $ = render(<TopicDetailView id={ID} path={PATH} days="30" load={ready(data)} />, PATH);
    const link = $('a[href="https://a.example/chemistry"]');
    expect(link.text()).toBe('She Rarely Reaches Out But Our Chemistry & Sex Are Great <script>x</script> &#038;');
    expect(link.find('script').length).toBe(0);
    expect($.html()).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(data).toEqual(before);
    expect(data.articles[0].title).toBe(encoded);
  });
});

describe('topic detail', () => {
  test('articles, then which blogs, then one closed block holding the long record', () => {
    const $ = render(
      <TopicDetailView
        id={ID}
        path={PATH}
        days="30"
        load={ready(detail({ topic: { ...topic, matchingReason: 'high-document-frequency-title-only' } }))}
      />,
      PATH,
    );
    const block = expectOnePageBlock($);
    const articles = sectionTitled($, '相關文章');
    const which = sectionTitled($, '哪些部落格在寫');
    expect(articles.find('a[data-analytics="open_original"]').attr('href')).toBe('https://a.example/hualien');
    expect(position($, articles)).toBeLessThan(position($, which));
    expect(position($, which)).toBeLessThan(position($, block));
    expect(articles.closest('details').length).toBe(0);
    expect(which.closest('details').length).toBe(0);
    // Phones get a jump past the article list to the blogs, above both; the wide layout hides it.
    const jump = $('a[href="#topic-blogs"]');
    expect(jump.length).toBe(1);
    expect(jump.closest('p').hasClass('lg:hidden')).toBe(true);
    expect(which.attr('id')).toBe('topic-blogs');
    expect(position($, jump)).toBeLessThan(position($, articles));

    // Above the fold: the short rule, the source sentence and the partial-snapshot warning only.
    const outside = outsideText($);
    expect(outside).toContain('高頻詞，只計標題命中：排行與升溫倍率只計標題命中。');
    expect(outside).toContain('計算方式與詞庫細節見下方「本頁的資料來源與計算方式」');
    expect($('p[role="note"]').text()).toContain('共同關鍵字僅涵蓋上游文章觀測窗口');
    expectLongNotesInsideOnly($, ['這個詞在長期文章中出現得很普遍', '門檻：基準期間命中文章占比超過 2%']);
    expect(block.find('ul[aria-label="暫未參與比對的原因"] li').length).toBe(2);
    expect(block.find('ul[aria-label="不參與比對的原因"] li').length).toBe(2);
    // The generic 資料來源 stays first; the topic notes follow it.
    expect(block.find('h3').first().text()).toBe('資料來源');
  });

  test('history with confirmed and pending matches keeps every label, ahead of blogs and the block', () => {
    const history = {
      articles: [historyArticle(1, 'confirmed'), historyArticle(2, 'pending')],
      nextCursor: 'next_1',
      confirmed: 1,
      pending: 1,
      total: 2,
      lastObservedAt: '2026-02-15T00:00:00.000Z',
    };
    const $ = render(<TopicDetailView id={ID} path={PATH} days="7" load={ready(detail({ articles: [], history }))} />, PATH);
    const block = expectOnePageBlock($);
    const past = sectionTitled($, '過去觀測到的文章');
    const which = sectionTitled($, '哪些部落格在寫');
    expect(sectionTitled($, '相關文章').length).toBe(0);
    expect(position($, past)).toBeLessThan(position($, which));
    expect(position($, which)).toBeLessThan(position($, block));
    expect(past.closest('details').length).toBe(0);

    expect(past.find('p[role="note"]').text()).toContain('近 7 天沒有新的相關文章');
    expect(past.text()).toContain(`共 2 篇（已確認 1 · 待重新確認 1） · 最近觀測：${taipei(history.lastObservedAt)}`);
    const rows = past.find('li');
    expect(rows.length).toBe(2);
    expect(rows.eq(0).find('a[data-analytics="open_original"]').attr('href')).toBe('https://a.example/old-1');
    expect(rows.eq(0).text()).toContain(`曾確認提及（觀測於 ${taipei(history.articles[0].observedAt)}）`);
    expect(rows.eq(1).text()).toContain('舊文章 2');
    const pendingLabel = rows.eq(1).find('p').last();
    expect(pendingLabel.text()).toBe(`過去曾觀測到提及，待重新確認（觀測於 ${taipei(history.articles[1].observedAt)}）`);
    expect(pendingLabel.hasClass('font-medium')).toBe(true);
    // The next page is offered, not read: no history read until it is asked for.
    expect(past.find('button').text()).toBe('載入更多歷史文章');
    expect(publicJson.paths.filter(Boolean)).toEqual([]);
    expectLongNotesInsideOnly($);
  });

  test('an empty period without history still renders one block after the empty state', () => {
    const $ = render(<TopicDetailView id={ID} path={PATH} days="30" load={ready(detail({ articles: [], blogs: [] }))} />, PATH);
    const block = expectOnePageBlock($);
    const empty = $('p').filter((_, el) => $(el).text() === '此期間尚無已比對文章。');
    expect(position($, empty)).toBeLessThan(position($, block));
    expectLongNotesInsideOnly($);
  });

  test('the shared empty payload (vocabulary not synced) renders one block with its notes', () => {
    const $ = render(
      <TopicDetailView id="rss:1" path="/topics/rss:1/" days="30" load={ready(EMPTY.topic as TopicDetail)} />,
      '/topics/rss:1/',
    );
    const block = expectOnePageBlock($);
    expect(block.text()).toContain('話題計算方式');
    expect(block.text()).toContain('共同關鍵字尚未完成同步');
    expect($('h1').text()).toBe('旅行');
  });

  test('an inactive term keeps its reason above and the record in the one block', () => {
    const inactive = { ...topic, inactiveReason: 'low-frequency', articleCount: 2, lastPublishedAt: '2024-01-01T00:00:00.000Z' };
    const $ = render(
      <TopicDetailView id={ID} path={PATH} days="30" load={ready(detail({ topic: inactive, articles: [], blogs: [] }))} />,
      PATH,
    );
    const block = expectOnePageBlock($);
    const status = $('section[role="status"]');
    expect(status.text()).toContain('此詞暫未參與比對');
    expect(position($, status)).toBeLessThan(position($, block));
    expectLongNotesInsideOnly($);
  });

  for (const [name, state, expected] of [
    ['pending', { status: 'pending' }, '正在載入近 7 天的話題資料…'],
    ['error', { status: 'error' }, '目前無法讀取此話題'],
    ['missing', { status: 'missing' }, '目前無法讀取此話題'],
    ['gone', { status: 'gone' }, '此話題的文章比對證據已全部撤銷'],
  ] as const) {
    test(`${name}: one block with only the generic source notes`, () => {
      const $ = render(<TopicDetailView id={ID} path={PATH} days="7" load={state} label="旅行" />, PATH);
      const block = expectOnePageBlock($);
      const message = $('main p[role]').filter((_, el) => $(el).text().includes(expected));
      expect(position($, message)).toBeLessThan(position($, block));
      expect(block.find('h3').text()).toBe('資料來源');
      expect(block.text()).not.toContain('話題計算方式');
      if (name === 'pending') expect($('h1').text()).toBe('旅行');
    });
  }

  test('?days=7 reads the stable id and shows its pending state; the default period renders the baseline', () => {
    let $ = render(<TopicDetailFromUrl id={ID} path={PATH} baseline={ready(detail())} />, PATH, 'days=7');
    expect(publicJson.paths).toContain(topicApiPath(ID, '7'));
    expect($('h1').text()).toBe('旅行');
    expect($('p[aria-busy="true"]').text()).toBe('正在載入近 7 天的話題資料…');
    expectOnePageBlock($);

    publicJson.paths = [];
    $ = render(<TopicDetailFromUrl id={ID} path={PATH} baseline={ready(detail())} />, PATH);
    expect(publicJson.paths.filter(Boolean)).toEqual([]);
    expect(sectionTitled($, '相關文章').length).toBe(1);
    expectOnePageBlock($);
    expectLongNotesInsideOnly($);
  });
});

describe('topic ranking', () => {
  const ranking: Topics = {
    days: 30,
    vocabulary,
    matchingPolicy,
    coverage: { datedPosts: 1200, unknownDatePosts: 4, bodyObservedPosts: 900, matchedPosts: 600, cappedPosts: 3 },
    items: [
      {
        id: ID,
        label: '旅行',
        canonicalPath: PATH,
        source: 'tag-vocabulary',
        score: 5.5,
        posts: 4,
        blogs: 3,
        titlePosts: 3,
        bodyOnlyPosts: 1,
        lift: 1.5,
        matchingReason: 'high-document-frequency-title-only',
      },
    ],
    minimumBlogs: 2,
    limit: 100,
    truncated: false,
  };

  test('the table, then one closed block with the period counts and the long record', () => {
    const $ = render(<TopicRankingView days="30" load={ready(ranking)} />, '/topics/');
    const block = expectOnePageBlock($);
    const table = $('table');
    expect(table.find('tbody tr').length).toBe(1);
    expect(table.find('tbody a').attr('href')).toBe(PATH);
    expect(position($, table)).toBeLessThan(position($, block));
    expect(table.closest('details').length).toBe(0);
    const capped = $('p[role="note"]').filter((_, el) => $(el).text().includes('比對達上限'));
    expect(capped.text()).toBe('期間內有 3 篇比對達上限，保留未完整標記。');
    expect(position($, capped)).toBeLessThan(position($, block));
    expectLongNotesInsideOnly($, [
      '同站對同一詞的貢獻逐篇遞減',
      '期間內 1200 篇；可辨識正文 900 篇',
      '比對達上限 3 篇保留未完整標記',
      '日期未知 4 篇不列入期間排行',
    ]);
  });

  test('an empty ranking keeps its empty state ahead of one block', () => {
    const $ = render(<TopicRankingView days="30" load={ready({ ...ranking, items: [], coverage: undefined })} />, '/topics/');
    const block = expectOnePageBlock($);
    const empty = $('p').filter((_, el) => $(el).text().includes('這段期間尚無跨至少 2 個部落格的共同話題'));
    expect(position($, empty)).toBeLessThan(position($, block));
    expectLongNotesInsideOnly($);
  });

  for (const [name, state, expected] of [
    ['pending', { status: 'pending' }, '正在載入近 7 天的話題…'],
    ['error', { status: 'error' }, '話題資料暫時無法讀取，請稍後再試。'],
  ] as const) {
    test(`${name}: one block with only the generic source notes`, () => {
      const $ = render(<TopicRankingView days="7" load={state} />, '/topics/');
      const block = expectOnePageBlock($);
      const message = $('main p[role="status"]');
      expect(message.text()).toBe(expected);
      expect(position($, message)).toBeLessThan(position($, block));
      expect(block.text()).not.toContain('話題計算方式');
    });
  }

  test('?days=7 reads /api/topics and shows its pending state; the default period renders the baseline', () => {
    let $ = render(<TopicRankingFromUrl baseline={ranking} />, '/topics/', 'days=7');
    expect(publicJson.paths).toContain(topicsApiPath('7'));
    expect($('p[aria-busy="true"]').text()).toBe('正在載入近 7 天的話題…');
    expectOnePageBlock($);

    publicJson.paths = [];
    $ = render(<TopicRankingFromUrl baseline={ranking} />, '/topics/');
    expect(publicJson.paths.filter(Boolean)).toEqual([]);
    expect($('table tbody tr').length).toBe(1);
    expectOnePageBlock($);
  });
});

describe('framework error and 404 pages', () => {
  const pages = [
    ['error', <ErrorPage key="error" error={new Error('boom')} reset={() => undefined} />, '資料暫時無法載入'],
    ['404', <NotFound key="404" />, '找不到這個頁面'],
  ] as const;

  for (const [name, page, heading] of pages) {
    for (const pathname of ['/topics/', PATH]) {
      test(`${name} on ${pathname}: the fallback renders the one block (the layout footer leaves it out)`, () => {
        const $ = render(page, pathname);
        const block = expectOnePageBlock($);
        expect(
          position(
            $,
            $('h1').filter((_, el) => $(el).text() === heading),
          ),
        ).toBeLessThan(position($, block));
        expect(block.find('h3').text()).toBe('資料來源');
      });
    }

    for (const pathname of ['/', '/blogs/a/']) {
      test(`${name} on ${pathname}: only the layout footer's block`, () => {
        const $ = render(page, pathname);
        const blocks = methodBlocks($);
        expect(blocks.length).toBe(1);
        expect($('details').length).toBe(1);
        expect($('#method').length).toBe(1);
        expect(blocks.attr('open')).toBeUndefined();
        expect(blocks.closest('footer').length).toBe(1);
        expect($('main details').length).toBe(0);
      });
    }

    test(`${name} on the method page itself: no block`, () => {
      const $ = render(page, '/about/');
      expect($('details').length).toBe(0);
    });
  }
});
