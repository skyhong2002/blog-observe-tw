/**
 * The real HomePage server component and the masthead's real topic cloud, rendered with react-dom/server and read
 * back with cheerio. homeOverview and publicJson go through the real readPublic and public-contracts.ts over a fake
 * gateway (no HTTP), so a malformed or missing `mentions` fails exactly as a gateway 200 would. The left ranking and
 * the cloud are async Suspense children of the page and are stubbed there; the cloud is then rendered on its own.
 * Blog icons are stubbed. Synthetic payloads; not a UI or production acceptance.
 */
import { type CheerioAPI, load } from 'cheerio';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { taipei } from '@/lib/api';
import { PublicGatewayError } from '@/lib/public-read';
import { EMPTY } from './public-payloads.ts';

const gateway = vi.hoisted(() => ({
  bodies: new Map<string, { status: number; body: unknown }>(),
  paths: [] as string[],
}));

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ prefetch, scroll: _scroll, ...props }: Record<string, unknown>) =>
      createElement('a', { ...props, 'data-prefetch': String(prefetch) }),
    useLinkStatus: () => ({ pending: false }),
  };
});
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock('@/app/_home/home.module.css', () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));
vi.mock('@/components/WordCloudView.module.css', () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));
// public-api.ts without `server-only` and the gateway origin: the same publicJson rules over a fake fetch.
vi.mock('@/lib/public-api', async () => {
  const { PublicGatewayError, readPublic } = await import('@/lib/public-read');
  const publicJson = async (path: string) => {
    gateway.paths.push(path);
    const result = await readPublic(
      'https://gateway.invalid',
      path,
      async () => {
        const answer = gateway.bodies.get(path) ?? { status: 404, body: { error: 'not found' } };
        return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
      },
      () => Promise.resolve(),
    );
    if (!result.found) throw new PublicGatewayError(path, 404);
    return result.body;
  };
  return { publicJson, homeOverview: () => publicJson('/api/overview?view=home') };
});
vi.mock('@/components/BlogIcon', () => ({ default: () => null }));

const stubs = vi.hoisted(() => ({ cloud: true }));
vi.mock('@/app/_home/HomeTopics', async (original) => ({
  ...(await original<object>()),
  default: () => null,
  HomeTopicsPending: () => null,
}));
vi.mock('@/app/_home/HomeTopicCloud', async (original) => {
  const real = await original<{ default: () => Promise<unknown> }>();
  return { default: (...args: []) => (stubs.cloud ? null : real.default(...args)) };
});

import HomeTopicCloud from '@/app/_home/HomeTopicCloud';
import HomePage from '@/app/page';

const OVERVIEW = '/api/overview?view=home';
const TOPICS = '/api/topics?days=30&view=home';
const REPORTED = 'She Rarely Reaches Out But Our Chemistry &#038; Sex Are Great';
const SHOWN = 'She Rarely Reaches Out But Our Chemistry & Sex Are Great';
const PUBLISHED = '2026-10-13T00:00:00.000Z';
const mention = (patch: object = {}) => ({
  postId: 20875,
  postTitle: REPORTED,
  postUrl: 'https://a.example/p/1',
  publishedAt: PUBLISHED,
  sourceBlogId: 1,
  sourceBlogSlug: 'a',
  sourceBlogName: '甲',
  sourceIconUrl: null,
  targetBlogId: 2,
  targetBlogSlug: 'b',
  targetBlogName: '乙',
  targetHomeUrl: 'https://b.example/',
  targetDomain: 'b.example',
  targetIconUrl: null,
  evidenceType: 'direct-link',
  location: 'body',
  anchor: '乙的文章 <b>x</b>',
  context: '這裡提到乙 <script>alert(1)</script>。',
  observedAt: '2026-10-13T06:00:00.000Z',
  matchVersion: 'relations-v3',
  contextSource: 'body',
  ...patch,
});
const mentions = (items: object[], patch: object = {}) => ({
  ...(EMPTY.homeOverview as { mentions: object }).mentions,
  items,
  ...patch,
});
const overview = (patch: object = {}) => ({
  ...(EMPTY.homeOverview as object),
  recentBlogs: [
    {
      slug: 'c',
      name: '丙',
      latestPost: { id: 3, title: `${REPORTED} &amp;#038;`, url: 'https://c.example/p/3', publishedAt: PUBLISHED },
    },
  ],
  totals: { blogs: 3, posts: 30 },
  ...patch,
});
const answer = (path: string, body: unknown, status = 200) => gateway.bodies.set(path, { status, body });
const renderHome = async () => load(renderToString(await HomePage()));
const headings = ($: CheerioAPI) =>
  $('h2')
    .map((_, el) => $(el).text())
    .get();

