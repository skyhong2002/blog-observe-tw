/**
 * The homepage's 最近共同話題 list, rendered for real (react-dom/server) and read
 * back with cheerio. Its read keeps the real readPublic and public-contracts.ts
 * over a fake fetch, so every fixture passes the same check a gateway 200 does;
 * nothing leaves the process. Next's links are mocked and the CSS module answers
 * its own class names. Payloads are synthetic. Server markup only: streaming
 * order in the browser, the error boundary's own page and the skeleton's look
 * are not exercised here.
 */
import { load } from 'cheerio';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import HomeTopicRanking, { HomeTopicsPending } from '@/app/_home/HomeTopics';
import { HomeTopicRankingFromBrowser } from '@/app/_home/HomeTopicsFromBrowser';
import { PublicGatewayError } from '@/lib/public-read';
import { EMPTY } from './public-payloads.ts';

const gateway = vi.hoisted(() => ({
  response: (_url: string): Response => new Response(null, { status: 404 }),
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
vi.mock('@/app/_home/home.module.css', () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));
// public-api.ts without `server-only` and the gateway origin: the same publicJson rules over a fake fetch, no retry wait.
vi.mock('@/lib/public-api', async () => {
  const { PublicGatewayError, readPublic } = await import('@/lib/public-read');
  return {
    publicJson: async (path: string) => {
      gateway.paths.push(path);
      const result = await readPublic(
        'https://gateway.invalid',
        path,
        async (url) => gateway.response(url),
        () => Promise.resolve(),
      );
      if (!result.found) throw new PublicGatewayError(path, 404);
      return result.body;
    },
  };
});

beforeEach(() => {
  gateway.response = () => new Response(null, { status: 404 });
  gateway.paths = [];
});

const answer = (body: unknown, status = 200) => {
  gateway.response = () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
};
const render = async () => load(renderToString(await HomeTopicRanking()));
const topic = (i: number, patch: object = {}) => ({
  id: `rss:${i}`,
  label: `話題${i}`,
  source: 'tag-vocabulary',
  score: 1,
  posts: i + 2,
  blogs: 2,
  ...patch,
});
const home = (items: object[], patch: object = {}) => ({ ...(EMPTY.homeTopics as object), items, ...patch });

describe('homepage topic list (view=home)', () => {
  test('reads only the compact 30-day ranking and lists it as before: rank, label, counts, source, no prefetch', async () => {
    answer(home([topic(1, { canonicalPath: '/topics/%E8%A9%B1%E9%A1%8C1/' }), topic(2, { source: 'rss-category' })]));
    const $ = await render();
    expect(gateway.paths).toEqual(['/api/topics?days=30&view=home']);
    const rows = $('ol.ranking > li');
    expect(rows.length).toBe(2);
    expect(rows.eq(0).find('.rank').text()).toBe('01');
    expect(rows.eq(0).find('strong').text()).toBe('話題1');
    expect(rows.eq(0).find('small').text()).toBe('2 個部落格 · 3 篇');
    expect(rows.eq(1).find('small').text()).toBe('2 個部落格 · 4 篇 · RSS');
    expect(rows.eq(0).find('a').attr('href')).toBe('/topics/%E8%A9%B1%E9%A1%8C1/');
    $('a').each((_, el) => {
      expect($(el).attr('data-prefetch')).toBe('false');
      expect($(el).attr('data-analytics')).toBeUndefined();
    });
  });

  test('an empty ranking leaves the list blank; nothing is counted', async () => {
    answer(home([]));
    const $ = await render();
    expect($('p.notice').length).toBe(0);
    expect($('ol').length).toBe(0);
    expect($('body').text()).not.toMatch(/\d+ (篇|個部落格)/);
  });

  const failures: Array<[string, () => void]> = [
    ['the full ranking payload (vocabulary, no view mark)', () => answer(EMPTY.topics)],
    ['a compact payload with more than its limit', () => answer(home(Array.from({ length: 9 }, (_, i) => topic(i + 1))))],
    ['a compact payload whose count is text', () => answer(home([topic(1, { posts: '3' })]))],
    [
      'a compact payload that also carries vocabulary',
      () => answer(home([], { vocabulary: (EMPTY.topics as { vocabulary: unknown }).vocabulary })),
    ],
    ['the gateway 404', () => answer({ error: 'not found' }, 404)],
  ];
  // No answer in time (the shared host is often slow): the browser reads the ranking itself, never an empty list.
  for (const [name, status] of [
    ['a 503 twice', 503],
    ['a 500', 500],
  ] as const)
    test(`${name}: hands the list to the browser's own read`, async () => {
      answer({ error: 'busy' }, status);
      const element = await HomeTopicRanking();
      expect(element.type).toBe(HomeTopicRankingFromBrowser);
    });
  for (const [name, setup] of failures)
    test(`${name}: throws to the error boundary, never an empty list`, async () => {
      setup();
      await expect(HomeTopicRanking()).rejects.toBeInstanceOf(PublicGatewayError);
    });

  test('the Suspense fallback is the list frame with blank rows: busy, no rank, label or count', () => {
    const $ = load(renderToString(<HomeTopicsPending />));
    const status = $('[role="status"]');
    expect(status.attr('aria-busy')).toBe('true');
    expect(status.text()).toBe('正在載入最近共同話題…');
    expect($('ol.ranking').attr('aria-hidden')).toBe('true');
    expect($('ol.ranking > li').length).toBe(8);
    expect($('ol.ranking').text()).toBe('');
    expect($('body').text()).not.toMatch(/\d/);
    expect($('a').length).toBe(0);
  });
});
