/**
 * The topic page's 共用標籤 block, rendered for real (react-dom/server) and read back with cheerio.
 * Every sharedLabels value below is a synthetic fixture, not a tag.observe.tw answer. Next's hooks, links
 * and images and usePublicJson are mocked as in topic-method-render.spec.tsx, and fetch throws: the block
 * reads only the topic payload. Server markup only: image loading, phone layout and the picture itself
 * are not exercised, so nothing here is a visual check.
 */
import { type CheerioAPI, load } from 'cheerio';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import FooterMethod from '@/components/FooterMethod';
import SharedTopicLabels from '@/components/public/SharedTopicLabels';
import TopicDetailView, { TopicDetailFromUrl } from '@/components/public/TopicDetail';
import { taipei } from '@/lib/api';
import { topicApiPath } from '@/lib/public-query';
import type { HistoryArticle, TopicDetail, VocabularyStatus } from '@/lib/topics';
import type { PublicLoad } from '@/lib/use-public-json';

const nav = vi.hoisted(() => ({ pathname: '/', search: '' }));
const publicJson = vi.hoisted(() => ({ load: null as unknown, paths: [] as Array<string | null> }));
const fetches: unknown[] = [];

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
  fetches.length = 0;
  vi.stubGlobal('fetch', (...args: unknown[]) => {
    fetches.push(args);
    throw new Error('the shared-label block must not fetch');
  });
});
afterEach(() => {
  expect(fetches).toEqual([]);
  vi.unstubAllGlobals();
});

function render(page: ReactNode, pathname: string, search = '') {
  nav.pathname = pathname;
  nav.search = search;
  return load(
    renderToString(
      <>
        <main>{page}</main>
        <footer>
          <FooterMethod />
        </footer>
      </>,
    ),
  );
}

const SUMMARY = '本頁的資料來源與計算方式';
const methodBlocks = ($: CheerioAPI) => $('details').filter((_, el) => $(el).children('summary').text().includes(SUMMARY));
function position($: CheerioAPI, selection: { get(index: number): unknown; length: number }) {
  expect(selection.length).toBeGreaterThan(0);
  return ($('*').toArray() as unknown[]).indexOf(selection.get(0));
}
const sectionTitled = ($: CheerioAPI, title: string) =>
  $('h2')
    .filter((_, el) => $(el).text() === title)
    .closest('section');
const shared = ($: CheerioAPI) => $('section[aria-labelledby="shared-labels"]');
/** Images not served by this site (blog icons are same-site paths): only the block's checked image may be one. */
const outsideImages = ($: CheerioAPI) => $('img').filter((_, el) => !/^\/(?!\/)/.test($(el).attr('src') ?? ''));
/** One closed method block inside the page, as topic-method-render.spec.tsx requires. */
function oneMethodBlock($: CheerioAPI) {
  const blocks = methodBlocks($);
  expect(blocks.length).toBe(1);
  expect($('details').length).toBe(1);
  expect(blocks.attr('open')).toBeUndefined();
  expect(blocks.closest('main').length).toBe(1);
  return blocks;
}

const TAG = '旅行';
const SHA = 'b8d030c747f87c997800371e33e1ab2d168ad257';
const ORIGIN = 'https://tag.observe.tw';
const hex = (n: number) => n.toString(16).padStart(64, '0');
const tagPath = (label: string) => `/tag/${encodeURIComponent(label)}/`;
const IMAGE = `/api/v1/tags/${encodeURIComponent(TAG)}/visual-image?v=abc123`;
const FETCHED = '2026-10-12T04:00:00.000Z';

const relation = (id: string, type: string, label: string, more: Record<string, unknown> = {}) => ({
  id,
  type,
  target: { id: hex(id.length * 100 + label.length), label, href: tagPath(label) },
  source: 'manual',
  sourceDetail: 'curator',
  createdAt: null,
  status: 'approved',
  inherited: false,
  depth: 1,
  ...more,
});
const RELATIONS = [
  relation('r1', 'is-a', '戶外活動'),
  relation('r2', 'is-a', '休閒', { inherited: true, depth: 2, source: 'rule', sourceDetail: 'closure' }),
  relation('r3', 'related', '旅遊群組', { target: { id: 'group:3', label: '旅遊群組', href: '/group/3/' } }),
  relation('r4', 'alias', '旅遊', { source: 'submission', sourceDetail: 'form' }),
];
const relationsData = (relations: unknown[] = RELATIONS, more: Record<string, unknown> = {}) => ({
  tag: TAG,
  tagId: hex(1),
  truncated: false,
  relations,
  ...more,
});
const visualData = (visual: Record<string, unknown> | null = {}) => ({
  tag: TAG,
  visual:
    visual === null
      ? null
      : {
          kind: 'place',
          emoji: null,
          label: '旅行',
          wikidataId: null,
          image: IMAGE,
          large: null,
          source: {
            pageUrl: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg',
            license: 'CC BY-SA 4.0',
            licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
            artist: 'Fixture Artist',
          },
          ...visual,
        },
});
const snap = (data: unknown, more: Record<string, unknown> = {}) => ({
  status: 'ready',
  fetchedAt: FETCHED,
  expiresAt: '2026-10-13T04:00:00.000Z',
  sourceContractSha: SHA,
  payloadVersion: null,
  data,
  ...more,
});
const enabled = (relations: unknown = snap(relationsData()), visual: unknown = snap(visualData())) => ({
  status: 'enabled',
  source: ORIGIN,
  relations,
  visual,
});

