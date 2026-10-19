/**
 * The profile's 引用與交流 and the site-wide relation map, rendered for real
 * (react-dom/server) and read back with cheerio. Next's hooks, links and images,
 * usePublicJson and the chart (BlogRelationGraph, echarts) are mocked. The
 * profile's server read keeps the real readPublic and public-contracts.ts over a
 * fake fetch, so every fixture below passes the same check a gateway 200 does;
 * nothing leaves the process. Every payload is a synthetic fixture (no real
 * blog, article or link). Server markup only: layout on phones, opening
 * <details> and the chart's own drawing are not exercised.
 */
import { type CheerioAPI, load } from 'cheerio';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import BlogRelations, { distinctEvidence, evidenceKey } from '@/components/BlogRelations';
import FooterMethod from '@/components/FooterMethod';
import RelationMapView from '@/components/public/RelationMap';
import { dayText, type RelationEvidence, type Relations, type SharedTagHit, type SharedTags, shareExplanation } from '@/lib/relations';

const gateway = vi.hoisted(() => ({
  // The gateway's HTTP answer for each attempt, read by the real readPublic.
  response: (_url: string): Response => new Response(null, { status: 404 }),
  // When set, publicJsonOrNull answers with it directly and nothing is checked: for errors readPublic never throws.
  answer: null as null | ((path: string) => Promise<unknown>),
  paths: [] as string[],
}));
const graph = vi.hoisted(() => ({ calls: [] as Array<{ nodes: unknown[]; edges: unknown[] }> }));
const nav = vi.hoisted(() => ({ pathname: '/blogs/a/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
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
vi.mock('@/lib/use-public-json', () => ({ usePublicJson: () => null, asIs: (raw: unknown) => raw }));
// public-api.ts without `server-only` and the gateway origin: the same readPublic call, a fake fetch, no retry wait.
vi.mock('@/lib/public-api', async () => {
  const { readPublic } = await import('@/lib/public-read');
  return {
    publicJsonOrNull: async (path: string) => {
      gateway.paths.push(path);
      if (gateway.answer) return gateway.answer(path);
      const result = await readPublic(
        'https://gateway.invalid',
        path,
        async (url) => gateway.response(url),
        () => Promise.resolve(),
      );
      return result.found ? result.body : null;
    },
  };
});
// The shared chart is the original component; here it only records what it was given.
vi.mock('@/components/BlogRelationGraph', async () => {
  const { createElement } = await import('react');
  return {
    default: (props: { nodes: unknown[]; edges: unknown[] }) => {
      graph.calls.push(props);
      return createElement('div', { 'data-graph': props.edges.length });
    },
  };
});

beforeEach(() => {
  gateway.response = () => new Response(null, { status: 404 });
  gateway.answer = null;
  gateway.paths = [];
  graph.calls = [];
  nav.pathname = '/blogs/a/';
});

/** The gateway answers `answer` as a 200 JSON body, or 404 for null; the contract then decides. */
const renderProfile = async (answer: unknown) => {
  gateway.response = () =>
    answer === null
      ? new Response(null, { status: 404 })
      : new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  return load(renderToString(await BlogRelations({ slug: 'a' })));
};
/** Text a reader sees before opening anything. */
function outsideText($: CheerioAPI) {
  const copy = load($.html());
  copy('details').remove();
  return copy('body').text();
}
const part = ($: CheerioAPI, id: string) => $(`section[aria-labelledby="${id}"]`);
function expectNoPrefetch($: CheerioAPI) {
  const internal = $('a[href^="/"]');
  expect(internal.length).toBeGreaterThan(0);
  internal.each((_, el) => {
    expect($(el).attr('data-prefetch'), $(el).attr('href')).toBe('false');
  });
}

/* Synthetic fixtures ------------------------------------------------------- */

const OLD = '2019-03-05T04:00:00.000Z';
const NEW = '2026-10-01T04:00:00.000Z';
const SEEN = '2026-10-02T04:00:00.000Z';
const coverage = {
  observedPosts: 12,
  totalPosts: 20,
  failedPosts: 1,
  unknownDatePosts: 2,
  unresolvedLinks: 3,
  truncatedPosts: 0,
  graphTruncated: false,
  aggregationTruncated: false,
  noBodyPosts: 4,
  nonBodyLinks: { sidebar: 1, blogroll: 5, comment: 2 },
};
const nodes = [
  { id: 1, slug: 'a', name: '測試站甲' },
  { id: 2, slug: 'b-blog', name: '測試站乙' },
  { id: 3, slug: 'c-blog', name: '測試站丙' },
];
const evidence = (patch: Partial<RelationEvidence>): RelationEvidence => ({
  postId: 101,
  postTitle: '甲的一篇文章',
  postUrl: 'https://a.example/p/101',
  targetUrl: 'https://b.example/x',
  anchor: '乙的文章 X',
  publishedAt: NEW,
  sourceBlogId: 1,
  targetBlogId: 2,
  location: 'body',
  context: '這裡提到乙的文章 X 作為延伸閱讀。',
  observedAt: SEEN,
  matchVersion: 'relations-v3',
  evidenceType: 'direct-link',
  contextSource: 'body',
  ...patch,
});
// One post (101) links to two URLs of 乙: two rows of evidence, still one article in the count.
const bodyEvidence = [
  evidence({}),
  evidence({ targetUrl: 'https://b.example/y', anchor: '乙的文章 Y', context: '另一段也連到乙的文章 Y。' }),
  // 丙 mentioned 甲 in 2019; 甲 mentioned 丙 in 2026: both ways, years apart.
  evidence({
    postId: 301,
    postTitle: '丙的舊文',
    postUrl: 'https://c.example/p/301',
    targetUrl: 'https://a.example/',
    anchor: '甲',
    publishedAt: OLD,
    sourceBlogId: 3,
    targetBlogId: 1,
    context: '推薦甲這個部落格。',
    matchVersion: 'relations-v2',
  }),
  evidence({
    postId: 102,
    postTitle: '甲的新文',
    postUrl: 'https://a.example/p/102',
    targetUrl: 'https://c.example/',
    anchor: '丙',
    targetBlogId: 3,
  }),
];
const nonBodyEvidence = [
  evidence({
    postId: 103,
    postTitle: '甲的側欄頁',
    location: 'blogroll',
    contextSource: 'blogroll',
    targetUrl: 'https://b.example/',
    anchor: '乙（友站）',
    context: '友站連結',
  }),
  evidence({
    postId: 104,
    postTitle: '甲的留言頁',
    location: 'comment',
    contextSource: 'comment',
    targetUrl: 'https://c.example/me',
    anchor: '丙的留言',
    context: null,
  }),
];
const hit = (patch: Partial<SharedTagHit> = {}): SharedTagHit => ({
  sourceArticleId: 11,
  sourceArticleUrl: 'https://a.example/p/11',
  sourceArticleTitle: '甲寫旅行',
  sourceArticlePublishedAt: NEW,
  targetArticleId: 22,
  targetArticleUrl: 'https://b.example/p/22',
  targetArticleTitle: '乙也寫旅行',
  targetArticlePublishedAt: OLD,
  targetBlogId: 2,
  targetBlogSlug: 'b-blog',
  targetBlogName: '測試站乙',
  tagId: 9,
  label: '旅行',
  sourceType: 'rss-category',
  lastSeenAt: SEEN,
  targetSourceType: 'manual',
  targetLastSeenAt: SEEN,
  tagSourceType: 'rss-category',
  tagLastSeenAt: SEEN,
  matchVersion: 'native-post-tags-v1',
  ...patch,
});
const INTERPRETATION = '共同標籤僅表示原始文章標籤相同，不代表引用、交流或正文相似；日期未知文章不列入期間。';
const sharedReady = (items: SharedTagHit[], patch: object = {}): SharedTags => ({
  status: 'ready',
  days: 90,
  items,
  truncated: false,
  sourceTagsTruncated: false,
  matchVersion: 'native-post-tags-v1',
  interpretation: INTERPRETATION,
  ...patch,
});
const profile = (patch: Partial<Relations> = {}): Relations => ({
  days: 90,
  generatedAt: SEEN,
  mostMentioned: [],
  mutual: [],
  coverage,
  blogId: 1,
  nodes,
  edges: [],
  outgoing: [
    { sourceBlogId: 1, targetBlogId: 2, count: 1, share: 0.5, firstMentionAt: NEW, lastMentionAt: NEW, mutual: false },
    { sourceBlogId: 1, targetBlogId: 3, count: 1, share: 0.5, firstMentionAt: NEW, lastMentionAt: NEW, mutual: true },
  ],
  incoming: [{ sourceBlogId: 3, targetBlogId: 1, count: 1, share: 1, firstMentionAt: OLD, lastMentionAt: OLD, mutual: true }],
  evidence: bodyEvidence,
  evidenceTruncated: false,
  nonBodyEvidence,
  nonBodyEvidenceTruncated: false,
  sharedTags: { status: 'not-enabled' },
  textSimilarity: { status: 'not-analysed' },
  profileTruncated: false,
  ...patch,
});

/* Profile -------------------------------------------------------------------- */

describe('profile 引用與交流', () => {
  test('parts with data in order, read from the no-store profile path; off or not-analysed parts are absent', async () => {
    const $ = await renderProfile(profile());
    expect(gateway.paths).toEqual(['/api/blogs/a/relations?days=90']);
    // Shared tags are not enabled and text similarity is not analysed in this fixture: their blocks are left out.
    expect(
      $('h3')
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(['正文直接引用', '非正文連結']);
    expect($('section#relations h2').text()).toBe('引用與交流近 90 天');
    const outside = outsideText($);
    for (const text of ['提到誰', '被誰提到', '測試站乙', '測試站丙']) expect(outside, text).toContain(text);
    // Evidence waits behind closed <details>; the method is not in the section at all (FooterMethod).
    expect($('details[open]').length).toBe(0);
    expect(outside).not.toContain('這裡提到乙的文章 X');
    expect($('body').text()).not.toContain('引用占比的分母');
    expect($('summary').text()).not.toContain('計算方式');
    expect($('#method').length).toBe(0);
    expect($('body').text()).not.toContain('這些關係怎麼算');
    for (const caveat of ['不代表', '不是引用', '不計入篇數', '未提供', '尚未']) expect($('body').text(), caveat).not.toContain(caveat);
    expect($('a[href="/relations/"]').text()).toBe('全站關係圖 →');
    expectNoPrefetch($);
  });

  test('body and non-body links stay apart; several URLs in one post are rows of evidence, not more articles', async () => {
    const $ = await renderProfile(profile());
    const body = part($, 'relations-body');
    const nonBody = part($, 'relations-non-body');
    // The count is the gateway's: 1 article to 乙, although post 101 links to two of its URLs.
    const toB = body.find('li').filter((_, el) => $(el).find('a').first().text().includes('測試站乙'));
    expect(toB.text()).toContain('1 篇');
    expect(toB.text()).not.toContain('2 篇');
    expect(body.find('summary').text()).toBe('核對正文連結（列出 4 筆連結）');
    expect(body.find('details a[href="https://b.example/x"]').length).toBe(1);
    expect(body.find('details a[href="https://b.example/y"]').length).toBe(1);
    expect(body.text()).not.toContain('友站連結');
    expect(body.text()).not.toContain('丙的留言');

    expect(nonBody.text()).toContain('Blogroll 5 條、側欄 1 條、留言 2 條');
    expect(nonBody.text()).not.toMatch(/\d+ 篇/);
    expect(nonBody.find('summary').text()).toBe('核對非正文連結（列出 2 筆連結）');
    expect(nonBody.text()).toContain('位置 Blogroll');
    expect(nonBody.text()).toContain('位置 留言');
    // A row without a context summary just has no summary line.
    expect(nonBody.text()).not.toContain('上下文摘要');
    expect(nonBody.find('details li').eq(1).text()).not.toContain('「');
    expect(nonBody.find('a[href="https://b.example/x"]').length).toBe(0);
  });

  test('each link keeps its article id, date, location, summary source and match version', async () => {
    const $ = await renderProfile(profile());
    const items = part($, 'relations-body').find('details li');
    const first = items.eq(0).text();
    expect(first).toContain('提到 測試站乙：');
    expect(first).toContain('「這裡提到乙的文章 X 作為延伸閱讀。」');
    expect(first).toContain(`文章 #101 · 發表 ${dayText(NEW)} · 位置 正文 · 摘要取自正文 · 比對版本 relations-v3 · 觀測 ${dayText(SEEN)}`);
    const old = items.eq(2).text();
    expect(old).toContain('測試站丙 提到本站：');
    expect(old).toContain(`文章 #301 · 發表 ${dayText(OLD)}`);
    expect(old).toContain('比對版本 relations-v2');
    expect(items.eq(0).find('a').first().attr('href')).toBe('https://a.example/p/101');
    expect(items.eq(0).find('a').first().attr('target')).toBe('_blank');
  });

  test('mentions years apart are "both ways" with their own dates, never a same-time exchange', async () => {
    const $ = await renderProfile(profile());
    const body = part($, 'relations-body');
    const mutual = body.find('small').filter((_, el) => $(el).text() === '對方也曾提及');
    expect(mutual.length).toBe(2);
    expect(mutual.first().attr('title')).toContain('不代表同時期互相回應');
    // The incoming edge from 丙 carries its 2019 date; the outgoing one its 2026 date.
    expect(body.text()).toContain(`最近 ${dayText(OLD)}`);
    expect(body.text()).toContain(`最近 ${dayText(NEW)}`);
    for (const word of ['互惠', '互相提及', '同時互動']) expect(outsideText($), word).not.toContain(word);
  });

  test('truncated evidence says only the latest 20 are listed', async () => {
    const $ = await renderProfile(profile({ evidenceTruncated: true, nonBodyEvidenceTruncated: true }));
    expect(part($, 'relations-body').find('summary').text()).toContain('僅最近 20 筆');
    expect(part($, 'relations-non-body').find('summary').text()).toContain('僅最近 20 筆');
  });

  test('empty lists leave their parts out; with nothing in any part the whole section is absent', async () => {
    // Body links empty, non-body counts still sent: only the non-body part, with its counts.
    let $ = await renderProfile(profile({ outgoing: [], incoming: [], evidence: [], nonBodyEvidence: [] }));
    expect(part($, 'relations-body').length).toBe(0);
    expect(part($, 'relations-non-body').text()).toContain('Blogroll 5 條');
    expect($('details').length).toBe(0);
    for (const sentence of ['尚未觀察到', '沒有可列出', '這段期間']) expect($('body').text(), sentence).not.toContain(sentence);
    // One direction empty: that list is left out, the other stays.
    $ = await renderProfile(profile({ incoming: [] }));
    expect(
      part($, 'relations-body')
        .find('h4')
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(['提到誰']);
    // Nothing anywhere (zero non-body counts too): no section, no heading, no "none".
    $ = await renderProfile(
      profile({
        outgoing: [],
        incoming: [],
        evidence: [],
        nonBodyEvidence: [],
        coverage: { ...coverage, nonBodyLinks: { sidebar: 0, blogroll: 0, comment: 0 } },
      }),
    );
    expect($('section#relations').length).toBe(0);
    expect($('body').text()).toBe('');
  });

  test('an older payload with missing keys: nothing renders 未提供 and no 0; missing blocks are absent', async () => {
    const old = profile({ coverage: { nonBodyLinks: {} } as unknown as Relations['coverage'] }) as Partial<Relations>;
    for (const key of [
      'evidence',
      'evidenceTruncated',
      'nonBodyEvidence',
      'nonBodyEvidenceTruncated',
      'sharedTags',
      'textSimilarity',
    ] as const)
      delete old[key];
    const $ = await renderProfile(old);
    const text = $('body').text();
    // The body edges are still there; the missing evidence lists, counts, tags and similarity are simply absent.
    expect(part($, 'relations-body').find('h4').length).toBe(2);
    expect(part($, 'relations-body').find('details').length).toBe(0);
    expect(part($, 'relations-non-body').length).toBe(0);
    expect(part($, 'relations-tags').length).toBe(0);
    expect(part($, 'relations-text').length).toBe(0);
    expect(text).not.toContain('未提供');
    expect(text).not.toMatch(/已分析|未知目標連結|Blogroll|側欄|留言/);
    expect(text).not.toMatch(/(^|\D)0 (篇|條)/);

    // Rows from a gateway that sent only the five original keys (no postId), through the real readPublic and
    // contract: a null anchor and date are accepted and said, not rejected.
    const bare = { postTitle: '舊文', postUrl: 'https://a.example/old', targetUrl: 'https://b.example/', anchor: null, publishedAt: null };
    const $old = await renderProfile({ ...old, evidence: [bare], nonBodyEvidence: [{ ...bare, anchor: '' }] });
    expect($old('[role="alert"]').length).toBe(0);
    for (const id of ['relations-body', 'relations-non-body']) {
      const row = part($old, id).find('details li').text();
      expect(row, id).toContain('舊文');
      expect(row, id).toContain('原始連結');
      expect(row, id).not.toContain('上下文摘要');
      // The detail line keeps only what was sent: nothing here, so no 未提供, no 日期未知 and no 0.
      expect(row, id).not.toMatch(/未提供|日期未知|比對版本|觀測/);
      expect(row, id).not.toContain('#');
      expect(row, id).not.toContain('null');
    }
  });

  test("row keys are each row's whole identity: no position, the same under any order, apart when anchor or context differs", () => {
    const first = evidence({});
    const otherAnchor = evidence({ anchor: '同一網址的另一個錨文字' });
    const otherContext = evidence({ context: '同一網址出現在另一段。' });
    const keys = [first, otherAnchor, otherContext].map(evidenceKey);
    expect(new Set(keys).size).toBe(3);
    // A copy built separately, with the newer keys left out instead of null, is the same row.
    expect(evidenceKey(structuredClone(first))).toBe(keys[0]);
    expect(evidenceKey({ ...first, context: undefined })).toBe(evidenceKey({ ...first, context: null }));
    expect(distinctEvidence([otherContext, first, otherAnchor]).map(([key]) => key)).toEqual([keys[2], keys[0], keys[1]]);
    expect(distinctEvidence([first, structuredClone(first), otherAnchor]).map(([key]) => key)).toEqual([keys[0], keys[1]]);
  });

  test('an identical row sent twice is listed once and adds nothing; different anchors and contexts stay separate', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const rows = [
        evidence({}),
        evidence({}),
        evidence({ anchor: '同一網址的另一個錨文字' }),
        evidence({ context: '同一網址出現在另一段。' }),
      ];
      for (const order of [rows, [...rows].reverse()]) {
        const $ = await renderProfile(profile({ evidence: order }));
        const body = part($, 'relations-body');
        expect(body.find('summary').text()).toBe('核對正文連結（列出 3 筆連結）');
        expect(body.find('details li').length).toBe(3);
        expect(body.text()).toContain('「這裡提到乙的文章 X 作為延伸閱讀。」');
        expect(body.text()).toContain('同一網址的另一個錨文字');
        expect(body.text()).toContain('「同一網址出現在另一段。」');
        // The article count is still the gateway's own.
        const toB = body.find('li').filter((_, el) => $(el).find('a').first().text().includes('測試站乙'));
        expect(toB.text()).toContain('1 篇');
      }
      expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    } finally {
      error.mockRestore();
    }
  });

  test('a link that is not http(s) is shown as text, not followed', async () => {
    const $ = await renderProfile(profile({ evidence: [evidence({ postUrl: 'javascript:alert(1)' })] }));
    const row = part($, 'relations-body').find('details li');
    expect(row.find('a[href^="javascript"]').length).toBe(0);
    expect(row.text()).toContain('甲的一篇文章');
  });

  test('an entity-encoded article title reads as text once; literal markup stays escaped text', async () => {
    const $ = await renderProfile(profile({ evidence: [evidence({ postTitle: 'Chemistry &#038; Sex &amp;#038; <script>x</script>' })] }));
    const row = part($, 'relations-body').find('details li');
    expect(row.find('a').first().text()).toBe('Chemistry & Sex &#038; <script>x</script>');
    expect(row.find('script').length).toBe(0);
    expect($.html()).toContain('&lt;script&gt;x&lt;/script&gt;');
  });
});

describe('shared tags (not citation)', () => {
  test('ready: the tag in brand green, both original articles linked out, ids/sources/version to check, no caveat in the block', async () => {
    const items = [
      hit(),
      hit({
        targetArticleId: 23,
        targetArticleUrl: 'https://c.example/p/23',
        targetArticleTitle: '丙的旅行',
        targetBlogId: 3,
        targetBlogSlug: 'c-blog',
        targetBlogName: '測試站丙',
      }),
      hit({ tagId: 10, label: '咖啡', targetArticleId: 24 }),
    ];
    const $ = await renderProfile(profile({ sharedTags: sharedReady(items) }));
    const tags = part($, 'relations-tags');
    expect(tags.find('h3').text()).toBe('共同標籤');
    // The gateway's interpretation is a caveat: the footer's 引用與交流 says it once, not the block.
    expect(tags.text()).not.toContain(INTERPRETATION);
    expect(tags.text()).not.toContain('不代表');
    const chips = tags.find('ul[aria-label="共同標籤"] > li');
    expect(chips.map((_, el) => $(el).text()).get()).toEqual(['#旅行2 組文章', '#咖啡1 組文章']);
    expect(chips.first().find('span').first().hasClass('text-brand-700')).toBe(true);
    expect(tags.find('summary').text()).toBe('核對共同標籤的文章（3 組）');
    const row = tags.find('details li li').first();
    expect(
      row
        .find('a')
        .map((_, el) => $(el).attr('href'))
        .get(),
    ).toEqual(['https://a.example/p/11', 'https://b.example/p/22']);
    expect(row.text()).toContain(`甲寫旅行${dayText(NEW)}`);
    expect(row.text()).toContain(`測試站乙：乙也寫旅行${dayText(OLD)}`);
    expect(row.text()).toContain('文章 #11／#22 · 標籤 #9（rss-category');
    expect(row.text()).toContain('標籤來源 rss-category／manual');
    expect(row.text()).toContain('比對版本 native-post-tags-v1');
    // No blog page is guessed from the gateway slug, and nothing here is counted as a mention.
    expect(tags.find('a[href^="/"]').length).toBe(0);
    expect(tags.text()).not.toContain('篇');
    expect(part($, 'relations-body').text()).not.toContain('旅行');
  });

  test('ready with truncation says which limit was reached', async () => {
    const $ = await renderProfile(profile({ sharedTags: sharedReady([hit()], { truncated: true, sourceTagsTruncated: true }) }));
    const text = part($, 'relations-tags').text();
    expect(text).toContain('只比對了本站部分近期標籤。');
    expect(text).toContain('只列出部分文章組合。');
  });

  test('ready and empty: the shared-tags block is absent, never "none found"', async () => {
    const $ = await renderProfile(profile({ sharedTags: sharedReady([]) }));
    expect(part($, 'relations-tags').length).toBe(0);
    expect($('body').text()).not.toContain('沒有找到');
    expect($('body').text()).not.toContain(INTERPRETATION);
    // The rest of the section is untouched.
    expect(part($, 'relations-body').length).toBe(1);
  });

  test('unavailable: the shared-tags block is absent, never "none"', async () => {
    const $ = await renderProfile(profile({ sharedTags: { status: 'unavailable', matchVersion: 'native-post-tags-v1' } }));
    expect(part($, 'relations-tags').length).toBe(0);
    expect($('body').text()).not.toContain('共同標籤');
    expect($('body').text()).not.toContain('沒有找到');
    expect($('[role="status"]').length).toBe(0);
  });

  test('not enabled (the default): the shared-tags block is absent, not a claim that there are none', async () => {
    const $ = await renderProfile(profile());
    expect(part($, 'relations-tags').length).toBe(0);
    expect($('body').text()).not.toContain('共同標籤');
    expect($('body').text()).not.toContain('沒有找到');
    expect($('ul[aria-label="共同標籤"]').length).toBe(0);
  });
});

describe('text similarity', () => {
  test('not analysed: the text-similarity block is absent, no percentage and no articles', async () => {
    const $ = await renderProfile(profile());
    expect(part($, 'relations-text').length).toBe(0);
    expect($('body').text()).not.toContain('文字相似');
    expect($('body').text()).not.toContain('尚未分析');
    expect($('body').text()).not.toContain('字面重疊');
  });

  test('a status this page does not know is not shown as analysed: the block is absent', async () => {
    for (const value of [{ status: 'ready' }, { status: 'complete', items: [] }, { status: 'ready', items: {} }]) {
      const $ = await renderProfile(profile({ textSimilarity: value }));
      expect(part($, 'relations-text').length, JSON.stringify(value)).toBe(0);
      expect($('body').text()).not.toContain('字面重疊');
      expect($('body').text()).not.toContain('未提供');
    }
  });

  // Synthetic pair (app/src/relations/text-similarity-reader.ts item shape); no real article.
  const SELECTION = {
    selectionOrigin: 'observed-outgoing-body-links',
    selectionLimit: 3,
    selectedPairs: 2,
    selectionTruncated: true,
    exhaustive: false,
  };
  const side = (articleId: number, patch: object = {}) => ({
    articleId,
    url: `https://${articleId === 101 ? 'a' : 'b'}.example/p/${articleId}`,
    title: articleId === 101 ? '甲的夏日湯品' : '乙的絲瓜筆記',
    publishedAt: articleId === 101 ? NEW : OLD,
    observedAt: SEEN,
    contextSource: 'post-summary',
    previewSource: 'post-summary',
    comparedContextSource: 'body-prefix',
    excerpt: articleId === 101 ? '甲的公開摘要。' : '乙的公開摘要。',
    prefixCodepoints: 4096,
    uniqueGrams: 900,
    truncated: articleId === 101,
    ...patch,
  });
  const readyItem = (patch: object = {}) => ({
    sourceArticleId: 101,
    targetArticleId: 202,
    status: 'ready',
    lexicalSimilarity: 0.1234,
    matchVersion: 'body-prefix-dice-trigram-v1',
    method: 'set-sorensen-dice-trigram',
    scope: 'normalized-body-prefix-only',
    exhaustive: false,
    source: side(101),
    target: side(202),
    observedAt: SEEN,
    analysedAt: SEEN,
    ...patch,
  });
  const ready = (items: unknown[], patch: object = {}) => ({
    status: 'ready',
    matchVersion: 'body-prefix-dice-trigram-v1',
    scope: 'explicit-pairs-only',
    notCitation: true,
    notSemanticSimilarity: true,
    items,
    // SELECTION carries exhaustive: false, as the profile's coverage does.
    ...SELECTION,
    ...patch,
  });
  const renderText = async (textSimilarity: unknown) => {
    const $ = await renderProfile(profile({ textSimilarity: textSimilarity as Relations['textSimilarity'] }));
    return { $, block: part($, 'relations-text') };
  };

  test('not enabled (the default flag): the text-similarity block is absent, not a claim that nothing is similar', async () => {
    const { $, block } = await renderText({ status: 'not-enabled' });
    expect(block.length).toBe(0);
    expect($('body').text()).not.toContain('文字相似');
    expect($('ul[aria-label="文字相似配對"], [data-method="text-similarity"]').length).toBe(0);
  });

  test('no selected pairs: the block is absent, not "no similar articles", and no selection count is shown', async () => {
    const { $, block } = await renderText({ status: 'no-selected-pairs', ...SELECTION, selectedPairs: 0, selectionTruncated: false });
    expect(block.length).toBe(0);
    expect($('[data-method="text-similarity"]').length).toBe(0);
    expect($('body').text()).not.toContain('字面重疊');
    expect($('body').text()).not.toContain('沒有');
  });

  test('ready with no rows: the block is absent, never an empty success', async () => {
    const { $, block } = await renderText(ready([]));
    expect(block.length).toBe(0);
    expect($('body').text()).not.toContain('沒有可列出的配對');
  });

  test('unavailable: the block is absent; no score, no preview, no 0%', async () => {
    const { $, block } = await renderText({ status: 'unavailable', ...SELECTION });
    expect(block.length).toBe(0);
    expect($('[role="status"]').length).toBe(0);
    expect($('body').text()).not.toMatch(/字面重疊|摘要：/);
    expect($('body').text()).not.toContain('文字相似');
  });

  test('ready: both public articles linked out with both dates, ids, version, the summary preview and a bounded score', async () => {
    const { $, block } = await renderText(ready([readyItem()]));
    const row = block.find('ul[aria-label="文字相似配對"] > li');
    expect(row.length).toBe(1);
    expect(
      row
        .find('a')
        .map((_, el) => $(el).attr('href'))
        .get(),
    ).toEqual(['https://a.example/p/101', 'https://b.example/p/202']);
    row.find('a').each((_, el) => {
      expect($(el).attr('target')).toBe('_blank');
      expect($(el).attr('rel')).toBe('noopener noreferrer');
    });
    const text = row.text();
    expect(text).toContain(`發表 ${dayText(NEW)}`);
    expect(text).toContain(`發表 ${dayText(OLD)}`);
    expect(text).toContain('摘要：「甲的公開摘要。」');
    expect(text).toContain('字面重疊 12.3%');
    // What the score does not prove is in the footer's 引用與交流, not on the row.
    expect(text).not.toContain('不是引用');
    expect(text).not.toContain('預覽取自公開摘要');
    expect(text).toContain(`文章 #101／#202 · 觀測 ${dayText(SEEN)}／${dayText(SEEN)} · 比對字數 4,096／4,096（只比前段）`);
    expect(text).toContain('比對版本 body-prefix-dice-trigram-v1');
    expect(
      row
        .find('p')
        .filter((_, el) => $(el).text().startsWith('字面重疊'))
        .hasClass('text-brand-700'),
    ).toBe(true);
    // The selection count stays under the results, as visible text, without the method sentence.
    const selection = block.find('[data-method="text-similarity"]');
    expect(selection.is('details')).toBe(false);
    expect(selection.text()).toBe('選了 2 組（上限 3 組），還有符合條件的連結沒有選入');
    expect(selection.text()).not.toContain('全面比對');
    // Text similarity is its own kind: nothing joins the body citations or shared tags.
    expect(part($, 'relations-body').text()).not.toContain('字面重疊');
    expect(part($, 'relations-tags').text()).not.toContain('字面重疊');
    expect(block.find('a[href^="/"]').length).toBe(0);
  });

  test('ready with partial rows: insufficient text and unavailable pairs show no score and no private preview', async () => {
    const { block } = await renderText(
      ready([
        readyItem(),
        readyItem({
          targetArticleId: 203,
          status: 'insufficient-text',
          lexicalSimilarity: null,
          target: side(203, { prefixCodepoints: 20 }),
        }),
        { sourceArticleId: 101, targetArticleId: 204, status: 'unavailable', lexicalSimilarity: null, reason: 'stale-or-unavailable' },
      ]),
    );
    const rows = block.find('ul[aria-label="文字相似配對"] > li');
    expect(rows.length).toBe(3);
    expect(rows.eq(1).text()).toContain('正文前段太短，無法比對。');
    expect(rows.eq(1).text()).not.toContain('%');
    expect(rows.eq(2).text()).toBe('文章 #101／#204：無法比對（文章已變更或不再公開）');
    expect(rows.eq(2).text()).not.toContain('%');
    expect(rows.eq(2).find('a').length).toBe(0);
  });

  test('malformed rows: no score without both public sides, unsafe links stay text, at most three pairs, tokens never rendered', async () => {
    const PRIVATE = {
      bodyBytes: 'PRIVATE_BODY_PREFIX',
      bodyTextHash: 'e'.repeat(64),
      token: 'PRIVATE_TOKEN',
      sourceUrl: 'https://a.example/private',
    };
    const { $, block } = await renderText(
      ready([
        readyItem({ ...PRIVATE, source: { ...side(101), ...PRIVATE, url: 'javascript:alert(1)', excerpt: { html: '<b>x</b>' } } }),
        readyItem({ targetArticleId: 205, lexicalSimilarity: 1.5 }),
        readyItem({ targetArticleId: 206, target: side(999) }),
        readyItem({ targetArticleId: 207, source: { ...side(101), contextSource: 'body-prefix' } }),
        readyItem({ targetArticleId: 208 }),
      ]),
    );
    const rows = block.find('ul[aria-label="文字相似配對"] > li');
    expect(rows.length).toBe(3);
    expect(rows.eq(0).find('a[href^="javascript"]').length).toBe(0);
    // An excerpt that is not text is left out: only the target's 摘要 line, no markup, no 未提供.
    expect(
      rows
        .eq(0)
        .text()
        .match(/摘要：/g),
    ).toHaveLength(1);
    expect(rows.eq(0).text()).toContain('摘要：「乙的公開摘要。」');
    expect(rows.eq(0).text()).not.toContain('甲的公開摘要');
    expect(rows.eq(0).text()).not.toContain('未提供');
    expect(rows.eq(0).find('b').length).toBe(0);
    expect(rows.eq(0).text()).toContain('字面重疊 12.3%');
    // Out of range score and a side that is not the asked article: unavailable, never a number.
    for (const index of [1, 2]) {
      expect(rows.eq(index).text()).toContain('無法比對');
      expect(rows.eq(index).text()).not.toMatch(/%/);
    }
    expect(block.text()).not.toContain('#101／#208');
    const html = $.html();
    for (const secret of ['PRIVATE_BODY_PREFIX', 'e'.repeat(64), 'PRIVATE_TOKEN', 'a.example/private'])
      expect(html, secret).not.toContain(secret);
  });

  test('a compared article URL with credentials is never a link; its title stays as text, a query URL stays exact', async () => {
    const QUERY_URL = 'https://b.example/post.php?id=202&lang=zh-TW';
    const { $, block } = await renderText(
      ready([
        readyItem({
          source: side(101, { url: 'https://user:PRIVATE_PASS@a.example/p/101' }),
          target: side(202, { url: 'https://PRIVATE_USER@b.example/p/202' }),
        }),
        readyItem({ targetArticleId: 203, target: side(203, { url: QUERY_URL, title: '乙的查詢網址文章' }) }),
        readyItem({ targetArticleId: 204, target: side(204, { url: 'https://:PRIVATE_ONLY_PASS@b.example/p/204', title: '乙的另一篇' }) }),
      ]),
    );
    const rows = block.find('ul[aria-label="文字相似配對"] > li');
    expect(rows.length).toBe(3);
    // Both sides of the first pair: no anchor, the titles as plain text, the score still shown.
    expect(rows.eq(0).find('a').length).toBe(0);
    expect(rows.eq(0).text()).toContain('甲的夏日湯品');
    expect(rows.eq(0).text()).toContain('乙的絲瓜筆記');
    expect(rows.eq(0).text()).toContain('字面重疊 12.3%');
    // A legitimate query is part of the article address and is kept exactly.
    const query = rows
      .eq(1)
      .find('a')
      .filter((_, el) => $(el).text() === '乙的查詢網址文章');
    expect(query.attr('href')).toBe(QUERY_URL);
    expect(rows.eq(1).find('a').first().attr('href')).toBe('https://a.example/p/101');
    // Password only: still not a link.
    expect(
      rows
        .eq(2)
        .find('a')
        .filter((_, el) => $(el).text() === '乙的另一篇').length,
    ).toBe(0);
    expect(rows.eq(2).text()).toContain('乙的另一篇');
    const html = $.html();
    for (const secret of ['PRIVATE_PASS', 'PRIVATE_USER', 'PRIVATE_ONLY_PASS', 'user:', '@a.example', '@b.example'])
      expect(html, secret).not.toContain(secret);
  });

  test('an older gateway ready answer without selection keys never shows a made-up count', async () => {
    const { block } = await renderText({ status: 'ready', items: [readyItem()] });
    // No counts sent: the selection line is left out rather than saying 未提供 or a number.
    expect(block.find('[data-method="text-similarity"]').length).toBe(0);
    expect(block.text()).not.toContain('未提供');
  });
});

describe('optional section', () => {
  test("a gateway failure stays in the section with a retry; the profile's other parts are not touched", async () => {
    // 503 twice: readPublic retries once, then throws its PublicGatewayError.
    gateway.response = () => new Response('busy', { status: 503 });
    const $ = load(renderToString(await BlogRelations({ slug: 'a' })));
    expect($('section#relations h2').text()).toBe('引用與交流');
    expect($('[role="alert"]').text()).toBe('關係資料暫時無法讀取，請稍後再試。重新載入');
    expect($('[role="alert"]').text()).not.toContain('不代表');
    expect($('button').text()).toBe('重新載入');
    expect($('h3').length).toBe(0);
    expect($('body').text()).not.toMatch(/\d+ 篇/);
  });

  test("anything that is not the gateway's failure is not swallowed", async () => {
    gateway.answer = () => Promise.reject(new Error('bug'));
    await expect(BlogRelations({ slug: 'a' })).rejects.toThrow('bug');
  });

  test("the gateway's 404: the section renders nothing, not an empty relation list", async () => {
    const $ = await renderProfile(null);
    expect($('section#relations').length).toBe(0);
    expect($('body').text()).toBe('');
  });
});

describe('a malformed 200 (real readPublic and public-contracts.ts)', () => {
  const row = evidence({});
  const { postUrl: _postUrl, ...rowWithoutUrl } = row;
  const { publishedAt: _publishedAt, ...rowWithoutDate } = row;
  const malformed: Array<[string, Record<string, unknown>]> = [
    ['evidence context is an object', { evidence: [{ ...row, context: {} }] }],
    ['evidence location is an array', { evidence: [{ ...row, location: ['body'] }] }],
    ['evidence matchVersion is an object', { evidence: [{ ...row, matchVersion: { v: 3 } }] }],
    ['evidence row without postUrl', { evidence: [rowWithoutUrl] }],
    // publishedAt is one of the five original keys: null is allowed, absent is not.
    ['evidence row without publishedAt', { evidence: [rowWithoutDate] }],
    ['evidence anchor is a number', { evidence: [{ ...row, anchor: 7 }] }],
    // postId may be absent (older rows), but when sent it is a count.
    ['evidence postId as text', { evidence: [{ ...row, postId: '101' }] }],
    ['evidence postId is null', { evidence: [{ ...row, postId: null }] }],
    ['evidence postId is negative', { evidence: [{ ...row, postId: -1 }] }],
    ['non-body observedAt is an array', { nonBodyEvidence: [{ ...nonBodyEvidence[0], observedAt: [SEEN] }] }],
    ['non-body contextSource is an object', { nonBodyEvidence: [{ ...nonBodyEvidence[0], contextSource: {} }] }],
    ['shared-tag tagSourceType is an object', { sharedTags: sharedReady([{ ...hit(), tagSourceType: {} } as unknown as SharedTagHit]) }],
    ['shared-tag sourceType is an array', { sharedTags: sharedReady([{ ...hit(), sourceType: ['rss'] } as unknown as SharedTagHit]) }],
  ];
  for (const [name, patch] of malformed)
    test(`${name}: the section says unavailable with a retry instead of crashing the profile`, async () => {
      const $ = await renderProfile({ ...profile(), ...patch });
      expect(gateway.paths).toEqual(['/api/blogs/a/relations?days=90']);
      expect($('section#relations h2').text()).toBe('引用與交流');
      expect($('[role="alert"]').text()).toContain('關係資料暫時無法讀取');
      expect($('button').text()).toBe('重新載入');
      expect($('h3').length).toBe(0);
    });

  test('the control: the same row handed to the view without the contract crashes React outside the section', async () => {
    gateway.answer = () => Promise.resolve({ ...profile(), evidence: [{ ...row, context: {} }] });
    const element = await BlogRelations({ slug: 'a' });
    expect(() => renderToString(element)).toThrow(/not valid as a React child/);
  });

  test('older rows and hits without the newer keys pass the contract and leave those parts out', async () => {
    const oldHit = hit() as Partial<SharedTagHit>;
    for (const key of [
      'targetBlogSlug',
      'sourceType',
      'lastSeenAt',
      'targetSourceType',
      'targetLastSeenAt',
      'tagSourceType',
      'tagLastSeenAt',
    ] as const)
      delete oldHit[key];
    const $ = await renderProfile(profile({ sharedTags: sharedReady([oldHit as SharedTagHit]) }));
    expect($('[role="alert"]').length).toBe(0);
    const text = part($, 'relations-tags').find('details li li').text();
    expect(text).toContain('文章 #11／#22 · 標籤 #9 · 比對版本 native-post-tags-v1');
    expect(text).not.toMatch(/未提供|標籤來源|最後看到/);
  });
});

/* The page's one method block -------------------------------------------------- */

describe("F3's method lives in the footer's one 本頁的資料來源與計算方式", () => {
  const SUMMARY = '本頁的資料來源與計算方式';
  const methodBlocks = ($: CheerioAPI) => $('details').filter((_, el) => $(el).children('summary').text().includes(SUMMARY));
  // app/layout.tsx: the profile's content, then SiteFooter, whose only method piece is <FooterMethod />.
  const renderPage = async (answer: unknown) => {
    gateway.response = () => new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
    const relations = await BlogRelations({ slug: 'a' });
    return load(
      renderToString(
        <>
          <main>
            <h1>測試站甲</h1>
            {relations}
          </main>
          <footer>
            <FooterMethod />
          </footer>
        </>,
      ),
    );
  };
  const footerOnly = (pathname: string, page = false) => {
    nav.pathname = pathname;
    return load(renderToString(<FooterMethod page={page} />));
  };

  test('a profile has exactly one method block, closed, after the content; the caveats the section dropped are in it', async () => {
    const $ = await renderPage(profile());
    expect(methodBlocks($).length).toBe(1);
    expect($('summary').filter((_, el) => $(el).text().includes('計算方式')).length).toBe(1);
    expect($('details[open]').length).toBe(0);
    expect($('#method').length).toBe(1);
    expect(methodBlocks($).find('#method').length).toBe(1);
    expect($('main #method').length).toBe(0);
    // The section's own parts come first and stay free of method text; the link points at the one block.
    const main = $('main');
    expect(main.find('section#relations h3').first().text()).toBe('正文直接引用');
    expect(main.text()).not.toContain('引用占比的分母');
    expect(main.text()).not.toContain('非正文連結來自 Blogroll、側欄與留言');
    expect(main.text()).not.toContain('不代表');
    const html = $.html();
    expect(html.indexOf('id="relations"')).toBeLessThan(html.indexOf('id="method"'));
    // The F3 paragraphs are in the footer block, under their own heading, after 資料來源.
    expect(
      $('#method h3')
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(['資料來源', '部落格頁', '引用與交流']);
    const method = $('#method').text();
    expect(method).toContain(shareExplanation);
    for (const text of [
      '同一篇對同一站重複連結只算 1 篇',
      '不代表同時互動',
      '非正文連結來自 Blogroll、側欄與留言，與正文分開保存',
      '共同標籤比的是發布者自己替文章加的原始標籤',
      '標籤相同不代表引用、交流或內容相似',
      '不是引用、語意相似、抄襲或交流',
      '不是全面比對，沒有列出的文章不代表不相近',
      '預覽取自公開摘要，比對用的正文不公開',
      '共同標籤與文字相似在比對未開啟、尚未分析、暫時無法讀取或沒有結果時都不顯示',
      '同一篇文章連到多個網址會列成多筆，篇數以統計為準',
      '沒有列出引用不代表沒有交流',
    ])
      expect(method, text).toContain(text);
  });

  test('the F3 paragraphs are on one profile and the site-wide map only', () => {
    // /relations/ renders the block itself (OWN_METHOD), with this period's coverage.
    for (const pathname of ['/blogs/a/', '/blogs/b-blog', '/relations/', '/relations']) {
      const $ = footerOnly(pathname, pathname.startsWith('/relations'));
      expect(methodBlocks($).length, pathname).toBe(1);
      expect($('#method h3').last().text(), pathname).toBe('引用與交流');
      expect($('#method').text(), pathname).toContain(shareExplanation);
    }
    for (const [pathname, own] of [
      ['/blogs/', '部落格與文章數'],
      ['/blogs', null],
      ['/blogs/a/feed/', null],
      ['/tags/x/', null],
      ['/relations/extra/', null],
    ] as const) {
      const $ = footerOnly(pathname, pathname.startsWith('/relations'));
      expect(methodBlocks($).length, pathname).toBe(1);
      expect(
        $('#method h3')
          .map((_, el) => $(el).text())
          .get(),
        pathname,
      ).toEqual(own ? ['資料來源', own] : ['資料來源']);
      expect($('#method').text(), pathname).not.toContain('引用占比');
    }
    // The homepage carries its own citation-row method instead, still without the F3 share paragraphs.
    const $ = footerOnly('/');
    expect(methodBlocks($).length).toBe(1);
    expect(
      $('#method h3')
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(['資料來源', '首頁的正文引用與話題']);
    expect($('#method').text()).not.toContain('引用占比');
  });

  test('/tech/ and topic pages keep their own block: none from the footer, and no F3 paragraphs in theirs', () => {
    for (const pathname of ['/tech/', '/topics/', '/topics/rss%3A1/', '/traffic/', '/articles/']) {
      expect(footerOnly(pathname)('details').length, pathname).toBe(0);
      const $ = footerOnly(pathname, true);
      expect(methodBlocks($).length, pathname).toBe(1);
      expect($('#method').text(), pathname).not.toContain('引用占比');
    }
  });
});

/* Site-wide map ---------------------------------------------------------------- */

describe('site-wide relation map', () => {
  const map = (patch: Partial<Relations> = {}): Relations => ({
    days: 90,
    generatedAt: SEEN,
    nodes,
    edges: [
      { sourceBlogId: 1, targetBlogId: 2, count: 1, share: 0.5, firstMentionAt: NEW, lastMentionAt: NEW, mutual: false },
      { sourceBlogId: 3, targetBlogId: 1, count: 1, share: 1, firstMentionAt: OLD, lastMentionAt: OLD, mutual: true },
    ],
    mostMentioned: [{ blogId: 1, mentions: 1, incomingBlogs: 1 }],
    mutual: [{ sourceBlogId: 1, targetBlogId: 3, forwardCount: 1, reverseCount: 1 }],
    coverage,
    ...patch,
  });

  test('the shared chart draws the body edges only; the lines are explained as direct body links', () => {
    const data = map();
    const $ = load(renderToString(<RelationMapView days="90" load={{ status: 'ready', data }} />));
    expect(graph.calls.length).toBe(1);
    expect(graph.calls[0].edges).toBe(data.edges);
    expect($('[data-graph]').attr('data-graph')).toBe('2');
    const text = $('body').text();
    expect(text).toContain('每條線都是正文裡的直接連結');
    expect(text).toContain('共同標籤與文字相似也不畫成線');
    expect(text).toContain('不代表同時期互相回應');
    expect(text).toContain('另記 blogroll 5、側欄 1、留言 2 條，與正文分開');
  });

  test('missing coverage counts are 未提供, never 0', () => {
    const data = map({ coverage: { nonBodyLinks: {} } as unknown as Relations['coverage'] });
    const $ = load(renderToString(<RelationMapView days="90" load={{ status: 'ready', data }} />));
    const footer = $('#method').text();
    expect(footer).toContain('未辨識正文 未提供 篇。另記 blogroll 未提供、側欄 未提供、留言 未提供 條');
    expect(footer).toContain('已分析 未提供／未提供 篇');
    expect(footer).not.toMatch(/(^|\D)0 (篇|條)/);
  });
});
