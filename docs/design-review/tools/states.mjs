// Screenshot inventory for the weblog.tw design review. docs/design-review/states.md
// documents the same IDs; change both together and only between rounds that
// re-shoot the baseline.
//
// data:    normal | empty | error | loading   (snapshot-gateway.mjs scenario)
// session: out | in                           (fictional signed-in reader)
// theme:   light (default) | dark             (prefers-color-scheme)
// click:   selectors clicked in order after load
// anchor:  start the shot at this selector     viewportOnly: one screen only
// navFrom: load this path normally first, then switch the gateway to `data`
//          and click the link `navClick`, and shoot after `navWait` ms: what a
//          reader sees while the next page is still on its way.
// streamOnly: open `path` directly while reads hang and shoot what has streamed after 2 s
//          (the route's loading skeleton).
export const SIZES = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, maxHeight: 2700 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, maxHeight: 1688, isMobile: true, hasTouch: true },
};

const RICH = '/blogs/wiwi.blog/';
const SPARSE = '/blogs/seed-740/';
const TOPIC = '/topics/ai/';
const MENU = '[aria-controls="site-navigation"]';

export const STATES = [
  // Home
  { id: 'home', path: '/' },
  { id: 'home-dark', path: '/', theme: 'dark' },
  { id: 'home-signed-in', path: '/', session: 'in', viewportOnly: true },
  { id: 'home-empty', path: '/', data: 'empty' },
  { id: 'home-error', path: '/', data: 'error' },
  { id: 'home-loading', path: '/', navFrom: '/about/', navClick: 'header a[href="/"]', data: 'loading', viewportOnly: true },
  { id: 'menu-open', path: '/', click: [MENU], viewportOnly: true, only: 'mobile' },
  // Blog directory
  { id: 'blogs', path: '/blogs/' },
  { id: 'blogs-dark', path: '/blogs/', theme: 'dark' },
  { id: 'blogs-search', path: '/blogs/?q=%E6%97%85%E8%A1%8C' },
  { id: 'blogs-filter', path: '/blogs/?category=%E7%A7%91%E6%8A%80' },
  { id: 'blogs-no-results', path: '/blogs/?q=zzqxv' },
  { id: 'blogs-empty', path: '/blogs/', data: 'empty' },
  // One blog
  { id: 'blog', path: RICH },
  { id: 'blog-dark', path: RICH, theme: 'dark' },
  { id: 'blog-following', path: RICH, session: 'in', viewportOnly: true },
  { id: 'blog-sparse', path: SPARSE },
  { id: 'blog-not-found', path: '/blogs/no-such-blog-zzqxv/' },
  // Articles
  { id: 'articles', path: '/articles/' },
  { id: 'articles-search', path: '/articles/?q=%E5%90%8C%E6%A8%82%E6%9C%83' },
  { id: 'articles-no-results', path: '/articles/?q=zzqxv' },
  { id: 'articles-empty', path: '/articles/', data: 'empty' },
  // Topics
  { id: 'topics', path: '/topics/' },
  { id: 'topics-trending', path: '/topics/trending/' },
  { id: 'topics-dark', path: '/topics/', theme: 'dark' },
  { id: 'topics-loading', path: '/topics/', navFrom: '/about/', navClick: 'a[href="/topics/"]', data: 'loading', viewportOnly: true },
  { id: 'topics-empty', path: '/topics/', data: 'empty' },
  { id: 'topic', path: TOPIC },
  { id: 'topic-dark', path: TOPIC, theme: 'dark' },
  { id: 'topic-not-found', path: '/topics/zzqxv-no-such-topic/' },
  // Tags and ranking
  { id: 'tags', path: '/tags/' },
  { id: 'tags-selected', path: '/tags/?tag=%E9%83%A8%E8%90%BD%E6%A0%BC' },
  { id: 'tags-empty', path: '/tags/', data: 'empty' },
  { id: 'ranking', path: '/ranking/' },
  { id: 'ranking-dark', path: '/ranking/', theme: 'dark' },
  { id: 'ranking-empty', path: '/ranking/', data: 'empty' },
  // Relations
  { id: 'relations', path: '/relations/' },
  { id: 'relations-30', path: '/relations/?days=30' },
  { id: 'relations-loading', path: '/relations/', data: 'loading', streamOnly: true, viewportOnly: true },
  { id: 'relations-error', path: '/relations/', data: 'error' },
  // Account
  { id: 'my-signed-out', path: '/my/' },
  { id: 'my-signed-in', path: '/my/', session: 'in' },
  { id: 'login', path: '/login/' },
  { id: 'login-error', path: '/login/?error=failed' },
  // Information
  { id: 'about', path: '/about/' },
  { id: 'about-dark', path: '/about/', theme: 'dark' },
  { id: 'not-found', path: '/no-such-page/' },
];

// Reference sites: photographed once and reused in every round.
export const REFERENCES = [
  // Blog directories and discovery feeds a Taiwanese blog reader would compare this site with; no login needed.
  { id: 'blogblog-club', url: 'https://blogblog.club/', locale: 'zh-TW' },
  { id: 'ooh-directory-home', url: 'https://ooh.directory/' },
  { id: 'ooh-directory-recent', url: 'https://ooh.directory/updated/' },
  { id: 'blogroll-org', url: 'https://blogroll.org/' },
];

// Fixed clock: the snapshot's time (UTC 2026-11-12T18:20Z), so relative times never drift.
export const NOW = '2026-11-13T02:20:00+08:00';