beforeEach(() => {
  gateway.bodies.clear();
  gateway.paths = [];
  stubs.cloud = true;
});

describe('homepage centre: body citations', () => {
  test('an article linking to three blogs is one card listing all three, with the article image when sent', async () => {
    const target = (id: number, slug: string, name: string) =>
      mention({
        postImageUrl: 'https://a.example/img/cover.jpg',
        targetBlogId: id,
        targetBlogSlug: slug,
        targetBlogName: name,
        targetHomeUrl: `https://${slug}.example/`,
        targetDomain: `${slug}.example`,
      });
    answer(
      OVERVIEW,
      overview({
        mentions: mentions([
          target(2, 'b', '乙'),
          target(3, 'c', '丙'),
          target(4, 'd', '丁'),
          mention({ postId: 50001, postUrl: 'https://a.example/p/2', postImageUrl: null }),
        ]),
      }),
    );
    const $ = await renderHome();
    const cards = $('[data-mention-card]');
    expect(cards.map((_, el) => $(el).attr('data-mention-card')).get()).toEqual(['1:20875', '1:50001']);
    const first = cards.eq(0);
    expect(
      first
        .find('[data-mention]')
        .map((_, el) => $(el).attr('data-mention'))
        .get(),
    ).toEqual(['20875:2', '20875:3', '20875:4']);
    // The thumbnail links to the original article; a card without an image renders no image box.
    const image = first.find('img');
    expect(image.length).toBe(1);
    expect(image.closest('a').attr('href')).toBe('https://a.example/p/1');
    expect(cards.eq(1).find('img').length).toBe(0);
  });
  test('one row per article→blog link: decoded title linked out, target blog chip with its quote, date', async () => {
    const before = overview({
      mentions: mentions([
        mention(),
        // The reverse direction is its own row with its own date, never merged into an exchange.
        mention({
          postId: 30001,
          postTitle: '乙回應甲',
          postUrl: 'https://b.example/p/9',
          publishedAt: '2026-07-01T00:00:00.000Z',
          sourceBlogId: 2,
          sourceBlogSlug: 'b',
          sourceBlogName: '乙',
          targetBlogId: 1,
          targetBlogSlug: 'a',
          targetBlogName: '甲',
          targetHomeUrl: 'https://a.example/',
          targetDomain: 'a.example',
        }),
        // No safe URL from the gateway: the title is text, never a link.
        mention({ postId: 40001, postTitle: 'Unsafe', postUrl: null, publishedAt: null }),
      ]),
    });
    answer(OVERVIEW, before);
    const snapshot = structuredClone(before);
    const $ = await renderHome();
    expect(gateway.paths).toEqual([OVERVIEW]);
    // Three different source articles: three cards, each with its one target.
    const cards = $('[data-mention-card]');
    expect(cards.map((_, el) => $(el).attr('data-mention-card')).get()).toEqual(['1:20875', '2:30001', '1:40001']);
    expect($('[data-mention]').length).toBe(3);

    const first = cards.eq(0);
    const title = first.find('h3 a');
    expect(title.text()).toBe(SHOWN);
    expect(title.attr('href')).toBe('https://a.example/p/1');
    expect(title.attr('data-analytics')).toBe('open_original');
    expect(title.attr('rel')).toBe('noopener noreferrer');
    expect(first.find(`time[datetime="${PUBLISHED}"]`).text()).toBe(taipei(PUBLISHED));
    // Each linked blog is a chip with the words around the link right under it: no disclosure, no
    // observation/parser/domain lines, and anchor/context markup stays text.
    const target = first.find('[data-mention="20875:2"]');
    expect(target.find('a').text()).toBe('乙');
    expect(target.find('[class~="mentionQuote"]').text()).toBe('「這裡提到乙 <script>alert(1)</script>。」');
    expect(target.find('b, script').length).toBe(0);
    expect(first.find('details').length).toBe(0);
    expect(first.text()).not.toMatch(/解析版本|觀測|b\.example|正文直接連結/);
    // Internal blog links keep the stable slug path, never prefetch.
    expect(first.find('a[href="/blogs/a/"]').attr('data-prefetch')).toBe('false');
    expect(target.find('a[href="/blogs/b/"]').attr('data-prefetch')).toBe('false');

    // The reverse direction is a different source article: its own card and its own date.
    expect(cards.eq(1).find('h3 a').attr('href')).toBe('https://b.example/p/9');
    expect(cards.eq(1).find('[data-mention] a').text()).toBe('甲');
    expect(cards.eq(1).find('time').attr('datetime')).toBe('2026-07-01T00:00:00.000Z');
    expect(cards.eq(2).find('h3 a').length).toBe(0);
    expect(cards.eq(2).find('h3').text()).toBe('Unsafe');
    expect(cards.eq(2).text()).toContain('發文日期不明');

    // The rows come first: the long method text lives in the page's method disclosure (FooterMethod, tested below).
    const centre = $('section[aria-label="最近的正文引用"]');
    expect(centre.children().eq(1).hasClass('storyList')).toBe(true);
    expect(centre.text()).not.toMatch(/交流|互惠|抄襲|側欄、Blogroll/);
    expect(centre.text()).not.toContain('只列最近');
    // The payload is untouched.
    expect(before).toEqual(snapshot);
  });

  test('one article citing two blogs is one title card listing both targets, each with its own evidence', async () => {
    answer(
      OVERVIEW,
      overview({
        mentions: mentions([
          mention({ anchor: '乙', context: '提到乙。', observedAt: '2026-10-13T06:00:00.000Z', matchVersion: 'relations-v3' }),
          mention({
            targetBlogId: 3,
            targetBlogSlug: 'c',
            targetBlogName: '丙',
            targetHomeUrl: 'https://c.example/',
            targetDomain: 'c.example',
            targetBlogCanonicalPath: '/blogs/c.example/',
            targetIconUrl: '/favicons/c.png',
            anchor: '丙',
            context: '也提到丙。',
            observedAt: '2026-10-12T06:00:00.000Z',
            matchVersion: 'relations-v4',
          }),
          // A repeated target for the same article keeps its first row only.
          mention({ anchor: '重複的乙' }),
          // Same title, different article id: a separate card, never merged by title.
          mention({ postId: 20876, postUrl: 'https://a.example/p/2' }),
        ]),
      }),
    );
    const $ = await renderHome();
    const cards = $('[data-mention-card]');
    expect(cards.map((_, el) => $(el).attr('data-mention-card')).get()).toEqual(['1:20875', '1:20876']);
    const card = cards.eq(0);
    expect(card.find('h3').length).toBe(1);
    expect(card.find('h3 a').text()).toBe(SHOWN);
    expect(card.find('time').length).toBe(1);
    const targets = card.find('[data-mention]');
    expect(targets.map((_, el) => $(el).attr('data-mention')).get()).toEqual(['20875:2', '20875:3']);
    expect(targets.eq(1).find('a[href="/blogs/c.example/"]').text()).toBe('丙');
    // Each target row carries its own quote: the context, else the anchor text.
    expect(targets.eq(0).find('[class~="mentionQuote"]').text()).toBe('「提到乙。」');
    expect(targets.eq(1).find('[class~="mentionQuote"]').text()).toBe('「也提到丙。」');
    expect(card.find('details').length).toBe(0);
    expect(card.text()).not.toContain('重複的乙');
    expect(cards.eq(1).find('h3 a').attr('href')).toBe('https://a.example/p/2');
    expect(cards.eq(1).find('h3 a').text()).toBe(SHOWN);
  });

  test('the three retired blocks are gone; the right sidebar and its recent-blog title stay', async () => {
    answer(OVERVIEW, overview({ mentions: mentions([mention()]) }));
    const $ = await renderHome();
    const h2 = headings($);
    for (const gone of ['最新文章', '我的閱讀', '沿著連結，認識新部落格']) expect(h2, gone).not.toContain(gone);
    expect($('body').text()).not.toContain('最近發文');
    expect($('[class~="hero"], [class~="band"]').length).toBe(0);
    expect(h2).toEqual(expect.arrayContaining(['最近共同話題', '最近的正文引用', '部落格觀察', '最新更新的部落格']));
    // The author list page was retired (authors are counted per blog on /blogs/), so is its homepage block.
    expect(h2).not.toContain('作者動態');
    // The ranking rule moved to the closed method block at the page foot; the list carries no inline note.
    expect($('body').text()).not.toContain('只列共同關鍵字詞庫的話題。');
    expect($('body').text()).not.toContain('同站貢獻逐次遞減');
    expect($('body').text()).not.toContain('RSS 標籤與共同詞彙分開列出');
    const recent = $('a[href="https://c.example/p/3"]');
    expect(recent.text()).toBe(`${SHOWN} &#038;`);
    expect(recent.attr('title')).toBe(`${SHOWN} &#038;`);
    // The mark and tagline render with the overview, before any topic read.
    expect($('h1#masthead').length).toBe(1);
    expect($('body').text()).toContain('每一種生活，各自怎麼寫');
  });

  test('truncated says only the latest 8; a true empty 90-day window is said as such, not as no links at all', async () => {
    answer(OVERVIEW, overview({ mentions: mentions([mention()], { truncated: true }) }));
    expect((await renderHome())('section[aria-label="最近的正文引用"] a.more').text()).toContain('只列最近 8 筆連結 · 看全站關係圖');
    answer(OVERVIEW, overview());
    const $ = await renderHome();
    expect($('[data-mention]').length).toBe(0);
    expect($('section[aria-label="最近的正文引用"] p.notice').text()).toBe('近 90 天沒有可列出的正文直接引用；這不代表各站之間沒有連結。');
  });

  const failures: Array<[string, () => void]> = [
    ['missing mentions', () => answer(OVERVIEW, { ...overview(), mentions: undefined })],
    ['mentions without items', () => answer(OVERVIEW, overview({ mentions: mentions([], { items: undefined }) }))],
    ['a shared-tag row', () => answer(OVERVIEW, overview({ mentions: mentions([mention({ evidenceType: 'shared-tag' })]) }))],
    ['a sidebar row', () => answer(OVERVIEW, overview({ mentions: mentions([mention({ location: 'sidebar' })]) }))],
    ['a numeric title', () => answer(OVERVIEW, overview({ mentions: mentions([mention({ postTitle: 1 })]) }))],
    // contextSource is the public enum 'body'; an internal extraction id or digest is not a public answer.
    [
      'an internal extraction contextSource',
      () => answer(OVERVIEW, overview({ mentions: mentions([mention({ contextSource: 'article-html' })]) })),
    ],
    ['a digest contextSource', () => answer(OVERVIEW, overview({ mentions: mentions([mention({ contextSource: 'a'.repeat(64) })]) }))],
    ['a non-text canonical path', () => answer(OVERVIEW, overview({ mentions: mentions([mention({ targetBlogCanonicalPath: 1 })]) }))],
    ['a 503 twice', () => answer(OVERVIEW, { error: 'busy' }, 503)],
  ];
  for (const [name, setup] of failures)
    test(`${name}: the page read throws, never an empty centre`, async () => {
      setup();
      await expect(HomePage()).rejects.toBeInstanceOf(PublicGatewayError);
    });

  test("readable canonical paths, when sent, are both rows' blog links; absent keeps the slug path", async () => {
    answer(
      OVERVIEW,
      overview({
        mentions: mentions([
          mention({ sourceBlogCanonicalPath: '/blogs/a.example/', targetBlogCanonicalPath: '/blogs/b.example/' }),
          mention({ postId: 2, targetBlogId: 3, targetBlogSlug: 'c', targetBlogName: '丙', targetDomain: 'c.example' }),
        ]),
      }),
    );
    const $ = await renderHome();
    // Two different source articles (20875 with paths, 2 without), so two cards: each card's own source path is
    // checked on the card, each target's path on its own target row.
    const [withPaths, legacy] = [$('[data-mention-card="1:20875"]'), $('[data-mention-card="1:2"]')];
    expect(withPaths.length).toBe(1);
    expect(legacy.length).toBe(1);
    expect(withPaths.find('[data-mention]').length).toBe(1);
    // Source: in the card header, outside the target rows.
    expect(withPaths.children().first().find('p').first().find('a[href="/blogs/a.example/"]').text()).toBe('甲');
    expect(withPaths.find('[data-mention="20875:2"] a[href="/blogs/b.example/"]').text()).toBe('乙');
    expect(withPaths.find('a[href="/blogs/a/"], a[href="/blogs/b/"]').length).toBe(0);
    expect(legacy.children().first().find('p').first().find('a[href="/blogs/a/"]').text()).toBe('甲');
    expect(legacy.find('[data-mention="2:3"] a[href="/blogs/c/"]').text()).toBe('丙');
    expect(legacy.find('[data-mention] a[href="/blogs/a/"]').length).toBe(0);
    const internal = $('[data-mention-card] a[href^="/"]');
    expect(internal.length).toBe(4);
    internal.each((_, el) => {
      expect($(el).attr('data-prefetch')).toBe('false');
    });
  });
});

