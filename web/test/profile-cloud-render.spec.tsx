/**
 * A blog profile's word cloud, rendered for real (react-dom/server): BlogTopicCloud over the real readPublic and
 * public-contracts.ts with a fake gateway (no HTTP), MediaWordCloud's states, and SourceProfile showing only the
 * server slot it is given, never a cloud made from the blog's raw tags. Next's hooks, links and images, the follow
 * button and blog icons are mocked. Synthetic payloads; not a UI or production acceptance.
 */
import { load } from 'cheerio';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { PublicGatewayError } from '@/lib/public-read';
import { EMPTY } from './public-payloads.ts';

const gateway = vi.hoisted(() => ({ bodies: new Map<string, { status: number; body: unknown }>(), paths: [] as string[] }));

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ prefetch, scroll: _scroll, ...props }: Record<string, unknown>) =>
      createElement('a', { ...props, 'data-prefetch': String(prefetch) }),
    useLinkStatus: () => ({ pending: false }),
  };
});
vi.mock('next/navigation', () => ({
  usePathname: () => '/blogs/a/',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock('next/image', async () => {
  const { createElement } = await import('react');
  return { default: ({ unoptimized: _unoptimized, ...props }: Record<string, unknown>) => createElement('img', props) };
});
vi.mock('@/components/WordCloudView.module.css', () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));
vi.mock('@/components/BlogIcon', () => ({ default: () => null }));
vi.mock('@/components/follow-button', () => ({ default: () => null }));
vi.mock('@/lib/public-api', async () => {
  const { readPublic } = await import('@/lib/public-read');
  return {
    publicJsonOrNull: async (path: string) => {
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
      return result.found ? result.body : null;
    },
  };
});

import BlogTopicCloud from '@/components/BlogTopicCloud';
import BlogTopics from '@/components/BlogTopics';
import { MediaWordCloudPending } from '@/components/MediaWordCloud';
import SourceProfile from '@/components/SourceProfile';
import type { Blog } from '@/lib/api';

// The profile's original 90-day period, shared by its list and its cloud.
const PATH = '/api/blogs/a/topics?days=90';
const topic = (i: number, patch: object = {}) => ({
  id: `tag:${String(i).padStart(64, '0')}`,
  label: `話題${i}`,
  source: 'tag-vocabulary',
  score: 1,
  posts: i + 1,
  blogs: 1,
  ...patch,
});
const topics = (items: object[]) => ({ ...(EMPTY.blogTopics as object), days: 90, items });
const answer = (body: unknown, status = 200) => gateway.bodies.set(PATH, { status, body });

beforeEach(() => {
  gateway.bodies.clear();
  gateway.paths = [];
});

describe('profile topic cloud', () => {
  test('drawn from the blog 90-day topic ranking; the list reads the same path; links follow topicLink', async () => {
    answer(
      topics([
        topic(1, { canonicalPath: '/topics/%E8%A9%B1%E9%A1%8C1/' }),
        topic(2),
        // An accepted source kind that is not the approved tag pool: listed, never a word.
        topic(3, { id: 'rss:3', label: 'RSS分類詞', source: 'rss-category' }),
      ]),
    );
    const $ = load(renderToString(await BlogTopicCloud({ slug: 'a' })));
    const list = load(renderToString(await BlogTopics({ slug: 'a' })));
    expect(gateway.paths).toEqual([PATH, PATH]);
    const hrefs = $('a')
      .map((_, el) => $(el).attr('href'))
      .get();
    // Detail period is 30, so the 90-day links keep ?days=90.
    expect(hrefs).toContain('/topics/%E8%A9%B1%E9%A1%8C1/?days=90');
    expect(hrefs.some((h) => h.includes('/tags/?tag='))).toBe(false);
    expect($('body').text()).not.toContain('RSS分類詞');
    expect($('a[aria-label^="RSS分類詞"]').length).toBe(0);
    expect($('section[aria-label="話題文字雲"] h2').text()).toBe('近 90 天話題');
    // The list itself is unchanged: it still shows every ranked row with its source label.
    expect(list('a[href="/topics/%E8%A9%B1%E9%A1%8C1/?days=90"]').text()).toContain('話題1 · 2 篇');
    expect(list('body').text()).toContain('RSS分類詞');
    // What counts as a topic is said once, in the footer's method block, not above the list.
    expect(list('body').text()).not.toContain('不是作者身分分類');
    expect(list('p').length).toBe(0);
  });

  test('empty and not offered (404) leave the cloud out, a failure still throws; nothing falls back to raw tags', async () => {
    answer(topics([]));
    let $ = load(renderToString(await BlogTopicCloud({ slug: 'a' })));
    expect($('section').length).toBe(0);
    expect($('body').text()).toBe('');
    // The list is left out too when the period has no topics: no 尚無 sentence.
    const list = load(renderToString(await BlogTopics({ slug: 'a' })));
    expect(list('section').length).toBe(0);
    expect(list('body').text()).toBe('');
    // Only unapproved provenance: still no cloud, not a fallback to those rows.
    answer(topics([topic(5, { id: 'rss:5', source: 'rss-category' })]));
    $ = load(renderToString(await BlogTopicCloud({ slug: 'a' })));
    expect($('section').length).toBe(0);
    expect($('a').length).toBe(0);
    gateway.bodies.clear();
    $ = load(renderToString(await BlogTopicCloud({ slug: 'a' })));
    expect($('section').length).toBe(0);
    expect($('body').text()).toBe('');
    answer({ error: 'busy' }, 503);
    await expect(BlogTopicCloud({ slug: 'a' })).rejects.toBeInstanceOf(PublicGatewayError);
    const pending = load(renderToString(<MediaWordCloudPending />));
    expect(pending('[role="status"]').attr('aria-busy')).toBe('true');
    expect(pending('body').text()).not.toMatch(/\d+ 篇/);
  });

  // A malformed 200 is a failed public read for both the cloud and the list: never an empty cloud or list.
  const gate = {
    version: 'tag-broad-window-title-only-v1',
    upstream: 'tag.observe.tw/qualifyTagMedia/broad',
    minimumSources: 3,
    minimumTwiceSources: 2,
    minimumPeakPosts: 3,
    documentFrequencyRatio: 0.02,
    reason: 'high-window-document-frequency-title-only',
    effect: 'ranking-body-evidence-only;source-pool-and-historical-pages-retained',
  };
  const malformed: Array<[string, unknown]> = [
    ['a text post count', topics([topic(1, { posts: '3' })])],
    ['a negative blog count', topics([topic(1, { blogs: -1 })])],
    ['an unknown source', topics([topic(1, { source: 'other' })])],
    ['a missing source', topics([topic(1, { source: undefined })])],
    ['an incomplete display gate', { ...topics([topic(1)]), matchingPolicy: { version: 'm', displayGate: { ...gate, upstream: '' } } }],
    [
      'an out-of-range gate ratio',
      { ...topics([topic(1)]), matchingPolicy: { version: 'm', displayGate: { ...gate, documentFrequencyRatio: 2 } } },
    ],
  ];
  for (const [name, body] of malformed)
    test(`${name}: the profile topic read fails for the cloud and the list`, async () => {
      answer(body);
      await expect(BlogTopicCloud({ slug: 'a' })).rejects.toBeInstanceOf(PublicGatewayError);
      await expect(BlogTopics({ slug: 'a' })).rejects.toBeInstanceOf(PublicGatewayError);
    });

  test('a complete display gate, or none (legacy), is a normal answer', async () => {
    answer({ ...topics([topic(1)]), matchingPolicy: { version: 'm', displayGate: gate } });
    expect(load(renderToString(await BlogTopicCloud({ slug: 'a' })))('a').length).toBeGreaterThan(0);
    answer(topics([topic(1)]));
    expect(load(renderToString(await BlogTopicCloud({ slug: 'a' })))('a').length).toBeGreaterThan(0);
  });

  test('SourceProfile shows the slot it is given and never a cloud built from the blog raw tags', () => {
    const blog = {
      slug: 'a',
      name: '甲',
      url: 'https://a.example/',
      posts: [],
      authors: [],
      tags: [{ slug: 'rss-noise', label: '未分類', postCount: 99 }],
    } as unknown as Blog;
    const $ = load(renderToString(<SourceProfile blog={blog} cloud={<div data-slot="cloud">slot</div>} />));
    expect($('[data-slot="cloud"]').length).toBe(1);
    expect($('section[aria-label="文章文字雲"], section[aria-label="話題文字雲"]').length).toBe(0);
    expect($('svg a[href^="/tags/"]').length).toBe(0);
    // The blog's own tags remain as metadata chips in the sidebar.
    expect($('a[href="/tags/?tag=rss-noise"]').text()).toBe('未分類');
  });
});
