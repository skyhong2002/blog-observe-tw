import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ACTION_EVENT,
  analyticsBlock,
  CLEAR_LOGIN_COMPLETED,
  classifyClick,
  DEFAULT_GA_ID,
  isBlogSlug,
  LOGIN_COMPLETED_COOKIE,
  loginCompleted,
  measurementId,
  OPT_OUT_EVENT,
  OPT_OUT_KEY,
  PAGE_TITLE,
  pageFields,
  publicPage,
  publicPageType,
  readOptOut,
  referrerOrigin,
  selectContentTarget,
  topicIdOf,
} from '../src/lib/analytics-consent.mts';
import { type AnalyticsDeps, installAnalytics } from '../src/lib/analytics-runtime.mts';
import { blogLink, topicLink } from '../src/lib/page-links.ts';
import { isSlug, isTopicId } from '../src/lib/public-query.ts';

const ORIGIN = 'https://blog.observe.tw';
const HASH = 'ab'.repeat(32);
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const reader = {
  production: true,
  hostname: 'blog.observe.tw',
  measurementId: DEFAULT_GA_ID,
  webdriver: false,
  userAgent: CHROME,
  optedOut: false,
  doNotTrack: null,
  globalPrivacyControl: false,
};

test('measurement ID: default when unset, off when explicitly empty, refused when malformed', () => {
  assert.equal(measurementId(undefined), 'G-VKWGDHDESV');
  assert.equal(measurementId(''), null);
  assert.equal(measurementId('G-ABC123XYZ'), 'G-ABC123XYZ');
  for (const bad of [' G-VKWGDHDESV', 'UA-1234-1', 'G-abc', 'G-VKWG"><script>', 'GTM-ABCD']) assert.equal(measurementId(bad), null);
});

test('only production blog.observe.tw with an ID measures', () => {
  assert.equal(analyticsBlock(reader), null);
  assert.equal(analyticsBlock({ ...reader, production: false }), 'environment');
  assert.equal(analyticsBlock({ ...reader, hostname: 'localhost' }), 'environment');
  assert.equal(analyticsBlock({ ...reader, hostname: 'tag.observe.tw' }), 'environment');
  assert.equal(analyticsBlock({ ...reader, measurementId: null }), 'environment');
});

test('automation, bots, DNT, GPC and opt-out never measure', () => {
  assert.equal(analyticsBlock({ ...reader, webdriver: true }), 'automation');
  for (const ua of ['HeadlessChrome/141', 'Chrome-Lighthouse', 'Playwright/1.5', 'Googlebot/2.1', 'bingbot/2.0', 'facebookexternalhit/1.1'])
    assert.equal(analyticsBlock({ ...reader, userAgent: `${CHROME} ${ua}` }), 'automation', ua);
  assert.equal(analyticsBlock({ ...reader, doNotTrack: '1' }), 'privacy');
  assert.equal(analyticsBlock({ ...reader, doNotTrack: 'yes' }), 'privacy');
  assert.equal(analyticsBlock({ ...reader, globalPrivacyControl: true }), 'privacy');
  assert.equal(analyticsBlock({ ...reader, optedOut: true }), 'opt-out');
  assert.equal(analyticsBlock({ ...reader, optedOut: null }), 'unreadable');
});

test('an unreadable choice fails closed', () => {
  assert.equal(readOptOut(null), null);
  assert.equal(
    readOptOut({
      getItem() {
        throw new Error('denied');
      },
    }),
    null,
  );
  assert.equal(readOptOut({ getItem: (key) => (key === OPT_OUT_KEY ? '1' : null) }), true);
  assert.equal(readOptOut({ getItem: () => null }), false);
});

test('only public pages without a query string are measurable', () => {
  assert.equal(publicPageType(`${ORIGIN}/`, ORIGIN), 'home');
  assert.equal(publicPageType(`${ORIGIN}/blogs/abc/`, ORIGIN), 'blog');
  assert.equal(publicPageType(`${ORIGIN}/topics/tag%3A${HASH}/`, ORIGIN), 'topic');
  assert.equal(publicPageType(`${ORIGIN}/api/status/`, ORIGIN), 'api_status');
  assert.equal(publicPageType('/articles/#x', ORIGIN), 'articles');
  assert.equal(publicPageType(`/blogs/${'a'.repeat(255)}/`, ORIGIN), 'blog');
  for (const href of [
    '/articles/?q=secret',
    '/articles/?',
    '/blogs/?sort=latest',
    '/topics/x/?days=30',
    '/auth/google',
    '/my/',
    '/me/feed.xml',
    '/admin/',
    '/login/',
    '/search/',
    '/observe/opt-out/',
    '/api/v1/posts',
    '/api/search',
    '/unknown/',
    'https://evil.example/',
  ])
    assert.equal(publicPageType(href, ORIGIN), null, href);
});

test('blog and topic segments: only published slug and id shapes, never free text', () => {
  for (const href of [
    '/blogs/alice%40example.com/',
    '/blogs/alice@example.com/',
    '/blogs/alice%40example.com',
    '/blogs/Alice/',
    '/blogs/%E4%B8%AD/',
    '/blogs/-abc/',
    '/blogs/a.b/',
    `/blogs/${'a'.repeat(256)}/`,
    '/blogs/abc/extra/',
    '/topics/private-email/',
    '/topics/private-email',
    '/topics/alice%40example.com/',
    '/topics/tag%3Aabc/',
    `/topics/tag%3A${'AB'.repeat(32)}/`,
    '/topics/rss%3A0/',
    '/topics/%ZZ/',
    `/topics/tag%3A${HASH}%2F/`,
  ])
    assert.equal(publicPageType(href, ORIGIN), null, href);
});