const HASH = 'a'.repeat(64);
const ID = `tag:${HASH}`;
const PATH = '/topics/%E6%97%85%E8%A1%8C/';
const vocabulary: VocabularyStatus = {
  status: 'ready',
  source: 'tag-vocabulary',
  version: 'tags-fixture',
  coverage: 'all-current-indexed-article-tags',
  syncedAt: '2026-10-12T04:00:00.000Z',
};
const topic = { id: ID, label: TAG, source: 'tag-vocabulary', canonicalId: ID, canonicalPath: PATH };
const detail = (sharedLabels: unknown, more: Partial<TopicDetail> = {}): TopicDetail => ({
  days: 30,
  vocabulary,
  topic,
  blogs: [{ id: 1, slug: 'a', name: '甲', posts: 1, score: 2 }],
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
  ...(sharedLabels === undefined ? {} : { sharedLabels: sharedLabels as TopicDetail['sharedLabels'] }),
  ...more,
});
const ready = <T,>(data: T): PublicLoad<T> => ({ status: 'ready', data });
const page = (sharedLabels: unknown, more: Partial<TopicDetail> = {}) =>
  render(<TopicDetailView id={ID} path={PATH} days="30" load={ready(detail(sharedLabels, more))} />, PATH);
const alone = (value: unknown) => render(<SharedTopicLabels value={value} tag={TAG} />, PATH);