describe('homepage method disclosure', () => {
  test("the citation rows' selection rules live in the closed 本頁的資料來源與計算方式 block", async () => {
    const { default: FooterMethod } = await import('@/components/FooterMethod');
    const $ = load(renderToString(<FooterMethod />));
    const block = $('details');
    expect(block.length).toBe(1);
    expect(block.attr('open')).toBeUndefined();
    expect(block.children('summary').text()).toContain('本頁的資料來源與計算方式');
    const text = $('#method').text();
    expect(text).toContain('近 90 天文章正文裡直接連到其他已收錄部落格的連結，依發文時間列出最近 8 筆');
    expect(text).toContain('同一篇文章連到幾個部落格就在同一張卡片列出幾筆，兩個方向是不同的文章、各自保留日期');
    expect(text).toContain('側欄、Blogroll、留言、共同標籤與文字相似都不列入，也不代表雙方交流');
    expect(text).toContain('最近共同話題（前 8 名）與首頁文字雲（同一份排行，最多 30 個）只取近 30 天共同關鍵字詞庫的排行');
    expect(text).toContain('標題有寫到它的不到三分之一，表示多半只是在正文順帶提到，這個詞仍留在排行，但不畫進文字雲');
    expect(text).toContain('排行看熱度與參與的部落格數，不看篇數多寡');
    expect(text).toContain('再乘上 log₂(1＋參與部落格數)');
    expect(text).toContain('且至少兩個部落格參與');
    expect(text).toContain('排行另略過背景詞');
    expect(text).toContain('長期基準與近 30 天分開計算');
    expect(text).toContain('仍保留在詞庫、話題頁與歷史文章，也沒有另設詞彙清單');
    // The method stays in the closed block, not in the homepage body.
    expect(text).not.toMatch(/人氣|傳承/);
  });
});

