/**
 * The real HomePage server component rendered with react-dom/server, to check how publisher article titles are
 * shown: entity references decoded once for display, the result still escaped as text, and the overview payload
 * itself untouched. homeOverview is mocked (no HTTP); the topic ranking, word cloud, blog icons and image element
 * are stubbed because they are not what this checks. Synthetic payload; not a UI or production acceptance.
 */
import { load } from 'cheerio';
import { renderToString } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import type { Overview } from '@/lib/api';

const overview = vi.hoisted(() => ({ data: null as unknown, calls: 0 }));

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ prefetch, scroll: _scroll, ...props }: Record<string, unknown>) =>
      createElement('a', { ...props, 'data-prefetch': String(prefetch) }),
    useLinkStatus: () => ({ pending: false }),
  };
});
vi.mock('@/app/_home/home.module.css', () => ({ default: new Proxy({}, { get: (_, key) => String(key) }) }));
vi.mock('@/lib/public-api', () => ({
  homeOverview: async () => {
    overview.calls++;
    return overview.data;
  },
}));
vi.mock('@/app/_home/HomeTopics', () => ({ default: () => null, HomeTopicsPending: () => null }));
vi.mock('@/app/_home/MastheadCloud', () => ({ default: () => null }));
vi.mock('@/components/BlogIcon', () => ({ default: () => null }));
vi.mock('@/components/SafeImage', async () => {
  const { createElement } = await import('react');
  return { default: ({ src }: { src: string }) => createElement('img', { src, alt: '' }) };
});

import HomePage from '@/app/page';

const REPORTED = 'She Rarely Reaches Out But Our Chemistry &#038; Sex Are Great';
const SHOWN = 'She Rarely Reaches Out But Our Chemistry & Sex Are Great';
const post = (id: number, title: string) => ({
  id,
  title,
  url: `https://a.example/p/${id}`,
  summary: '摘要',
  author: '甲',
  publishedAt: '2026-10-13T00:00:00.000Z',
  imageUrl: `https://a.example/i/${id}.jpg`,
  blogSlug: 'a',
  blogName: '甲',
});
const data = (): Overview =>
  ({
    view: 'home',
    posts: [post(1, REPORTED), post(2, `${REPORTED} <b>2</b>`)],
    tags: [],
    authors: [],
    blogs: [],
    recentBlogs: [
      {
        slug: 'a',
        name: '甲',
        latestPost: { id: 3, title: `${REPORTED} &amp;#038;`, url: 'https://a.example/p/3', publishedAt: '2026-10-13T00:00:00.000Z' },
      },
    ],
    totals: { blogs: 1, posts: 3 },
    updatedAt: null,
  }) as unknown as Overview;

describe('homepage article titles', () => {
  test('lead, story and recent-blog titles (and their image labels) are decoded once and stay escaped text', async () => {
    overview.data = data();
    const before = structuredClone(overview.data);
    const $ = load(renderToString(await HomePage()));
    expect(overview.calls).toBe(1);

    // Lead: heading link and the hero image's aria-label.
    const lead = $('a[href="https://a.example/p/1"]');
    expect(lead.filter((_, el) => $(el).text() === SHOWN).length).toBe(1);
    expect(lead.filter((_, el) => $(el).attr('aria-label') === `閱讀：${SHOWN}`).length).toBe(1);

    // Story: literal markup in the title stays visible text, not an element.
    const story = $('a[href="https://a.example/p/2"]');
    expect(story.filter((_, el) => $(el).text() === `${SHOWN} <b>2</b>`).length).toBe(1);
    expect(story.find('b').length).toBe(0);
    expect(story.filter((_, el) => $(el).attr('aria-label') === `閱讀：${SHOWN} <b>2</b>`).length).toBe(1);

    // Recent blogs: text and title attribute, decoded exactly once.
    const recent = $('a[href="https://a.example/p/3"]');
    expect(recent.text()).toBe(`${SHOWN} &#038;`);
    expect(recent.attr('title')).toBe(`${SHOWN} &#038;`);

    const html = $.html();
    expect(html).not.toContain('&amp;#038; Sex');
    expect(html).toContain('&lt;b&gt;2&lt;/b&gt;');
    // The payload a later read or search would use is unchanged.
    expect(overview.data).toEqual(before);
    expect((overview.data as Overview).posts[0].title).toBe(REPORTED);
  });
});
