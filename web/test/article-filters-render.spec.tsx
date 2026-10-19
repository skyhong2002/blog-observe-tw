import { load } from 'cheerio';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import ArticlesPage from '@/app/articles/page';
import ArticlesView, { ArticlesFromUrl } from '@/components/public/Articles';
import type { Post } from '@/lib/api';
import { NO_SEARCH } from '@/lib/search';

const state = vi.hoisted(() => ({ query: '', posts: [] as Post[], suspend: false }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/articles/',
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
vi.mock('@/lib/public-api', () => ({ overview: async () => ({ posts: state.posts, genreStatus: 'ready' }) }));

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
  test('shows active preferences, partitioned counts, current chips and a reset link', () => {
    const $ = load(
      renderToString(
        <ArticlesView genreStatus="ready" asked={NO_SEARCH} latest={posts} search={null} filters={{ maxPerBlog: 1, exclude: ['food'] }} />,
      ),
    );
    expect(
      $('li h3')
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(['Other latest', 'Gadget latest']);
    expect($('[role="status"]').text()).toContain('最近收錄 4 篇，顯示 2 篇');
    expect($('[role="status"]').text()).toContain('類型隱藏 1、每站上限隱藏 1');
    const current = $('[aria-label="最新文章篩選"] a[aria-current="page"]');
    expect(current.map((_, el) => $(el).text()).get()).toEqual(['1 篇', '✕ 美食']);
    // Clicking a hidden genre shows it again; other choices are kept.
    expect(current.eq(1).attr('href')).toBe('/articles/?maxPerBlog=1');
    expect(
      $('nav a')
        .filter((_, el) => $(el).text() === '3C')
        .attr('href'),
    ).toBe('/articles/?maxPerBlog=1&exclude=food&exclude=gadgets');
    expect(
      $('a')
        .filter((_, el) => $(el).text() === '清除篩選')
        .attr('href'),
    ).toBe('/articles/');
    expect($('#method').text()).toContain('（這批中有 2 篇）');
  });
  test('the force-dynamic page fallback reads URL preferences on the server', async () => {
    state.suspend = true;
    const page = await ArticlesPage({ searchParams: Promise.resolve({ maxPerBlog: '1', exclude: ['food', 'gadgets'] }) });
    const $ = load(renderToString(page));
    expect(
      $('li h3')
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(['Other latest']);
    expect($('[aria-label="最新文章篩選"] a[aria-current="page"]')).toHaveLength(3);
    expect($('[role="status"]').text()).toContain('最近收錄 4 篇，顯示 1 篇');
  });
  test('client URL navigation reuses the same parser and leaves older-gateway posts visible', () => {
    state.query = 'maxPerBlog=1&exclude=food&exclude=gadgets';
    const $ = load(renderToString(<ArticlesFromUrl latest={posts} genreStatus="ready" />));
    expect(
      $('li h3')
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(['Other latest']);
    expect($('#method').text()).toContain('（這批中有 2 篇）');
  });
  test('distinguishes filtered empty results from an empty source list', () => {
    const filtered = renderToString(
      <ArticlesView
        genreStatus="ready"
        asked={NO_SEARCH}
        latest={[posts[0]]}
        search={null}
        filters={{ maxPerBlog: 0, exclude: ['food'] }}
      />,
    );
    expect(filtered).toContain('這批文章都被篩選隱藏了');
    const empty = renderToString(<ArticlesView genreStatus="ready" asked={NO_SEARCH} latest={[]} search={null} />);
    expect(empty).toContain('目前還沒有收錄文章');
  });
  test('an unavailable or older gateway disables genre exclusions while still applying the per-blog cap', () => {
    const $ = load(
      renderToString(<ArticlesView asked={NO_SEARCH} latest={posts} search={null} filters={{ maxPerBlog: 1, exclude: ['food'] }} />),
    );
    expect(
      $('li h3')
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(['Food latest', 'Other latest', 'Gadget latest']);
    expect($('nav[aria-label="隱藏類型"]')).toHaveLength(0);
    expect($.text()).toContain('類型篩選暫時無法使用，本次未套用。');
    expect($.text()).toContain('每站上限隱藏 1');
    // The cap chips keep the genre choice in the URL for when genres come back.
    expect(
      $('nav[aria-label="每站最多"] a')
        .filter((_, el) => $(el).text() === '2 篇')
        .attr('href'),
    ).toBe('/articles/?maxPerBlog=2&exclude=food');
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
    expect($('[aria-label="最新文章篩選"]')).toHaveLength(0);
    expect($('#method').text()).toContain('搜尋結果不套用這兩項篩選');
    expect($.text()).toContain('正在搜尋');
  });
});