describe('masthead cloud: the local 30-day topic ranking only', () => {
  const topic = (i: number, patch: object = {}) => ({
    id: `tag:${String(i).padStart(64, '0')}`,
    label: `話題${i}`,
    source: 'tag-vocabulary',
    score: 1,
    posts: i + 2,
    blogs: 2,
    ...patch,
  });
  const topics = (items: object[]) => ({ ...(EMPTY.homeTopics as object), items });

  test('words link to topics (canonical path when sent), from the same path as the ranking; no raw tag links', async () => {
    stubs.cloud = false;
    answer(
      TOPICS,
      topics([
        topic(1, { canonicalPath: '/topics/%E8%A9%B1%E9%A1%8C1/' }),
        topic(2),
        // The home contract accepts these rows, but only the approved tag pool may become words.
        topic(3, { id: 'rss:3', label: 'RSS分類詞', source: 'rss-category' }),
      ]),
    );
    const $ = load(renderToString(await HomeTopicCloud()));
    expect(gateway.paths).toEqual([TOPICS]);
    expect($('body').text()).not.toContain('RSS分類詞');
    expect($('a[aria-label^="RSS分類詞"]').length).toBe(0);
    const hrefs = $('a')
      .map((_, el) => $(el).attr('href'))
      .get();
    expect(hrefs).toContain('/topics/%E8%A9%B1%E9%A1%8C1/');
    expect(hrefs.some((h) => h.startsWith('/topics/'))).toBe(true);
    expect(hrefs.some((h) => h.includes('/tags/?tag='))).toBe(false);
    expect($('a[aria-label^="話題1，近 30 天 3 篇文章"]').length).toBeGreaterThan(0);
  });

  test('cloudItems: up to 30 words from the same one response; the left list stays its 8; legacy falls back to items', async () => {
    stubs.cloud = false;
    const pool = Array.from({ length: 30 }, (_, i) => topic(i + 1));
    answer(TOPICS, { ...topics(pool.slice(0, 8)), cloudItems: pool, cloudTruncated: true });
    const $ = load(renderToString(await HomeTopicCloud()));
    expect(gateway.paths).toEqual([TOPICS]);
    const words = new Set(
      $('a[aria-label]')
        .map((_, el) => $(el).attr('aria-label')?.split('，')[0])
        .get(),
    );
    expect(words.size).toBeGreaterThan(8);
    expect(words.has('話題30')).toBe(true);
    // The real left ranking over the same answer still lists only its 8 rows.
    const { default: RealRanking } = await vi.importActual<{ default: () => Promise<Parameters<typeof renderToString>[0]> }>(
      '@/app/_home/HomeTopics',
    );
    const ranking = load(renderToString(await RealRanking()));
    expect(ranking('ol.ranking > li').length).toBe(8);
    expect(ranking('body').text()).not.toContain('話題9');
    // An older gateway without cloudItems: the cloud draws the same items as before.
    answer(TOPICS, topics(pool.slice(0, 8)));
    const legacy = load(renderToString(await HomeTopicCloud()));
    const legacyWords = new Set(
      legacy('a[aria-label]')
        .map((_, el) => legacy(el).attr('aria-label')?.split('，')[0])
        .get(),
    );
    expect(legacyWords.has('話題9')).toBe(false);
    expect(legacyWords.size).toBeGreaterThan(0);
  });

  test('body-mention words keep their ranking row but are not drawn; the cloud fills from later candidates', async () => {
    stubs.cloud = false;
    // 話題1–10 are mostly met in the body (a quarter of their articles in the title); the rest are title-led.
    const pool = Array.from({ length: 45 }, (_, i) => topic(i + 1, i < 10 ? { posts: 8, titlePosts: 2 } : { posts: 9, titlePosts: 3 }));
    answer(TOPICS, { ...topics(pool.slice(0, 8)), cloudItems: pool, cloudTruncated: true });
    const $ = load(renderToString(await HomeTopicCloud()));
    const words = new Set(
      $('a[aria-label]')
        .map((_, el) => $(el).attr('aria-label')?.split('，')[0])
        .get(),
    );
    for (let i = 1; i <= 10; i++) expect(words.has(`話題${i}`)).toBe(false);
    expect(words.has('話題11')).toBe(true);
    // Beyond the old 30-row slice: later candidates fill the places of the skipped words.
    expect(words.has('話題31')).toBe(true);
    expect(words.size).toBeLessThanOrEqual(30);
    // Exactly a third in the title is about the word; rows without titlePosts are not judged.
    const { topicCloudWords } = await import('@/lib/topic-cloud');
    // A heat-ranked pool is sized by rank (first largest), so many articles cannot outgrow a rising word;
    // a pool without heat (blog profiles) keeps article-count sizes.
    const ranked = topicCloudWords([topic(1, { posts: 3, heat: 2.1 }), topic(2, { posts: 300, heat: 0.9 })], '30');
    expect(ranked.map((w) => [w.label, w.count])).toEqual([
      ['話題1', 2],
      ['話題2', 1],
    ]);
    expect(topicCloudWords([topic(1, { posts: 3 }), topic(2, { posts: 300 })], '30').map((w) => w.count)).toEqual([3, 300]);
    expect(topicCloudWords([topic(1, { posts: 9, titlePosts: 3 }), topic(2)], '30').map((w) => w.label)).toEqual(['話題1', '話題2']);
    expect(topicCloudWords([topic(1, { posts: 9, titlePosts: 2 })], '30')).toEqual([]);
    // The left ranking over the same answer still lists the body-mention words.
    const { default: RealRanking } = await vi.importActual<{ default: () => Promise<Parameters<typeof renderToString>[0]> }>(
      '@/app/_home/HomeTopics',
    );
    expect(load(renderToString(await RealRanking()))('ol.ranking').text()).toContain('話題1');
  });

  test("tag's recoloured pictures replace a word only for that exact tag's checked path", async () => {
    const { parseCloudVisuals } = await import('@/lib/tag-visuals');
    const { topicCloudWords } = await import('@/lib/topic-cloud');
    const path = (tag: string) => `/api/v1/tags/${encodeURIComponent(tag)}/visual-image?v=abc&size=large&accent=22c55e`;
    const visuals = parseCloudVisuals({
      visuals: {
        話題1: { kind: 'place', image: path('話題1'), emoji: null },
        // Another tag's path, a foreign origin and unknown query keys are dropped; an emoji alone is kept.
        話題2: { image: path('話題9') },
        話題3: { image: 'https://evil.example/api/v1/tags/x/visual-image?v=a' },
        話題4: { image: `${path('話題4')}&layer=x` },
        話題5: { image: null, emoji: '🍜' },
      },
    });
    expect([...visuals.keys()]).toEqual(['話題1', '話題5']);
    expect(visuals.get('話題1')?.image).toBe(`https://tag.observe.tw${path('話題1')}`);
    const words = topicCloudWords([topic(1, { heat: 2 }), topic(2, { heat: 1.5 }), topic(5, { heat: 1 })], '30', 30, visuals);
    expect(words.map((w) => [w.label, w.image ?? null, w.emoji ?? null])).toEqual([
      ['話題1', `https://tag.observe.tw${path('話題1')}`, null],
      ['話題2', null, null],
      ['話題5', null, '🍜'],
    ]);
    expect(parseCloudVisuals({ visuals: [] }).size).toBe(0);
    expect(parseCloudVisuals(null).size).toBe(0);
  });

  test('malformed cloudItems are a failed read, not a shorter cloud', async () => {
    stubs.cloud = false;
    const pool = Array.from({ length: 61 }, (_, i) => topic(i + 1));
    for (const body of [
      { ...topics(pool.slice(0, 8)), cloudItems: pool },
      { ...topics(pool.slice(0, 8)), cloudItems: [topic(1, { posts: '3' })] },
      { ...topics(pool.slice(0, 8)), cloudItems: [topic(1, { blogs: -1 })] },
      { ...topics(pool.slice(0, 8)), cloudItems: [topic(1, { source: 'other' })] },
      { ...topics(pool.slice(0, 8)), cloudItems: 'pool' },
      { ...topics(pool.slice(0, 8)), cloudItems: pool.slice(0, 30), cloudTruncated: 'yes' },
      { ...topics(pool.slice(0, 8)), cloudItems: [topic(1, { titlePosts: -1 })] },
      // A sent background rule must be complete: a malformed one is a failed read, not a guessed description.
      {
        ...topics(pool.slice(0, 8)),
        matchingPolicy: {
          version: 'm',
          displayGate: {
            version: 'tag-broad-window-title-only-v1',
            upstream: 'tag.observe.tw/qualifyTagMedia/broad',
            minimumSources: 3,
            minimumTwiceSources: 2,
            minimumPeakPosts: 3,
            documentFrequencyRatio: 0.02,
            reason: 'high-window-document-frequency-title-only',
            effect: 'ranking-body-evidence-only;source-pool-and-historical-pages-retained',
            background: { maximumTitleShare: 3, minimumBaselinePosts: 3, minimumNativeBlogs: 2, reason: 'x' },
          },
        },
      },
    ]) {
      answer(TOPICS, body);
      await expect(HomeTopicCloud(), JSON.stringify(body).slice(0, 80)).rejects.toBeInstanceOf(PublicGatewayError);
    }
  });

  test('an empty ranking is said as empty (no words, no fallback); a failed read throws like the ranking', async () => {
    stubs.cloud = false;
    answer(TOPICS, topics([]));
    const $ = load(renderToString(await HomeTopicCloud()));
    expect($('[data-cloud-state="empty"]').text()).toBe('近 30 天尚無足夠的共同話題可以畫成文字雲。');
    expect($('a, svg').length).toBe(0);
    answer(TOPICS, { error: 'busy' }, 503);
    await expect(HomeTopicCloud()).rejects.toBeInstanceOf(PublicGatewayError);
    answer(TOPICS, EMPTY.topics);
    await expect(HomeTopicCloud()).rejects.toBeInstanceOf(PublicGatewayError);
    // Malformed counts, provenance or display gate: a failed read, not a fake empty cloud.
    for (const body of [
      topics([topic(1, { posts: -1 })]),
      topics([topic(1, { blogs: '2' })]),
      topics([topic(1, { source: 'other' })]),
      { ...topics([topic(1)]), matchingPolicy: { version: 'm', displayGate: { reason: 'x' } } },
    ]) {
      answer(TOPICS, body);
      await expect(HomeTopicCloud(), JSON.stringify(body)).rejects.toBeInstanceOf(PublicGatewayError);
    }
  });
});

