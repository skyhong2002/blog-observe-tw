import { renderToString } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { looksLikeAddress, SuggestionNote } from '@/components/BlogSuggestion';
import { BlogQueueView } from '@/components/public/BlogQueue';

vi.mock('next/navigation', () => ({
  usePathname: () => '/queue/',
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
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
  expect(html({ state: 'queued', home, checkedAt: null, reason: null })).toContain('待查清單</a>，系統會自動檢查');
  expect(html({ state: 'queued', home, checkedAt: null, reason: 'rss_or_article_sitemap_required' })).toContain('找不到可讀的 RSS');
  expect(html({ state: 'queued', home, checkedAt: null, reason: 'daily_admission_budget_exhausted' })).not.toContain('尚未通過');
  expect(html({ state: 'invalid' })).toBe('');
});

test('the queued note links to that site in the 待查清單', () => {
  const html = renderToString(
    <SuggestionNote state={{ state: 'queued', home: 'https://thelingwu.com/', checkedAt: null, reason: null }} />,
  );
  expect(html).toContain('href="/queue/?q=thelingwu.com"');
});

test('the 待查清單 shows each site, its state, the reason in words and links a listed one to its page', () => {
  const html = renderToString(
    <BlogQueueView
      status="ready"
      queue={{
        filters: { q: '', state: '', source: '', page: 1 },
        pagination: { page: 1, pages: 1, total: 2 },
        states: { waiting: 0, failed: 1, listed: 1, rejected: 0 },
        sources: { 'reader-suggestion': 1, 'blogblog-club': 1 },
        items: [
          {
            url: 'https://thelingwu.com/',
            name: null,
            source: 'reader-suggestion',
            state: 'failed',
            addedAt: '2026-10-18T21:06:46.000Z',
            checkedAt: '2026-10-18T21:08:42.000Z',
            reason: 'personal_identity_uncertain',
            slug: null,
          },
          {
            url: 'https://wiwi.blog/',
            name: null,
            source: 'blogblog-club',
            state: 'listed',
            addedAt: null,
            checkedAt: null,
            reason: null,
            slug: 'wiwi',
          },
        ],
      }}
    />,
  ).replace(/<!-- -->/g, '');
  expect(html).toContain('thelingwu.com');
  expect(html).toContain('還無法確認是個人部落格');
  expect(html).toContain('讀者新增');
  expect(html).toContain('未通過 1');
  expect(html).toContain('href="/blogs/wiwi/"');
  expect(html).not.toContain('personal_identity_uncertain');
});
