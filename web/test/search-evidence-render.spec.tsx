/**
 * /articles/ search results and their coverage, rendered for real
 * (react-dom/server) and read back with cheerio. Each gateway answer goes
 * through the real normalizeSearch, the same parser the page uses; Next's
 * hooks, links and images are mocked and nothing is fetched. Every payload is
 * synthetic (article 20875 is a made-up id, not a formal real-text check).
 * Server markup only: opening <details>, layout on phones and the browser's
 * query reading are not exercised.
 */
import { type CheerioAPI, load } from 'cheerio';
import { renderToString } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import ArticlesView from '@/components/public/Articles';
import { normalizeSearch, type SearchParams } from '@/lib/search';

vi.mock('next/navigation', () => ({
  usePathname: () => '/articles/',
  useSearchParams: () => new URLSearchParams(),
}));
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
vi.mock('@/lib/use-public-json', () => ({ usePublicJson: () => null, asIs: (raw: unknown) => raw }));

const asked: SearchParams = { q: '蛤蜊絲瓜', page: 1, blog: null };
const SNIPPET = '今晚煮了蛤蜊絲瓜，湯頭很清甜。';
const bodyHit = {
  id: 20875,
  title: '夏天的蛤蜊絲瓜',
  url: 'https://a.example/p/20875',
  summary: '一道簡單的家常菜。',
  publishedAt: '2019-07-01T04:00:00.000Z',
  blogSlug: 'a',
  blogName: '甲的廚房',
  articleId: 20875,
  snippet: SNIPPET,
  matchSource: 'body',
  contextSource: 'body',
  matchVersion: 'nfkc-lower-trigram-prefix-v1',
  snippetNormalization: 'NFKC-then-lowercase',
  // Private keys a gateway must not send; if one did, none of it is rendered.
  bodyBytes: 'PRIVATE_RAW_BODY_TAIL',
  bodyTextHash: 'f'.repeat(64),
  sourceUrl: 'https://a.example/private-source',
};
const metadataHit = {
  id: 30001,
  title: '蛤蜊絲瓜食譜',
  url: 'https://b.example/p/30001',
  blogSlug: 'b',
  blogName: '乙',
  articleId: 30001,
  snippet: '蛤蜊絲瓜食譜',
  matchSource: 'metadata',
  contextSource: 'title',
  matchVersion: 'literal-metadata-ingestion-v2',
};
const partial = {
  status: 'partial',
  indexVersion: 'nfkc-lower-trigram-prefix-v1',
  normalization: 'NFKC-then-lowercase',
  scope: 'indexed-prefix-only',
  prefixCodepoints: 4096,
  rawBodyByteLimit: 65536,
  candidateLimit: 200,
  candidates: 200,
  candidateTruncated: true,
  staleOrIneligible: 3,
  invalidUtf8: 1,
  overcap: 2,
  prefixTruncatedCandidates: 5,
  unindexed: 'unknown',
  exhaustive: false,
};
const answer = (historicalBody: unknown, items: unknown[] = [metadataHit, bodyHit], coverage: object = {}) => ({
  items,
  pagination: { page: 1, pageSize: 20, hasMore: false },
  coverage: {
    type: 'bounded-ingestion-metadata-and-partial-indexed-body',
    limit: 1000,
    scannedPosts: 1000,
    truncated: true,
    metadata: { scope: 'latest-ingested-ids', fields: ['title', 'summary', 'blog-name', 'public-tags'], exhaustive: false },
    ...(historicalBody === undefined ? {} : { historicalBody }),
    statementTimeoutMs: 250,
    maximumStatements: 4,
    ...coverage,
  },
  query: asked.q,
  generatedAt: '2026-10-13T00:00:00.000Z',
});

function render(raw: unknown) {
  const data = normalizeSearch(raw, asked);
  if (!data) throw new Error('fixture rejected');
  return load(renderToString(<ArticlesView asked={asked} latest={[]} search={{ status: 'ready', data }} />));
}
const coverageText = ($: CheerioAPI) => $('[data-search-coverage]').text();
/** Text a reader sees before opening anything. */
function outsideText($: CheerioAPI) {
  const copy = load($.html());
  copy('details').remove();
  return copy('body').text();
}
const row = ($: CheerioAPI, id: number) => $(`li#article-${id}`);

