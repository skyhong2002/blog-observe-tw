/**
 * The blog page's tag line under the title (gen106, tag.observe.tw's layout), rendered for real through SourceProfile:
 * first line how it was collected, second line 標籤, the shown tags as directory chips, and 編輯標籤 to
 * traffic.observe.tw. No votes anywhere. Next's links and hooks, the follow button and icons are mocked.
 */
import { load } from 'cheerio';
import { renderToString } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import type { GenreState } from '../../app/src/blog-genres/resolve.ts';

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ prefetch, scroll: _scroll, ...props }: Record<string, unknown>) =>
      createElement('a', { ...props, 'data-prefetch': String(prefetch) }),
    useLinkStatus: () => ({ pending: false }),
  };
});
vi.mock('next/navigation', () => ({
  usePathname: () => '/blogs/wiwi.blog/',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock('@/components/BlogIcon', () => ({ default: () => null }));
vi.mock('@/components/follow-button', () => ({ default: () => null }));

import SourceProfile from '@/components/SourceProfile';
import type { Blog } from '@/lib/api';

const item = (genre: string, label: string, visible = true) => ({
  genre,
  label,
  source: 'editor' as const,
  visible,
  agrees: 0,
  disagrees: 0,
  adminOverride: null,
});
const page = (genreState: GenreState | undefined, tagsUrl: string | null = 'https://traffic.observe.tw/site/wiwi.blog/#tags') =>
  load(
    renderToString(
      <SourceProfile
        blog={
          {
            slug: 'wiwi',
            name: 'Wiwi',
            statusLabel: 'BlogBlog.Club 名單自動收錄',
            posts: [],
            authors: [],
            tags: [],
            genreState,
            tagsUrl,
          } as unknown as Blog
        }
      />,
    ),
  );

describe('blog tag line', () => {
  test('keeps the collection line to itself and puts the shown tags on their own line with 編輯標籤', () => {
    const $ = page({ status: 'ready', items: [item('個人', '個人'), item('diary', '日記'), item('news', '新聞', false)] });
    const first = $('header p').first().text();
    expect(first).toContain('BlogBlog.Club 名單自動收錄');
    expect(first).not.toMatch(/個人|日記/);
    const line = $('[aria-label="標籤"]');
    expect(line.children().first().text()).toBe('標籤');
    expect(
      line
        .find('a[href^="/blogs/?genre="]')
        .map((_, a) => [[$(a).attr('href'), $(a).text()]])
        .get(),
    ).toEqual([
      ['/blogs/?genre=%E5%80%8B%E4%BA%BA', '個人'],
      ['/blogs/?genre=diary', '日記'],
    ]);
    const edit = line.find('a[href^="https://traffic.observe.tw/"]');
    expect(edit.text()).toBe('編輯標籤');
    expect(edit.attr('href')).toBe('https://traffic.observe.tw/site/wiwi.blog/#tags');
    // The link's text and nothing else on the line: no sources, counts, votes or sign-in prompts.
    expect(line.text()).toBe('標籤個人日記編輯標籤');
    expect($.html()).not.toMatch(/同意|投票|無法載入|登入後|AI 初判/);
  });
  test('says 尚無標籤 for a blog without shown tags, and nothing but the link before tags were ever read', () => {
    expect(page({ status: 'ready', items: [item('news', '新聞', false)] })('[aria-label="標籤"]').text()).toBe('標籤尚無標籤編輯標籤');
    expect(page({ status: 'unavailable', items: [] })('[aria-label="標籤"]').text()).toBe('標籤編輯標籤');
    expect(page(undefined)('[aria-label="標籤"]').text()).toBe('標籤編輯標籤');
    expect(page({ status: 'unavailable', items: [] }).html()).not.toContain('暫時無法使用');
  });
});
