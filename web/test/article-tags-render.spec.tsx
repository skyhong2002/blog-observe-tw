/**
 * ArticleListItem (the /articles/, blog profile and tag explorer rows) rendered with react-dom/server: the author's
 * hashtags sit on the line right under the title, at most five, with +N from the gateway's full count. Synthetic posts.
 */
import { load } from 'cheerio';
import { renderToString } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import ArticleListItem from '@/components/ArticleListItem';
import type { Post } from '@/lib/api';

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
vi.mock('@/components/BlogIcon', () => ({ default: () => null }));

const post = (patch: Partial<Post> = {}): Post => ({
  id: 1,
  title: '一篇文章',
  url: 'https://a.example/p/1',
  publishedAt: '2026-10-13T00:00:00.000Z',
  blogSlug: 'a',
  blogName: '甲',
  ...patch,
});
const render = (p: Post) => load(renderToString(<ArticleListItem post={p} />));

describe('article rows: author hashtags', () => {
  test('five tags right under the title and +N for the rest of the full count', () => {
    const tags = ['a', 'b', 'c', 'd', 'e', 'f'].map((slug) => ({ slug, label: slug.toUpperCase() }));
    const $ = render(post({ tags, tagCount: 9 }));
    const line = $('h3').next();
    expect(line.attr('aria-label')).toBe('作者標籤');
    expect(
      line
        .find('a')
        .map((_, a) => $(a).text())
        .get(),
    ).toEqual(['#A', '#B', '#C', '#D', '#E']);
    expect(line.children('li').last().text()).toBe('+4');
    expect($('ul[aria-label="作者標籤"]').length).toBe(1);
  });

  test('without tagCount the shown tags are the whole list; no tags means no line', () => {
    const $ = render(post({ tags: [{ slug: 'ai', label: 'ai' }] }));
    expect($('ul[aria-label="作者標籤"]').text()).toBe('#ai');
    expect(render(post()).html()).not.toContain('作者標籤');
  });
});