test('known paths match with or without the trailing slash; hits carry the canonical path', () => {
  const cases: Array<[string, string, string]> = [
    ['/about', 'about', '/about/'],
    ['/api/status', 'api_status', '/api/status/'],
    ['/blogs', 'blogs', '/blogs/'],
    ['/blogs/abc-1_x', 'blog', '/blogs/abc-1_x/'],
    [`/topics/tag%3A${HASH}`, 'topic', `/topics/tag%3A${HASH}/`],
    [`/topics/tag:${HASH}/`, 'topic', `/topics/tag%3A${HASH}/`],
    [`/topics/tag%3a${HASH}`, 'topic', `/topics/tag%3A${HASH}/`],
    ['/topics/rss:42', 'topic', '/topics/rss%3A42/'],
    ['/traffic', 'traffic', '/traffic/'],
    ['/tech', 'tech', '/tech/'],
    ['/tech/', 'tech', '/tech/'],
  ];
  for (const [href, type, path] of cases) {
    assert.deepEqual(publicPage(href, ORIGIN), { type, path }, href);
    assert.equal(pageFields(ORIGIN, publicPage(href, ORIGIN)!, '').page_location, ORIGIN + path);
  }
  // /tech/'s filters and pages are query strings: only the bare page is measured, like every static page.
  for (const href of ['/my', '/login', '/admin', '/observe/opt-out', '/api/v1/posts', '/auth/me', '/tech/?status=failed', '/tech/x/'])
    assert.equal(publicPage(href, ORIGIN), null, href);
});

test('the topic and blog shapes agree with the page routes', () => {
  for (const id of [`tag:${HASH}`, 'rss:1', 'rss:4294967295']) {
    assert.ok(isTopicId(id));
    assert.equal(topicIdOf(encodeURIComponent(id)), id);
  }
  for (const id of ['tag:x', 'rss:01', 'private-email', 'a@b.c']) {
    assert.equal(isTopicId(id), false);
    assert.equal(topicIdOf(encodeURIComponent(id)), null);
  }
  // Every analytics blog slug is also a slug the blog page will look up.
  for (const slug of ['a', 'abc-1', 'x_y', 'a'.repeat(255)]) assert.ok(isBlogSlug(slug) && isSlug(slug), slug);
  for (const slug of ['alice@example.com', 'Abc', '中文', 'a.b', 'a'.repeat(256), '']) assert.equal(isBlogSlug(slug), false, slug);
});

test('page fields carry origin + path, a fixed title and an origin-only referrer', () => {
  assert.deepEqual(pageFields(ORIGIN, publicPage(`${ORIGIN}/blogs/abc/#top`, ORIGIN)!, 'https://www.google.com/search?q=me'), {
    page_location: `${ORIGIN}/blogs/abc/`,
    page_title: PAGE_TITLE,
    page_referrer: 'https://www.google.com',
  });
  assert.equal(referrerOrigin(''), '');
  assert.equal(referrerOrigin('android-app://com.example/'), '');
  assert.equal(referrerOrigin('not a url'), '');
});

test('select_content sends only safe slugs or topic ids', () => {
  assert.deepEqual(selectContentTarget('/blogs/abc-1/'), { content_type: 'blog', content_id: 'abc-1' });
  assert.deepEqual(selectContentTarget('/blogs/%E4%B8%AD/'), { content_type: 'blog' });
  assert.deepEqual(selectContentTarget('/blogs/Me@x.tw/'), { content_type: 'blog' });
  assert.deepEqual(selectContentTarget(`/topics/tag%3A${HASH}/`), { content_type: 'topic', content_id: HASH });
  assert.deepEqual(selectContentTarget('/topics/rss%3A42/'), { content_type: 'topic', content_id: '42' });
  assert.deepEqual(selectContentTarget('/topics/%E8%A9%B1/'), { content_type: 'topic' });
  assert.deepEqual(selectContentTarget('/topics/%ZZ/'), { content_type: 'topic' });
  assert.equal(selectContentTarget('/topics/'), null);
  assert.equal(selectContentTarget('/tags/'), null);
});

test('clicks: SourceLink originals, RSS and internal content; nothing else', () => {
  assert.deepEqual(classifyClick('https://Example.com/post?id=1&email=a@b.c', 'open_original', ORIGIN, 'blog'), {
    name: 'open_original',
    params: { link_domain: 'example.com', source_page_type: 'blog' },
  });
  assert.equal(classifyClick('https://example.com/post', undefined, ORIGIN, 'blog'), null);
  assert.equal(classifyClick(`${ORIGIN}/blogs/a/`, 'open_original', ORIGIN, 'home')?.name, 'select_content');
  assert.equal(classifyClick('mailto:a@b.c', 'open_original', ORIGIN, 'home'), null);
  assert.deepEqual(classifyClick('/me/feed.xml', undefined, ORIGIN, 'home'), { name: 'rss_click' });
  assert.equal(classifyClick('/auth/google?next=%2Fmy%2F', undefined, ORIGIN, 'home'), null);
  assert.equal(classifyClick('/auth/google', undefined, ORIGIN, 'home'), null);
  assert.deepEqual(classifyClick('/blogs/abc/', undefined, ORIGIN, 'home'), {
    name: 'select_content',
    params: { content_type: 'blog', content_id: 'abc', source_page_type: 'home' },
  });
  assert.equal(classifyClick('/topics/x/?days=30', undefined, ORIGIN, 'home'), null);
  assert.equal(classifyClick('/api/blogs/abc/topics', undefined, ORIGIN, 'blog'), null);
  assert.equal(classifyClick('/tags/?tag=x', undefined, ORIGIN, 'home'), null);
});

