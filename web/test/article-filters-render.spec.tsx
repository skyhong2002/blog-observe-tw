import { load } from 'cheerio';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import ArticlesPage from '@/app/articles/page';
import ArticlesView, { ArticlesFromUrl } from '@/components/public/Articles';
import type { Post } from '@/lib/api';
import { NO_SEARCH } from '@/lib/search';

const state = vi.hoisted(() => ({ query: '', posts: [] as Post[], suspend: false }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => {
    if (state.suspend) throw new Promise(() => {});
    return new URLSearchParams(state.query);
  },
}));
vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ prefetch, scroll: _scroll, ...props }: Record<string, unknown>) =>
      createElement('a', { ...props, 'data-prefetch': String(prefetch) }),
    useLinkStatus: () => ({ pending: false }),
  };
});
vi.mock('@/components/BlogIcon', () => ({ default: () => null }));
vi.mock('@/lib/public-api', () => ({ overview: async () => ({ posts: state.posts }) }));

const posts: Post[] = [
  { id: 1, title: 'Food latest', blogSlug: 'food', blogGenres: ['food', 'travel'] },
  { id: 2, title: 'Other latest', blogSlug: 'other' },
  { id: 3, title: 'Other older', blogSlug: 'other', blogGenres: [] },
  { id: 4, title: 'Gadget latest', blogSlug: 'gadget', blogGenres: ['gadgets'] },
];
beforeEach(() => {
  state.query = '';
  state.posts = posts;
  state.suspend = false;
});

describe('latest article preferences: server rendering', () => {
  test('shows active preferences, partitioned counts, checked inputs and a reset link', () => {
    const $ = load(
      renderToString(<ArticlesView asked={NO_SEARCH} latest={posts} search={null} filters={{ maxPerBlog: 1, exclude: ['food'] }} />),
    );
    expect(
      $('h3')
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(['Other latest', 'Gadget latest']);
    expect($('[role="status"]').text()).toContain('4 篇中顯示 2 篇');
    expect($('[role="status"]').text()).toContain('類型排除 1 篇、每站篇數限制隱藏 1 篇');
    expect($('input[name="exclude"][value="food"]').is(':checked')).toBe(true);
    expect($('option[selected]').attr('value')).toBe('1');
    expect(
      $('a')
        .filter((_, el) => $(el).text() === '清除篩選')
        .attr('href'),
    ).toBe('/articles/');
    expect($.text()).toContain('未分類部落格一律保留');
    expect($.text()).toContain('不會補入更早文章');
  });
  test('the force-dynamic page fallback reads URL preferences on the server', async () => {
    state.suspend = true;
    const page = await ArticlesPage({ searchParams: Promise.resolve({ maxPerBlog: '1', exclude: ['food', 'gadgets'] }) });
    const $ = load(renderToString(page));
    expect(
      $('h3')
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(['Other latest']);
    expect($('input:checked')).toHaveLength(2);
    expect($('[role="status"]').text()).toContain('4 篇中顯示 1 篇');
  });
  test('client URL navigation reuses the same parser and leaves older-gateway posts visible', () => {
    state.query = 'maxPerBlog=1&exclude=food&exclude=gadgets';
    const $ = load(renderToString(<ArticlesFromUrl latest={posts} />));
    expect(
      $('h3')
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(['Other latest']);
    expect($.text()).toContain('未分類文章 2 篇');
  });
  test('distinguishes filtered empty results from an empty source list', () => {
    const filtered = renderToString(
      <ArticlesView asked={NO_SEARCH} latest={[posts[0]]} search={null} filters={{ maxPerBlog: 0, exclude: ['food'] }} />,
    );
    expect(filtered).toContain('這批文章都被篩選隱藏了');
    const empty = renderToString(<ArticlesView asked={NO_SEARCH} latest={[]} search={null} />);
    expect(empty).toContain('目前還沒有收錄文章');
  });
  test('search mode explicitly states its scope and does not show latest-only controls', () => {
    const $ = load(
      renderToString(
        <ArticlesView
          asked={{ ...NO_SEARCH, q: 'hello' }}
          latest={posts}
          search={{ status: 'pending' }}
          filters={{ maxPerBlog: 1, exclude: ['food'] }}
        />,
      ),
    );
    expect($('form[aria-label="最新文章篩選"]')).toHaveLength(0);
    expect($.text()).toContain('搜尋結果不套用每站篇數與類型排除');
    expect($.text()).toContain('正在搜尋');
  });
});