describe('off or absent', () => {
  for (const [name, value] of [
    ['absent (older gateway)', undefined],
    ['not-enabled', { status: 'not-enabled' }],
    ['not an object', 'enabled'],
  ] as const) {
    test(`${name}: no block, no image, no notes, no tag.observe.tw link beyond the vocabulary source`, () => {
      const $ = page(value);
      expect(shared($).length).toBe(0);
      expect(outsideImages($).length).toBe(0);
      // The vocabulary note already credits tag.observe.tw (its home page); B3 adds no tag/group page,
      // no visual-image path and no wording of its own, and the existing credit stays.
      const upstream = $('a')
        .toArray()
        .map((el) => $(el).attr('href') ?? '')
        .filter((href) => href.includes('tag.observe.tw'));
      expect(upstream.length).toBeGreaterThan(0);
      expect(new Set(upstream)).toEqual(new Set([ORIGIN]));
      expect($(`a[href="${ORIGIN}"]`).first().text()).toBe('新文易數');
      expect($.html()).not.toMatch(/tag\.observe\.tw\/(?:tag|group)\/|\/api\/v1\/tags\//);
      expect($('main').text()).not.toContain('共用標籤');
      expect($.html()).toBe(page(undefined).html());
      expect(oneMethodBlock($).text()).not.toContain('共用標籤');
      expect(sectionTitled($, '相關文章').length).toBe(1);
      expect(alone(value)('main').html()).toBe('');
    });
  }
});

describe('ready', () => {
  test('is-a, related and alias apart, with inheritance, depth, source and fetch time, after the articles', () => {
    const $ = page(enabled());
    const block = shared($);
    expect(block.length).toBe(1);
    const articles = sectionTitled($, '相關文章');
    const method = oneMethodBlock($);
    expect(position($, articles)).toBeLessThan(position($, block));
    expect(position($, sectionTitled($, '哪些部落格在寫'))).toBeLessThan(position($, block));
    expect(position($, block)).toBeLessThan(position($, method));
    expect(block.closest('details').length).toBe(0);

    expect(
      block
        .find('h4')
        .toArray()
        .map((el) => $(el).text()),
    ).toEqual(['上位分類', '相關詞', '別名']);
    const rows = block.find('li');
    expect(rows.length).toBe(4);
    expect(rows.eq(0).text()).toContain('直接（第 1 層）');
    expect(rows.eq(0).text()).toContain('人工整理（curator）');
    expect(rows.eq(1).text()).toContain('繼承（第 2 層）');
    expect(rows.eq(1).text()).toContain('規則推導（closure）');
    expect(rows.eq(3).text()).toContain('使用者提交（form）');
    expect(block.text()).toContain('本站話題不因此合併');
    expect(block.text()).toContain('共 4 條');
    expect(block.text()).not.toContain('完整清單');

    // Links: only the checked tag/group pages, external and without referrer; no site topic page is built.
    const hrefs = block
      .find('a')
      .toArray()
      .map((el) => $(el).attr('href'));
    expect(hrefs).toContain(`${ORIGIN}${tagPath('戶外活動')}`);
    expect(hrefs).toContain(`${ORIGIN}/group/3/`);
    expect(hrefs).toContain(`${ORIGIN}${tagPath(TAG)}`);
    for (const href of hrefs.filter((h) => h?.startsWith(ORIGIN))) expect(href).toMatch(/^https:\/\/tag\.observe\.tw\/(tag|group)\//);
    expect(hrefs.some((h) => h?.startsWith('/topics/'))).toBe(false);
    block.find('a').each((_, el) => {
      expect($(el).attr('target')).toBe('_blank');
      expect($(el).attr('rel')).toBe('noopener noreferrer');
    });

    // Provenance: fetch time, and no version claimed in place of the contract SHA.
    expect(block.text()).toContain(`取得時間：${taipei(FETCHED)}`);
    expect(block.text()).toContain('資料版本：上游未提供');
    expect(block.text()).not.toContain(SHA);
    expect(method.text()).toContain(`解析契約 ${SHA}；上游未提供資料版本`);
    expect(method.text()).toContain('共用標籤');
    // No zero-network claim: only the relation/visual JSON is not read again; the picture itself loads from upstream.
    expect(method.text()).toContain('頁面不會另外向上游讀取關係或圖示資料（JSON）');
    expect(method.text()).toContain(`若有代表圖片，則由瀏覽器直接向 ${ORIGIN} 載入圖片本身`);
    expect(method.text()).not.toContain('頁面不會另外向上游讀取。');
  });

  test('the image: the checked same-origin path, fixed size, lazy, async, with the real credit values', () => {
    const $ = page(enabled());
    const img = shared($).find('img');
    expect(img.length).toBe(1);
    expect(img.attr('src')).toBe(`${ORIGIN}${IMAGE}`);
    expect(img.attr('width')).toBe('64');
    expect(img.attr('height')).toBe('64');
    expect(img.attr('loading')).toBe('lazy');
    expect(img.attr('decoding')).toBe('async');
    expect(img.attr('alt')).toBe('「旅行」代表圖示');
    const credit = shared($).text();
    expect(credit).toContain('圖片來源：commons.wikimedia.org');
    expect(credit).toContain('作者：Fixture Artist');
    expect(credit).toContain('授權：CC BY-SA 4.0');
    expect(shared($).find('a[href="https://creativecommons.org/licenses/by-sa/4.0/"]').attr('rel')).toBe('noopener noreferrer');
  });

  test('unknown licence, artist or source say 未提供; nothing is made up', () => {
    let $ = page(
      enabled(
        undefined,
        snap(visualData({ source: { pageUrl: 'https://commons.wikimedia.org/x', license: null, licenseUrl: null, artist: null } })),
      ),
    );
    expect(shared($).text()).toContain('作者：未提供 · 授權：未提供');
    $ = page(enabled(undefined, snap(visualData({ source: null }))));
    expect(shared($).text()).toContain('圖片來源：未提供 · 作者：未提供 · 授權：未提供');
    expect(shared($).find('img').length).toBe(1);
  });

  test('no image: an emoji stays text, otherwise no picture and no placeholder', () => {
    let $ = page(enabled(undefined, snap(visualData({ kind: 'emoji', image: null, emoji: '🧳', source: null }))));
    expect(shared($).find('img').length).toBe(0);
    expect(shared($).find('[role="img"]').text()).toBe('🧳');
    expect(shared($).text()).not.toContain('圖片來源');
    $ = page(enabled(undefined, snap(visualData({ image: null, large: null }))));
    expect(outsideImages($).length).toBe(0);
    expect(shared($).find('[role="img"]').length).toBe(0);
    expect(shared($).text()).toContain('上游未提供圖片。');
    $ = page(enabled(undefined, snap(visualData(null))));
    expect(outsideImages($).length).toBe(0);
    expect(shared($).text()).toContain('上游回覆此標籤沒有代表圖示。');
  });
});

describe('states', () => {
  test('missing is not fetched yet, unavailable is unavailable, ready-empty is the upstream empty answer', () => {
    let text = page(enabled(snap(undefined, { status: 'missing', fetchedAt: null }), snap(undefined, { status: 'missing' })))(
      'main',
    ).text();
    expect(text).toContain('尚未取得標籤關係；這不代表沒有關係。');
    expect(text).toContain('尚未取得代表圖示。');
    text = page(enabled(snap(undefined, { status: 'unavailable' }), snap(undefined, { status: 'unavailable' })))('main').text();
    expect(text).toContain('標籤關係暫時無法使用。');
    expect(text).toContain('代表圖示暫時無法使用。');
    text = page(enabled(snap(relationsData([]))))('main').text();
    expect(text).toContain('上游回覆此標籤目前沒有已核准的關係。');
  });

  test('more than 24 relations: 24 rows, one per id, with the total and the truncation kept', () => {
    const rows = Array.from({ length: 30 }, (_, i) => relation(`r${i % 29}`, ['is-a', 'related', 'alias'][i % 3], `詞${i}`));
    const $ = page(enabled(snap(relationsData(rows, { truncated: true }))));
    expect(shared($).find('li').length).toBe(24);
    expect(shared($).text()).toContain('本頁收到 29 條，只顯示前 24 條；上游回應已截斷，這不是完整清單');
  });

  test('bad values never crash the topic page and never put an outside image on it', () => {
    for (const value of [
      enabled('oops', snap(visualData({ image: 'https://evil.example/a.png' }))),
      enabled(null, 42),
      enabled(snap({ tag: TAG }), snap(visualData({ image: `${IMAGE}&w=1` }))),
      enabled(
        snap(relationsData([relation('x', 'is-a', '詞', { target: { id: hex(5), label: '詞', href: 'https://evil.example/' } })])),
        snap(visualData({ image: '//evil.example/api/v1/tags/x/visual-image?v=1' })),
      ),
      { ...enabled(), source: 'https://evil.example' },
      enabled(snap(relationsData(undefined, { tag: '露營' })), snap(visualData(), { payloadVersion: SHA })),
    ]) {
      const $ = page(value);
      expect(sectionTitled($, '相關文章').find('a[data-analytics="open_original"]').length).toBe(1);
      expect(outsideImages($).length).toBe(0);
      expect(shared($).find('img').length).toBe(0);
      expect($.html()).not.toContain('evil.example');
      expect(shared($).text()).toContain('暫時無法使用');
      oneMethodBlock($);
    }
    // The other half is unaffected.
    const $ = page(enabled('oops'));
    expect(shared($).text()).toContain('標籤關係暫時無法使用。');
    expect(shared($).find('img').length).toBe(1);
  });

  test('a relation href that resolves to another page (/tag/./ is /tag/) links nothing', () => {
    const $ = page(enabled(snap(relationsData([relation('d', 'related', '.')]))));
    expect(shared($).text()).toContain('標籤關係暫時無法使用。');
    const hrefs = shared($)
      .find('a')
      .toArray()
      .map((el) => $(el).attr('href'));
    expect(hrefs.filter((h) => h?.startsWith(`${ORIGIN}/tag/`))).toEqual([`${ORIGIN}${tagPath(TAG)}`]);
    expect($.html()).not.toContain(`${ORIGIN}/tag/./`);
  });
});

describe('topic page integration', () => {
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

  test('the history fallback stays first; the block follows it; one method block', () => {
    const history = {
      articles: [historyArticle(1, 'confirmed'), historyArticle(2, 'pending')],
      nextCursor: null,
      confirmed: 1,
      pending: 1,
      total: 2,
      lastObservedAt: null,
    };
    const $ = page(enabled(), { articles: [], history });
    const past = sectionTitled($, '過去觀測到的文章');
    expect(past.find('li').length).toBe(2);
    expect(position($, past)).toBeLessThan(position($, shared($)));
    expect(position($, shared($))).toBeLessThan(position($, oneMethodBlock($)));
    expect(publicJson.paths.filter(Boolean)).toEqual([]);
  });

  test('an excluded or inactive term shows no block', () => {
    for (const more of [{ excludedReason: 'pure-number' }, { inactiveReason: 'low-frequency' }]) {
      const $ = page(enabled(), { topic: { ...topic, ...more }, articles: [], blogs: [] });
      expect(shared($).length).toBe(0);
      expect(oneMethodBlock($).text()).not.toContain('共用標籤');
    }
  });

  test('?days=7 renders the block from the same /api/topics/:id payload and reads nothing else', () => {
    publicJson.load = ready(detail(enabled(snap(relationsData([relation('r9', 'related', '露營')]))), { days: 7 }));
    let $ = render(<TopicDetailFromUrl id={ID} path={PATH} baseline={ready(detail(enabled()))} />, PATH, 'days=7');
    expect(publicJson.paths.filter(Boolean)).toEqual([topicApiPath(ID, '7')]);
    expect(shared($).find('li').length).toBe(1);
    expect(shared($).text()).toContain('露營');
    oneMethodBlock($);

    publicJson.paths = [];
    $ = render(<TopicDetailFromUrl id={ID} path={PATH} baseline={ready(detail(enabled()))} />, PATH);
    expect(publicJson.paths.filter(Boolean)).toEqual([]);
    expect(shared($).find('li').length).toBe(4);
  });
});