// ---- runtime: a fake window, history and storage -------------------------

type Call = unknown[];
function fakeTarget() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  return {
    listeners,
    addEventListener(type: string, listener: (event: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string, event: Record<string, unknown> = {}) {
      for (const listener of listeners.get(type) ?? []) listener({ type, ...event } as unknown as Event);
    },
    count() {
      return [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
    },
  };
}
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    removeItem: (key: string) => void data.delete(key),
  };
}

function setup(start: string, options: { local?: ReturnType<typeof memoryStorage>; cookie?: string; noindex?: boolean } = {}) {
  let cookie = options.cookie ?? '';
  const cleared: string[] = [];
  let href = ORIGIN + start;
  const nativeCalls: string[] = [];
  const nativePush = (_d: unknown, _u: string, url?: string | URL | null) => {
    if (url != null) href = new URL(String(url), href).href;
    nativeCalls.push(href);
  };
  const history = { pushState: nativePush, replaceState: nativePush };
  const win = Object.assign(fakeTarget(), {}) as ReturnType<typeof fakeTarget> & Record<string, unknown>;
  const doc = fakeTarget();
  const local = options.local ?? memoryStorage();
  const scripts: string[] = [];
  const onloads: Array<() => void> = [];
  const deps: AnalyticsDeps = {
    id: DEFAULT_GA_ID,
    origin: ORIGIN,
    href: () => href,
    referrer: 'https://www.google.com/search?q=private',
    history,
    win,
    doc,
    localStorage: () => local,
    loadScript: (src, onload) => {
      scripts.push(src);
      onloads.push(onload);
    },
    cookie: () => cookie,
    clearLoginReceipt: () => {
      // What the browser does with CLEAR_LOGIN_COMPLETED.
      cleared.push(CLEAR_LOGIN_COMPLETED);
      cookie = cookie
        .split(';')
        .filter((part) => !part.trim().startsWith(`${LOGIN_COMPLETED_COOKIE}=`))
        .join(';');
    },
    noindex: () => options.noindex ?? false,
  };
  const layer = () => (win.dataLayer as IArguments[] | undefined)?.map((args) => [...args] as Call) ?? [];
  const disabled = () => win[`ga-disable-${DEFAULT_GA_ID}`];
  return {
    deps,
    history,
    nativePush,
    win,
    doc,
    local,
    cookie: () => cookie,
    scripts,
    layer,
    disabled,
    nativeCalls,
    cleared,
    /** gtag.js finished loading. */
    load: () => {
      for (const onload of onloads.splice(0)) onload();
    },
    setHref: (value: string) => {
      href = ORIGIN + value;
    },
    configs: () => layer().filter((c) => c[0] === 'config'),
    events: () => layer().filter((c) => c[0] === 'event'),
    sets: () => layer().filter((c) => c[0] === 'set'),
  };
}
const anchor = (href: string, marker?: string) => ({
  target: {
    closest: () => ({ getAttribute: (name: string) => (name === 'href' ? href : name === 'data-analytics' ? (marker ?? null) : null) }),
  },
  button: 0,
});

/**
 * What gtag.js does once loaded: wraps history (outside our wrapper) and
 * records, right after the native call, what its history page_view would
 * carry. It also listens to popstate after us.
 */
function google(t: ReturnType<typeof setup>) {
  const seen: Array<{ disabled: unknown; location?: string }> = [];
  const observe = () =>
    seen.push({ disabled: t.disabled(), location: (t.sets().at(-1)?.[1] as { page_location?: string })?.page_location });
  for (const method of ['pushState', 'replaceState'] as const) {
    const inner = t.history[method];
    t.history[method] = function (this: unknown, data, unused, url) {
      inner.call(this, data, unused, url);
      observe();
    };
  }
  t.win.addEventListener('popstate', observe);
  return seen;
}

test('a public landing page sends one config with safe fields, then loads gtag.js once', () => {
  const t = setup('/blogs/abc#x');
  const stop = installAnalytics(t.deps);
  assert.equal(t.disabled(), false);
  assert.equal(t.configs().length, 1);
  // No page_* in config scope: it would shadow later `set` updates.
  assert.deepEqual(t.configs()[0], ['config', DEFAULT_GA_ID]);
  assert.deepEqual(t.sets()[0][1], {
    page_location: `${ORIGIN}/blogs/abc/`,
    page_title: PAGE_TITLE,
    page_referrer: 'https://www.google.com',
  });
  // set comes before config, so the landing page_view carries the safe fields.
  const order = t.layer().map((c) => c[0]);
  assert.ok(order.indexOf('set') < order.indexOf('config'));
  assert.deepEqual(t.scripts, [`https://www.googletagmanager.com/gtag/js?id=${DEFAULT_GA_ID}`]);
  assert.equal(t.layer().filter((c) => c[0] === 'event' && c[1] === 'page_view').length, 0);
  stop();
});

