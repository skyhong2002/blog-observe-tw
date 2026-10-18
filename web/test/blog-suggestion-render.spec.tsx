import { renderToString } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { looksLikeAddress, SuggestionNote } from '@/components/BlogSuggestion';

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ prefetch: _p, ...props }: Record<string, unknown>) => createElement('a', props),
    useLinkStatus: () => ({ pending: false }),
  };
});

test('only addresses are worth asking about', () => {
  for (const q of ['thelingwu.com', 'https://www.thelingwu.com/', 'medium.com/@someone', 'blog.example.com.tw/blog/'])
    expect(looksLikeAddress(q)).toBe(true);
  for (const q of ['咖啡', 'node.js 教學', 'v1.2', 'hello']) expect(looksLikeAddress(q)).toBe(false);
});

test('says what a reader can do for each state', () => {
  const home = 'https://thelingwu.com/';
  const html = (state: Parameters<typeof SuggestionNote>[0]['state'], signIn: string | null = null) =>
    renderToString(<SuggestionNote state={state} signIn={signIn} onAdd={() => {}} />).replace(/<!-- -->/g, '');
  expect(html({ state: 'new', home })).toContain('還沒收錄 thelingwu.com。<button');
  expect(html({ state: 'new', home })).toContain('新增這個部落格');
  expect(html({ state: 'new', home }, '/auth/google?next=%2F')).toContain('登入後新增這個部落格');
  expect(html({ state: 'listed', home, slug: 'ling', name: '凌' })).toContain('thelingwu.com 已收錄');
  expect(html({ state: 'queued', home, checkedAt: null, reason: null })).toContain('已在待查清單');
  expect(html({ state: 'queued', home, checkedAt: null, reason: 'rss_or_article_sitemap_required' })).toContain('找不到可讀的 RSS');
  expect(html({ state: 'queued', home, checkedAt: null, reason: 'daily_admission_budget_exhausted' })).not.toContain('尚未通過');
  expect(html({ state: 'invalid' })).toBe('');
});
