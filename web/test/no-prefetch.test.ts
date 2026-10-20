import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isFileHref } from '../src/lib/file-links.ts';
import { NAV_GROUPS } from '../src/lib/site-nav.ts';

// Public pages render per request (no-store): one Next viewport prefetch per
// visible link turned a home view into ~25 extra dynamic renders against the
// reader's per-IP budget. Every internal link goes through NoPrefetchLink.

const SRC = new URL('../src/', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, SRC), 'utf8');
const files = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((path) => /\.(?:tsx?|mts)$/.test(path))
  .map((path) => path.replaceAll('\\', '/'));

test('only NoPrefetchLink imports the next/link component; nothing turns prefetch back on', () => {
  assert.ok(files.length > 50, 'walked web/src');
  const importers = files.filter((path) => /from ['"]next\/link['"]/.test(source(path)));
  assert.deepEqual(importers.sort(), ['components/NavPending.tsx', 'components/NoPrefetchLink.tsx']);
  // NavPending only reads the link status hook, it renders no link.
  assert.match(source('components/NavPending.tsx'), /^import \{ useLinkStatus \} from 'next\/link';$/m);
  for (const path of files) {
    if (path === 'components/NoPrefetchLink.tsx') continue;
    const text = source(path);
    assert.doesNotMatch(text, /\bprefetch\s*[=:]|\.prefetch\(|unstable_dynamicOnHover/, path);
    assert.doesNotMatch(text, /next\/dist\/client\/(?:app-dir\/)?link|require\(['"]next\/link/, path);
  }
  // The wrapper forces prefetch off after the caller's props, so a spread cannot override it,
  // and its props type does not accept prefetch at all.
  const wrapper = source('components/NoPrefetchLink.tsx');
  assert.match(wrapper, /return <Link \{\.\.\.props\} prefetch=\{false\} \/>;/);
  assert.match(wrapper, /Omit<ComponentProps<typeof Link>, 'prefetch'/);
  assert.equal(wrapper.match(/<Link\b/g)?.length, 1);
});

test('private RSS/OPML files are plain anchors, pages stay client-side links', () => {
  for (const href of ['/me/feed.xml', '/me/opml', '/feeds/abc.xml', '/sitemap.xml', '/me/feed.xml?x=1']) assert.ok(isFileHref(href), href);
  for (const href of [
    '/',
    '/my/',
    '/articles/',
    '/articles/?q=xml',
    '/blogs/example.com/',
    '/topics/rss%3A42/',
    '/api/',
    '/media/',
    '/me',
    '/meta/',
  ])
    assert.equal(isFileHref(href), false, href);
  // The header and account menu file links all resolve to plain anchors through the wrapper.
  const navFiles = NAV_GROUPS.flatMap((group) => group.links.map((link) => link.href)).filter((href) => href.startsWith('/me/'));
  assert.deepEqual(navFiles, []);
  for (const href of navFiles) assert.ok(isFileHref(href), href);
  for (const path of ['components/AccountMenu.tsx', 'app/my/page.tsx'])
    for (const href of source(path).match(/['"]\/me\/[^'"]+['"]/g) ?? []) assert.ok(isFileHref(href.slice(1, -1)), `${path} ${href}`);
  assert.match(source('components/NoPrefetchLink.tsx'), /if \(isFileHref\(props\.href\)\) \{[\s\S]*?return <a /);
});

test('phone header: the results page keeps search as an icon; /api/status stacks its endpoint table', () => {
  // /articles/ has its own search form, so the header box only opens itself while the wordmark is hidden.
  const header = source('components/SiteHeader.tsx');
  assert.match(header, /const autoSearch = !revealed && !searchOpen;/);
  assert.doesNotMatch(header, /isSearchPage/);
  assert.match(header, /aria-label=\{searchOpen \? '關閉文章搜尋' : '搜尋文章'\}/);
  // Full endpoint paths: stacked rows with labels on phones, no truncation or sideways scroller.
  const status = source('components/ApiStatusView.tsx');
  assert.match(status, /<table className=\{`[^`]*\$\{table\.stack\}`\}>/);
  assert.match(status, /data-label="端點"[\s\S]*?\{endpoint\.path\}/);
  assert.match(status, /data-label="用途"[\s\S]*?\{endpoint\.summary\}/);
  assert.doesNotMatch(status, /TableScroller|truncate|leadText|min-w-\[/);
  assert.match(source('app/globals.css'), /@media \(width < 40rem\) \{\s*\.table-stack,/);
});