test('a landing document marked noindex is not measured (extra guard)', () => {
  const t = setup('/blogs/abc/', { noindex: true });
  const stop = installAnalytics(t.deps);
  assert.equal(t.disabled(), true);
  assert.equal(t.scripts.length, 0);
  // Client navigation to another public page is judged by its path.
  t.history.pushState(null, '', '/blogs/');
  assert.equal(t.disabled(), false);
  t.history.pushState(null, '', '/blogs/abc/');
  assert.equal(t.disabled(), true);
  stop();
});

test('public SPA and back/forward navigation keep every view, guard first, never config again', () => {
  const t = setup('/');
  const stop = installAnalytics(t.deps);
  t.load();
  const seen = google(t);
  t.history.pushState(null, '', '/topics');
  assert.deepEqual(seen.at(-1), { disabled: false, location: `${ORIGIN}/topics/` });
  assert.deepEqual(t.sets().at(-1)?.[1], { page_location: `${ORIGIN}/topics/`, page_title: PAGE_TITLE, page_referrer: ORIGIN });
  t.history.pushState(null, '', '/blogs/');
  assert.deepEqual(seen.at(-1), { disabled: false, location: `${ORIGIN}/blogs/` });
  t.setHref('/topics/');
  t.win.dispatch('popstate');
  assert.deepEqual(seen.at(-1), { disabled: false, location: `${ORIGIN}/topics/` });
  t.setHref('/ranking');
  t.win.dispatch('popstate');
  assert.deepEqual(seen.at(-1), { disabled: false, location: `${ORIGIN}/ranking/` });
  // A state-only replaceState and a fragment change keep everything as is.
  const before = t.layer().length;
  t.history.replaceState({ scroll: 1 }, '');
  t.history.replaceState({ scroll: 2 }, '', `${ORIGIN}/ranking#top`);
  assert.equal(t.layer().length, before);
  assert.equal(t.disabled(), false);
  assert.equal(t.layer().filter((c) => c[0] === 'event' && c[1] === 'page_view').length, 0);
  assert.equal(t.configs().length, 1);
  assert.equal(t.scripts.length, 1);
  stop();
});

// Production finding: from /articles/?q=..., history.back() to /articles/
// made Google's history page_view carry dr=<the ?q URL> despite `set` and
// `config` page_referrer. The fake Google cannot model that engine; these
// tests pin the conservative rule (off for the rest of the document).
test('after config, any private, query or unknown URL taints the document: public returns stay off', () => {
  for (const away of ['/articles/?q=ga-privacy-test', '/my/', '/blogs/alice%40example.com/', '/topics/private-email/']) {
    const t = setup('/articles/');
    const stop = installAnalytics(t.deps);
    t.load();
    const seen = google(t);
    t.history.pushState(null, '', away);
    assert.equal(seen.at(-1)?.disabled, true, away);
    // history.back() to the public page, then onward to others.
    t.setHref('/articles/');
    t.win.dispatch('popstate');
    assert.equal(seen.at(-1)?.disabled, true, away);
    t.history.pushState(null, '', '/blogs/');
    t.history.replaceState(null, '', '/');
    assert.equal(seen.at(-1)?.disabled, true, away);
    t.doc.dispatch('click', anchor('https://example.com/a', 'open_original'));
    t.win.dispatch(ACTION_EVENT, { detail: 'follow' });
    t.win.dispatch('appinstalled');
    assert.equal(t.events().length, 0, away);
    assert.equal(t.configs().length, 1);
    assert.equal(t.scripts.length, 1);
    const text = JSON.stringify(t.layer());
    for (const secret of ['ga-privacy-test', 'alice', 'private-email', '/my/']) assert.ok(!text.includes(secret), secret);
    stop();
  }
});

test('taint while gtag.js is still loading: the late onload sends nothing and enables nothing', () => {
  const t = setup('/articles/', { cookie: `${LOGIN_COMPLETED_COOKIE}=1` });
  const stop = installAnalytics(t.deps);
  t.doc.dispatch('click', anchor('https://example.com/a', 'open_original'));
  t.history.pushState(null, '', '/articles/?q=x');
  t.setHref('/articles/');
  t.win.dispatch('popstate');
  assert.equal(t.disabled(), true);
  t.load();
  assert.equal(t.disabled(), true);
  assert.equal(t.events().length, 0);
  assert.ok(loginCompleted(t.cookie()), 'the login marker waits for a fresh document');
  t.history.pushState(null, '', '/blogs/');
  t.win.dispatch(ACTION_EVENT, { detail: 'follow' });
  assert.equal(t.events().length, 0);
  assert.equal(t.configs().length, 1);
  stop();

  // Onload arriving while unmounted, then a remount on the public page.
  const u = setup('/');
  const stop2 = installAnalytics(u.deps);
  u.history.pushState(null, '', '/login/');
  stop2();
  u.load();
  u.setHref('/');
  const again = installAnalytics(u.deps);
  assert.equal(u.disabled(), true);
  u.win.dispatch(ACTION_EVENT, { detail: 'follow' });
  assert.equal(u.events().length, 0);
  assert.equal(u.configs().length, 1);
  again();
});