describe('shared article list title', () => {
  test('an entity-encoded title is decoded once for display; the thumbnail label matches; markup stays text', () => {
    const encoded = {
      ...metadataHit,
      id: 40001,
      articleId: 40001,
      title: 'She Rarely Reaches Out But Our Chemistry &#038; Sex Are Great <b>',
      imageUrl: 'https://b.example/i.jpg',
    };
    const $ = render(answer(partial, [encoded]));
    const item = row($, 40001);
    expect(item.find('h3').text()).toBe('She Rarely Reaches Out But Our Chemistry & Sex Are Great <b>');
    expect(item.find('h3 b').length).toBe(0);
    expect(item.html()).not.toContain('&amp;#038;');
    const thumbnail = item.find('a[aria-label^="閱讀："]');
    expect(thumbnail.length).toBe(1);
    expect(thumbnail.attr('aria-label')).toBe('閱讀：She Rarely Reaches Out But Our Chemistry & Sex Are Great <b>');
  });
});

describe('search hit evidence', () => {
  test('an indexed historical body hit shows its id, version, snippet source and normalization, as plain text', () => {
    const $ = render(answer(partial));
    const hit = row($, 20875);
    expect(hit.length).toBe(1);
    expect(hit.text()).toContain('內文相符');
    expect(hit.text()).toContain(SNIPPET);
    expect(hit.find('[data-search-evidence]').text()).toBe(
      '文章 #20875 · 比對版本 nfkc-lower-trigram-prefix-v1 · 片段來源 已取得的文章正文 · 片段經 NFKC 與小寫正規化，大小寫可能與原文不同',
    );
    expect(hit.find('a[href="https://a.example/p/20875"]').length).toBeGreaterThan(0);
    // The metadata hit says where its snippet came from, and no normalization it did not get.
    expect(row($, 30001).find('[data-search-evidence]').text()).toBe(
      '文章 #30001 · 比對版本 literal-metadata-ingestion-v2 · 片段來源 標題',
    );
    const html = $.html();
    for (const secret of ['PRIVATE_RAW_BODY_TAIL', 'f'.repeat(64), 'private-source']) expect(html, secret).not.toContain(secret);
  });

  test('a legacy hit without evidence says 未提供; nothing is inferred from matchSource', () => {
    const legacy = { id: 7, title: '舊文', url: 'https://a.example/old', snippet: '蛤蜊絲瓜', matchSource: 'body' };
    const $ = render({
      items: [legacy],
      pagination: { page: 1, hasMore: false },
      coverage: { limit: 1000, scannedPosts: 1000, truncated: true },
    });
    expect(row($, 7).find('[data-search-evidence]').text()).toBe('文章 ID 未提供 · 比對版本 未提供 · 片段來源 未提供');
  });

  test('unsafe values never become links, markup or labels', () => {
    const $ = render(
      answer(partial, [
        {
          ...bodyHit,
          url: 'javascript:alert(1)',
          snippet: '<img src=x onerror=alert(1)>蛤蜊',
          contextSource: 'raw-body',
          matchVersion: '<b>v</b>',
          articleId: -1,
        },
      ]),
    );
    expect($('a[href^="javascript"]').length).toBe(0);
    expect($('img[onerror]').length).toBe(0);
    expect($('[data-search-evidence]').text()).toBe(
      '文章 ID 未提供 · 比對版本 未提供 · 片段來源 未提供 · 片段經 NFKC 與小寫正規化，大小寫可能與原文不同',
    );
  });
});