describe('homepage: author hashtags under article titles', () => {
  const tag = (slug: string, label = slug) => ({ slug, label });
  test('a citation card and a recent blog row show at most three tags right under the title, with +N for the rest', async () => {
    answer(
      OVERVIEW,
      overview({
        mentions: mentions([mention({ postTags: [tag('css', 'CSS'), tag('html'), tag('台北美食')], postTagCount: 7 })]),
        recentBlogs: [
          {
            slug: 'c',
            name: '丙',
            latestPost: { id: 3, title: '丙的文章', url: 'https://c.example/p/3', publishedAt: PUBLISHED, tags: [tag('ai')], tagCount: 1 },
          },
        ],
      }),
    );
    const $ = await renderHome();
    const card = $('[data-mention-card="1:20875"]');
    const cardTags = card.find('h3').next('ul[aria-label="作者標籤"]');
    expect(
      cardTags
        .find('a')
        .map((_, a) => $(a).text())
        .get(),
    ).toEqual(['#CSS', '#html', '#台北美食']);
    expect(cardTags.find('a').first().attr('href')).toBe('/tags/?tag=css');
    expect(cardTags.find('a').eq(2).attr('href')).toBe(`/tags/?tag=${encodeURIComponent('台北美食')}`);
    expect(cardTags.children('li').last().text()).toBe('+4');
    const rowTags = $('aside[aria-label="部落格收錄概況"] li').find('ul[aria-label="作者標籤"]');
    expect(rowTags.prev().text()).toBe('丙的文章');
    expect(
      rowTags
        .find('a')
        .map((_, a) => $(a).text())
        .get(),
    ).toEqual(['#ai']);
    expect(rowTags.text()).not.toContain('+');
  });

  test('older answers without tags render no tag line at all', async () => {
    answer(OVERVIEW, overview({ mentions: mentions([mention()]) }));
    const $ = await renderHome();
    expect($('ul[aria-label="作者標籤"]').length).toBe(0);
  });
});