test('a fresh full page load starts clean: only the referrer origin is kept', () => {
  const t = setup('/articles/');
  t.deps.referrer = `${ORIGIN}/articles/?q=ga-privacy-test`;
  const stop = installAnalytics(t.deps);
  assert.equal(t.disabled(), false);
  assert.equal((t.sets()[0][1] as { page_referrer: string }).page_referrer, ORIGIN);
  assert.ok(!JSON.stringify(t.layer()).includes('ga-privacy-test'));
  stop();
});

test('a private or query landing loads nothing until the first public page, which configs once', () => {
  const t = setup('/articles/?q=secret');
  const stop = installAnalytics(t.deps);
  assert.equal(t.disabled(), true);
  assert.equal(t.scripts.length, 0);
  assert.equal(t.layer().length, 0);
  t.history.pushState(null, '', '/login/');
  assert.equal(t.scripts.length, 0);
  t.history.pushState(null, '', '/tags/');
  assert.equal(t.disabled(), false);
  assert.equal(t.configs().length, 1);
  assert.equal(t.scripts.length, 1);
  // Configured now: a private page from here on taints the document.
  t.history.pushState(null, '', '/my/');
  t.history.pushState(null, '', '/');
  assert.equal(t.disabled(), true);
  assert.equal(t.configs().length, 1);
  stop();
});

test('opting out takes effect immediately and stays off for the document', () => {
  const t = setup('/');
  const stop = installAnalytics(t.deps);
  t.load();
  t.local.setItem(OPT_OUT_KEY, '1');
  t.win.dispatch(OPT_OUT_EVENT);
  assert.equal(t.disabled(), true);
  t.local.removeItem(OPT_OUT_KEY);
  t.history.pushState(null, '', '/blogs/');
  assert.equal(t.disabled(), true);
  t.doc.dispatch('click', anchor('/blogs/abc/'));
  assert.equal(t.events().length, 0);
  stop();
});

test('another tab: opt-out and localStorage.clear() (key null) are re-read; an unreadable choice disables', () => {
  const t = setup('/');
  const stop = installAnalytics(t.deps);
  t.win.dispatch('storage', { key: 'theme' });
  assert.equal(t.disabled(), false);
  // clear() elsewhere removed nothing that opts out: still counted.
  t.win.dispatch('storage', { key: null });
  assert.equal(t.disabled(), false);
  t.local.setItem(OPT_OUT_KEY, '1');
  t.win.dispatch('storage', { key: null });
  assert.equal(t.disabled(), true);
  stop();
  const u = setup('/');
  const stop2 = installAnalytics(u.deps);
  u.deps.localStorage = () => {
    throw new Error('denied');
  };
  u.win.dispatch('storage', { key: OPT_OUT_KEY });
  assert.equal(u.disabled(), true);
  stop2();
});

test('custom events only from public pages, with allowlisted parameters', () => {
  const t = setup('/blogs/abc/');
  const stop = installAnalytics(t.deps);
  t.load();
  t.doc.dispatch('click', anchor('https://example.com/2026/post?utm=x', 'open_original'));
  t.doc.dispatch('click', anchor('https://example.com/other'));
  t.doc.dispatch('click', anchor(`/topics/tag%3A${HASH}/`));
  t.doc.dispatch('click', anchor('/me/feed.xml'));
  t.doc.dispatch('auxclick', { ...anchor('/blogs/x/'), button: 2 });
  t.win.dispatch(ACTION_EVENT, { detail: 'follow' });
  t.win.dispatch(ACTION_EVENT, { detail: 'unfollow' });
  t.win.dispatch('appinstalled');
  assert.deepEqual(t.events(), [
    ['event', 'open_original', { link_domain: 'example.com', source_page_type: 'blog' }],
    ['event', 'select_content', { content_type: 'topic', content_id: HASH, source_page_type: 'blog' }],
    ['event', 'rss_click'],
    ['event', 'follow'],
    ['event', 'app_installed'],
  ]);
  t.history.pushState(null, '', '/my/');
  t.doc.dispatch('click', anchor('/blogs/abc/'));
  t.win.dispatch(ACTION_EVENT, { detail: 'follow' });
  assert.equal(t.events().length, 5);
  stop();
});

test('events before gtag.js loads wait locally; any suppression discards them so nothing replays', () => {
  const t = setup('/blogs/abc/');
  const stop = installAnalytics(t.deps);
  t.doc.dispatch('click', anchor('https://example.com/a', 'open_original'));
  assert.equal(t.events().length, 0, 'not queued in dataLayer before load');
  t.history.pushState(null, '', '/articles/?q=x');
  t.history.pushState(null, '', '/blogs/');
  t.load();
  assert.equal(t.events().length, 0, 'the query page dropped it');
  stop();

  const u = setup('/');
  const stop2 = installAnalytics(u.deps);
  u.win.dispatch(ACTION_EVENT, { detail: 'follow' });
  u.local.setItem(OPT_OUT_KEY, '1');
  u.win.dispatch(OPT_OUT_EVENT);
  u.load();
  assert.equal(u.events().length, 0, 'opt-out dropped it');
  stop2();

  const v = setup('/');
  const stop3 = installAnalytics(v.deps);
  v.doc.dispatch('click', anchor('/blogs/abc/'));
  v.history.pushState(null, '', '/blogs/abc/');
  v.load();
  assert.deepEqual(v.events(), [['event', 'select_content', { content_type: 'blog', content_id: 'abc', source_page_type: 'home' }]]);
  stop3();
});