describe('search coverage', () => {
  test('partial: metadata scope and the indexed body prefix are said apart, with the gateway caps; never whole-site', () => {
    const $ = render(answer(partial));
    // The scope is explanation: it waits in the page's closed 本頁的資料來源與計算方式, not above the results.
    expect($('#method [data-search-coverage]').length).toBe(1);
    expect(outsideText($)).not.toContain('標題、摘要、部落格名稱與公開標籤');
    const text = coverageText($);
    expect(text).toContain(
      '標題、摘要、部落格名稱與公開標籤：只查最近收錄的最多 1,000 篇（本次查找 1,000 篇），更早收錄的文章不在這部分的範圍內。',
    );
    expect(text).toContain(
      '歷史正文搜尋只比對已建索引文章的正文前 4,096 個字（原始正文上限 64 KiB），最多取 200 篇候選，本次候選已達上限，可能還有未列出的文章；未建索引的文章與正文後段不在範圍內，並非全站全文搜尋。',
    );
    // The old blanket claim is gone; the counts wait in a closed <details>.
    expect(text).not.toContain('更早的文章不在範圍內');
    expect($('details[open]').length).toBe(0);
    const details = $('[data-search-coverage] details').text();
    expect(details).toContain('索引版本 nfkc-lower-trigram-prefix-v1');
    expect(details).toContain('本次候選 200 篇；過期或不符資格 3、超過大小上限 2、編碼無效 1、正文超過索引前段 5 篇。');
    expect(details).toContain('未建索引的文章數：未知。');
    for (const word of ['全站全文', '所有文章', '完整搜尋']) expect(text.replace('並非全站全文搜尋', ''), word).not.toContain(word);
  });

  test('caps come from the gateway: other values are shown as sent, not as 4096/200', () => {
    const $ = render(answer({ ...partial, prefixCodepoints: 1024, rawBodyByteLimit: 1000, candidateLimit: 50, candidateTruncated: false }));
    const text = coverageText($);
    expect(text).toContain('正文前 1,024 個字（原始正文上限 1,000 bytes），最多取 50 篇候選；');
    expect(text).not.toContain('已達上限');
    expect(text).not.toContain('4,096');
  });

  const states: Array<[string, unknown, string]> = [
    ['not enabled', { status: 'not-enabled', exhaustive: false }, '歷史正文搜尋目前未開啟：較早文章的正文沒有被搜尋。'],
    [
      'short query',
      { ...partial, status: 'short-query', candidates: 0 },
      '關鍵字少於 3 個字，這次沒有使用歷史正文索引；這不代表較早文章的正文沒有提到它。',
    ],
    ['unavailable', { ...partial, status: 'unavailable', candidates: 0 }, '歷史正文索引這次無法使用；這不代表較早文章的正文沒有提到它。'],
    ['an unknown status', { ...partial, status: 'complete' }, '歷史正文搜尋：範圍未提供。'],
    ['an older gateway (no historicalBody)', undefined, '歷史正文搜尋：此搜尋服務未提供正文索引的範圍，無法說明是否查過較早文章的正文。'],
  ];
  for (const [name, body, said] of states)
    test(`${name}: said as such, with no counts and no claim of none found`, () => {
      const $ = render(answer(body, []));
      const text = coverageText($);
      expect(text).toContain(said);
      expect(text).not.toContain('前 4,096 個字');
      expect($('[data-search-coverage] details').length).toBe(0);
      expect(text).not.toMatch(/候選 0|0 篇候選/);
      expect($('[role="status"]').text()).toContain('找不到');
      expect($('#method').text()).toContain('找不到不代表其他文章沒有提到它');
    });

  test('missing metadata counts are 未提供, never 1000 or 0', () => {
    const $ = render({ items: [], pagination: { page: 1, hasMore: false } });
    const text = coverageText($);
    expect(text).toContain('標題、摘要、部落格名稱與公開標籤：查找範圍未提供（本次查找 未提供 篇）。');
    expect(text).not.toMatch(/1,000|（本次查找 0 篇）/);
  });

  test('links stay no-prefetch; result evidence uses the muted zinc with its dark variant', () => {
    const $ = render(answer(partial));
    $('a[href^="/"]').each((_, el) => {
      expect($(el).attr('data-prefetch'), $(el).attr('href')).toBe('false');
    });
    expect($('[data-search-evidence]').first().attr('class')).toContain('dark:text-zinc-400');
  });
});
