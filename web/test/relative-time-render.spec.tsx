import { load } from 'cheerio';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import ArticleListItem from '@/components/ArticleListItem';
import RelativeTime, { RelativeTimeProvider } from '@/components/RelativeTime';

vi.mock('@/components/ArticleThumbnail', () => ({ default: () => null }));
vi.mock('@/components/BlogIcon', () => ({ default: () => null }));

const at = '2026-11-12T15:20:00Z';
const now = Date.parse('2026-11-12T18:20:00Z');
const render = () =>
  renderToString(
    <RelativeTimeProvider initialNow={now}>
      <RelativeTime value={at} />
    </RelativeTimeProvider>,
  );

afterEach(() => vi.useRealTimers());

test('SSR and the first browser render use the same serialized clock, even if hydration crosses a time boundary', () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const server = render();
  vi.setSystemTime(now + 3_600_000);
  expect(render()).toBe(server);
  const $ = load(server);
  expect($('time').text()).toBe('3 小時前');
  expect($('time').attr('datetime')).toBe(at);
  expect($('time').attr('title')).toBe('2026/11/12 23:20（台北時間）');
});

test('article rows use compact dates and retain the exact publication date without invalid time markup', () => {
  const $ = load(
    renderToString(
      <RelativeTimeProvider initialNow={now}>
        <ArticleListItem post={{ id: 1, title: '文章', publishedAt: at }} />
        <RelativeTime value="invalid" />
        <RelativeTime value={null} />
      </RelativeTimeProvider>,
    ),
  );
  expect($('time').length).toBe(1);
  expect($('#article-1 time').text()).toBe('3 小時前');
  expect($('body').text()).toContain('尚無紀錄尚無紀錄');
});