test('login: only the exact gateway marker counts; the runtime never asks /auth/me', () => {
  const runtime = readFileSync(new URL('../src/lib/analytics-runtime.mts', import.meta.url), 'utf8');
  const component = readFileSync(new URL('../src/components/SiteAnalytics.tsx', import.meta.url), 'utf8');
  for (const text of [runtime, component]) assert.ok(!/fetch\(|\/auth\/me|signedIn/.test(text));
  assert.equal(loginCompleted(`${LOGIN_COMPLETED_COOKIE}=1`), true);
  assert.equal(loginCompleted(`theme=dark; ${LOGIN_COMPLETED_COOKIE}=1; x=y`), true);
  for (const cookie of [
    '',
    `x${LOGIN_COMPLETED_COOKIE}=1`,
    `${LOGIN_COMPLETED_COOKIE}=0`,
    `${LOGIN_COMPLETED_COOKIE}=`,
    `${LOGIN_COMPLETED_COOKIE}=1x`,
    `${LOGIN_COMPLETED_COOKIE}=true`,
    // The unprefixed name could be planted by a sibling subdomain; only the host-only one counts.
    'blog_login_completed=1',
  ])
    assert.equal(loginCompleted(cookie), false, cookie);
  // Deleted with the attributes the gateway sets it with.
  assert.equal(LOGIN_COMPLETED_COOKIE, '__Host-blog_login_completed');
  assert.equal(CLEAR_LOGIN_COMPLETED, '__Host-blog_login_completed=; Path=/; Max-Age=0; SameSite=Lax; Secure');
  const gateway = readFileSync(new URL('../../app/src/auth/google-login.ts', import.meta.url), 'utf8');
  assert.match(gateway, /LOGIN_COMPLETED_COOKIE = '__Host-blog_login_completed'/);
  assert.match(gateway, /Path=\/; Max-Age=\$\{completed \? 300 : 0\}; SameSite=Lax; Secure/);
});

test('login: no marker (sign-in link clicked, or a signed-in reader cancelled Google) sends nothing', () => {
  const t = setup('/login/?error=cancelled');
  const stop = installAnalytics(t.deps);
  t.history.pushState(null, '', '/');
  t.load();
  t.doc.dispatch('click', anchor('/auth/google?next=%2Fmy%2F'));
  t.doc.dispatch('click', anchor('/auth/google'));
  assert.equal(t.events().length, 0);
  assert.equal(t.cleared.length, 0);
  stop();
});

test('login: one event with method=google, deferred past a private return, marker deleted right after', () => {
  // The OAuth round trip returns to /my/ (private): not sent, marker kept.
  const t = setup('/my/', { cookie: `theme=dark; ${LOGIN_COMPLETED_COOKIE}=1` });
  const stop = installAnalytics(t.deps);
  assert.equal(t.events().length, 0);
  assert.ok(loginCompleted(t.cookie()));
  t.history.pushState(null, '', '/blogs/');
  // A public page, but gtag.js has not run yet: still waiting, marker kept.
  assert.equal(t.events().length, 0);
  assert.ok(loginCompleted(t.cookie()));
  t.load();
  assert.deepEqual(t.events(), [['event', 'login', { method: 'google' }]]);
  assert.equal(loginCompleted(t.cookie()), false);
  assert.deepEqual(t.cleared, [CLEAR_LOGIN_COMPLETED]);
  assert.equal(t.cookie().trim(), 'theme=dark');
  t.history.pushState(null, '', '/');
  assert.equal(t.events().length, 1);
  stop();
});

test('login: a marker seen while opted out is neither sent nor deleted', () => {
  const t = setup('/', { cookie: `${LOGIN_COMPLETED_COOKIE}=1`, local: memoryStorage({ [OPT_OUT_KEY]: '1' }) });
  const stop = installAnalytics(t.deps);
  t.load();
  t.history.pushState(null, '', '/blogs/');
  assert.equal(t.layer().length, 0);
  assert.ok(loginCompleted(t.cookie()));
  stop();
});

test('StrictMode remount: no duplicate config, script, wrappers or listeners; the guards stay for the document', () => {
  const t = setup('/');
  const stop = installAnalytics(t.deps);
  const ours = t.history.pushState;
  assert.notEqual(ours, t.nativePush);
  stop();
  assert.equal(t.history.pushState, ours, 'never restored: unmounted navigations must still be judged');
  assert.equal(t.win.count() + t.doc.count(), 1, 'only the document-long popstate watcher stays');
  assert.equal(t.disabled(), true, 'no handler between mounts: off');
  const again = installAnalytics(t.deps);
  assert.equal(t.history.pushState, ours, 'reused, not stacked');
  assert.equal(t.disabled(), false);
  assert.equal(t.configs().length, 1);
  assert.equal(t.scripts.length, 1);
  // gtag.js loads and wraps ours; the old mount goes away.
  t.load();
  const seen = google(t);
  const outer = t.history.pushState;
  again();
  assert.equal(t.history.pushState, outer);
  // The inert wrapper inside Google's is reused, not stacked, and guards again.
  const third = installAnalytics(t.deps);
  assert.equal(t.history.pushState, outer);
  assert.equal(t.disabled(), false);
  t.history.pushState(null, '', '/blogs/');
  assert.deepEqual(seen.at(-1), { disabled: false, location: `${ORIGIN}/blogs/` });
  assert.equal(t.configs().length, 1);
  assert.equal(t.scripts.length, 1);
  // Events on the remounted instance go straight to gtag (already loaded).
  t.win.dispatch(ACTION_EVENT, { detail: 'follow' });
  assert.deepEqual(t.events(), [['event', 'follow']]);
  assert.equal(t.win.count(), 6, 'ours (5) + the fake Google popstate listener');
  assert.equal(t.doc.count(), 2);
  third();
});

test('StrictMode remount after taint, or after navigations nobody judged, stays off', () => {
  // Tainted while mounted, remounted back on a public page.
  const t = setup('/');
  const stop = installAnalytics(t.deps);
  t.load();
  t.history.pushState(null, '', '/articles/?q=x');
  stop();
  t.setHref('/');
  const again = installAnalytics(t.deps);
  assert.equal(t.disabled(), true);
  t.history.pushState(null, '', '/blogs/');
  assert.equal(t.disabled(), true);
  assert.equal(t.configs().length, 1);
  again();

  // Unmounted: a private push, a popstate, or a URL that simply moved.
  const unjudged: Array<(u: ReturnType<typeof setup>) => void> = [
    (u) => {
      u.history.pushState(null, '', '/my/');
      u.history.pushState(null, '', '/');
    },
    (u) => {
      u.setHref('/articles/?q=x');
      u.win.dispatch('popstate');
      u.setHref('/');
      u.win.dispatch('popstate');
    },
    (u) => u.setHref('/blogs/'),
  ];
  for (const move of unjudged) {
    const u = setup('/');
    const first = installAnalytics(u.deps);
    u.load();
    const seen = google(u);
    first();
    move(u);
    assert.equal(seen.at(-1)?.disabled ?? true, true);
    const remount = installAnalytics(u.deps);
    assert.equal(u.disabled(), true);
    u.history.pushState(null, '', '/topics/');
    assert.equal(seen.at(-1)?.disabled, true);
    u.win.dispatch(ACTION_EVENT, { detail: 'follow' });
    assert.equal(u.events().length, 0);
    assert.equal(u.configs().length, 1);
    remount();
  }
});

test('unmounted before gtag.js loads: a private round trip back to the SAME URL still taints the late onload', () => {
  for (const away of ['/my/', '/articles/?q=ga-privacy-test']) {
    for (const method of ['pushState', 'replaceState'] as const) {
      const t = setup('/articles/', { cookie: `${LOGIN_COMPLETED_COOKIE}=1` });
      const first = installAnalytics(t.deps);
      assert.equal(t.configs().length, 1);
      // A click queued while gtag.js is still loading.
      t.doc.dispatch('click', anchor('https://example.com/a', 'open_original'));
      first();
      // Nothing (no gtag.js) wraps ours: it must still be in place.
      t.history[method](null, '', away);
      t.history[method](null, '', '/articles/');
      const remount = installAnalytics(t.deps);
      t.load();
      const state = t.win.__blogAnalytics as { tainted: boolean };
      assert.equal(state.tainted, true, `${away} ${method}`);
      assert.equal(t.disabled(), true, `${away} ${method}`);
      assert.equal(t.events().length, 0, 'no queued events, no login');
      assert.ok(loginCompleted(t.cookie()), 'the login marker is kept');
      assert.equal(t.cleared.length, 0);
      t.win.dispatch(ACTION_EVENT, { detail: 'follow' });
      t.history.pushState(null, '', '/blogs/');
      assert.equal(t.disabled(), true);
      assert.equal(t.events().length, 0);
      assert.equal(t.configs().length, 1);
      assert.ok(!JSON.stringify(t.layer()).includes('ga-privacy-test'));
      remount();
    }
  }
});

test('homepage original-article links carry the open_original marker, the /blogs/ fallback does not', () => {
  const page = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  // The recent-blogs entry only renders as a link for an external URL.
  assert.match(page, /<a\s+href=\{href\}\s+data-analytics="open_original"\s+rel="noopener noreferrer"/);
  // The body-citation rows: the source article links out only for a safe external URL; blog links never carry it.
  const mentions = readFileSync(new URL('../src/app/_home/HomeMentions.tsx', import.meta.url), 'utf8');
  assert.match(mentions, /const original = externalHref\(m\.postUrl\);/);
  assert.match(mentions, /<a href=\{original\} data-analytics="open_original" rel="noopener noreferrer">/);
  assert.equal(mentions.match(/data-analytics=/g)?.length, 1);
  // The retired hero/story image component keeps its marker should it be reused.
  const image = readFileSync(new URL('../src/app/_home/NewsImage.tsx', import.meta.url), 'utf8');
  assert.match(image, /data-analytics=\{analytics\}/);
});

test('the opt-out page is noindex; an empty ID never installs', () => {
  const page = readFileSync(new URL('../src/app/observe/opt-out/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /robots: \{ index: false/);
  assert.ok(!page.includes('alternates'));
  const component = readFileSync(new URL('../src/components/SiteAnalytics.tsx', import.meta.url), 'utf8');
  assert.match(component, /if \(block \|\| !GA_ID\) return;/);
  assert.equal(analyticsBlock({ ...reader, measurementId: measurementId('') }), 'environment');
});

// ---- readable page URLs (page-links.ts): not measured, links may declare a safe id ----

const READABLE_TOPIC = '/topics/%E6%97%85%E8%A1%8C/';
const linkTo = (href: string, contentId?: string) => ({
  target: {
    closest: () => ({
      getAttribute: (name: string) => (name === 'href' ? href : name === 'data-analytics-content-id' ? (contentId ?? null) : null),
    }),
  },
  button: 0,
});

test('readable topic and dotted/Unicode blog paths are not measured pages', () => {
  for (const path of [
    READABLE_TOPIC,
    '/topics/react/',
    '/topics/c.js/',
    '/blogs/example.com/',
    '/blogs/%E7%94%B2%E4%B9%99/',
    '/blogs/example.com-alice/',
  ])
    assert.equal(publicPage(ORIGIN + path, ORIGIN), null, path);
  // The prior safe shapes stay measurable.
  assert.equal(publicPageType(`${ORIGIN}/blogs/abc/`, ORIGIN), 'blog');
  assert.equal(publicPageType(`${ORIGIN}/topics/tag%3A${HASH}/`, ORIGIN), 'topic');
});

test('select_content: a declared id is used only when it is a stable ASCII slug, hash or RSS number', () => {
  assert.deepEqual(selectContentTarget(READABLE_TOPIC, HASH), { content_type: 'topic', content_id: HASH });
  assert.deepEqual(selectContentTarget(READABLE_TOPIC, '42'), { content_type: 'topic', content_id: '42' });
  assert.deepEqual(selectContentTarget('/blogs/example.com/', 'discovered-abc'), { content_type: 'blog', content_id: 'discovered-abc' });
  // Labels, titles, readable keys, URLs and emails never become content_id.
  for (const bad of ['旅行', `tag:${HASH}`, 'example.com', 'Alice', 'a@b.c', 'https://x.tw/', ''])
    for (const path of [READABLE_TOPIC, '/blogs/example.com/'])
      assert.equal(selectContentTarget(path, bad)?.content_id, undefined, `${path} ${bad}`);
  for (const bad of [`${HASH}x`, '0', 'abc', HASH.toUpperCase()])
    assert.equal(selectContentTarget(READABLE_TOPIC, bad)?.content_id, undefined, bad);
  // A blog slug does not become a topic id.
  assert.deepEqual(selectContentTarget(READABLE_TOPIC, 'abc'), { content_type: 'topic' });
});

test('runtime: clicks on readable links send select_content with the declared stable id; navigating there taints', () => {
  const t = setup('/topics/');
  const stop = installAnalytics(t.deps);
  t.load();
  t.doc.dispatch('click', linkTo(READABLE_TOPIC, HASH));
  t.doc.dispatch('click', linkTo('/blogs/example.com/', 'discovered-abc'));
  t.doc.dispatch('click', linkTo('/blogs/example.com/', '旅行'));
  assert.deepEqual(t.events(), [
    ['event', 'select_content', { content_type: 'topic', content_id: HASH, source_page_type: 'topics' }],
    ['event', 'select_content', { content_type: 'blog', content_id: 'discovered-abc', source_page_type: 'topics' }],
    ['event', 'select_content', { content_type: 'blog', source_page_type: 'topics' }],
  ]);
  const seen = google(t);
  t.history.pushState(null, '', READABLE_TOPIC);
  assert.equal(seen.at(-1)?.disabled, true);
  t.setHref('/topics/');
  t.win.dispatch('popstate');
  assert.equal(seen.at(-1)?.disabled, true, 'back to the list stays off: the readable path would be the referrer');
  assert.equal(t.configs().length, 1);
  const text = JSON.stringify(t.layer());
  for (const secret of ['%E6%97%85', '旅行', 'example.com']) assert.ok(!text.includes(secret), secret);
  stop();
});

test('page-links: link props carry only analytics-safe stable ids, never readable keys', () => {
  assert.deepEqual(blogLink('discovered-abc', '/blogs/example.com/'), {
    href: '/blogs/example.com/',
    'data-analytics-content-id': 'discovered-abc',
  });
  assert.deepEqual(blogLink('甲'), { href: '/blogs/%E7%94%B2/' });
  assert.deepEqual(topicLink(`tag:${HASH}`, READABLE_TOPIC), { href: READABLE_TOPIC, 'data-analytics-content-id': HASH });
  assert.deepEqual(topicLink('rss:42', undefined, '90'), { href: '/topics/rss%3A42/?days=90', 'data-analytics-content-id': '42' });
  // The detail page's own 30-day period is the bare canonical URL.
  assert.deepEqual(topicLink('rss:42', undefined, '30'), { href: '/topics/rss%3A42/', 'data-analytics-content-id': '42' });
  assert.deepEqual(topicLink('旅行'), { href: '/topics/%E6%97%85%E8%A1%8C/' });
});
