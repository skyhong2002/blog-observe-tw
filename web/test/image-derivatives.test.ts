import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  afterImageError,
  articleImageSources,
  ICON_IMAGE_SIZES,
  iconImageSources,
  imageAttempt,
  missedImageEvent,
  POST_IMAGE_WIDTHS,
  postImageId,
  type SettledImage,
} from '../src/lib/images.ts';
import { localFaviconRevision, mediaIconSource } from '../src/lib/media-icons.ts';

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const original = 'https://img.example.com/a.jpg';

test('post derivatives: one requested width, no w srcSet claiming widths a small original lacks', () => {
  assert.deepEqual(POST_IMAGE_WIDTHS, [160, 320, 640, 960]);
  for (const width of POST_IMAGE_WIDTHS) {
    const sources = articleImageSources(42, original, width);
    assert.deepEqual(sources, { src: `/images/posts/42/${width}.webp`, fallback: original });
    // Nothing the <img> receives may carry a width descriptor.
    assert.deepEqual(Object.keys(imageAttempt(sources, false) ?? {}).sort(), ['last', 'src']);
    assert.deepEqual(Object.keys(imageAttempt(sources, true) ?? {}).sort(), ['last', 'src']);
  }
});

test('no image means nothing to render, even with a valid post ID', () => {
  for (const bad of [
    null,
    undefined,
    '',
    '  ',
    '/relative.jpg',
    'http://img.example.com/a.jpg',
    'javascript:alert(1)',
    'https://127.0.0.1/a.jpg',
  ]) {
    assert.equal(articleImageSources(42, bad, 640), null, String(bad));
    assert.equal(imageAttempt(articleImageSources(42, bad, 640), false), null, String(bad));
  }
});

test('a missing or invalid post ID keeps the original URL only; no ID is invented', () => {
  for (const id of [undefined, null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '42', '1/../2', {}]) {
    assert.equal(postImageId(id), null, String(id));
    assert.deepEqual(articleImageSources(id, original, 640), { src: original, fallback: null }, String(id));
  }
  assert.equal(postImageId(1), 1);
});

test('fallback: derivative, then the original exactly once, then the caller drops the image', () => {
  const sources = articleImageSources(42, original, 320);
  const first = imageAttempt(sources, false);
  assert.deepEqual(first, { src: '/images/posts/42/320.webp', last: false });
  const second = imageAttempt(sources, true);
  assert.deepEqual(second, { src: original, last: true });
  // Simulate every attempt failing: at most two requests, one final error.
  let failed = false;
  let finalErrors = 0;
  const tried: string[] = [];
  for (let i = 0; i < 10; i++) {
    const attempt = imageAttempt(sources, failed);
    if (!attempt || finalErrors) break;
    tried.push(attempt.src);
    if (attempt.last) finalErrors++;
    else failed = true;
  }
  assert.deepEqual(tried, ['/images/posts/42/320.webp', original]);
  assert.equal(finalErrors, 1);
  // Without an ID the original is the only and final attempt.
  assert.deepEqual(imageAttempt(articleImageSources(undefined, original, 320), false), { src: original, last: true });
});

/** A server-rendered <img> as image-events.ts sees it. */
const img = (src: string, complete: boolean, naturalWidth = 0): SettledImage => ({
  complete,
  naturalWidth,
  getAttribute: (name) => (name === 'src' ? src : null),
});

test('missed events: only a settled image showing the current src is replayed', () => {
  const derivative = '/images/posts/42/320.webp';
  assert.equal(missedImageEvent(img(derivative, true, 0), derivative), 'error');
  assert.equal(missedImageEvent(img(derivative, true, 320), derivative), 'load');
  assert.equal(missedImageEvent(img(derivative, false), derivative), null, 'still loading: the real event will come');
  assert.equal(missedImageEvent(img(derivative, true, 0), original), null, 'another src: not this attempt');
  assert.equal(missedImageEvent(null, derivative), null);
  assert.equal(missedImageEvent(img(derivative, true, 0), null), null);
});

/**
 * SafeImage plus its wrapper (NewsImage / ArticleThumbnail) driven by events:
 * `mount` is the post-hydration effect (replays a missed event), `fire` is a
 * real error event on the element that showed `src`. Requests are counted per
 * mounted element, as the browser does.
 */
function harness(id: unknown) {
  const sources = articleImageSources(id, original, 320);
  let failed: string | null = null;
  let wrapper: 'loading' | 'error' = 'loading';
  let finalErrors = 0;
  const requests: string[] = [];
  const shown = () => (wrapper === 'error' ? null : (imageAttempt(sources, failed !== null && failed === sources?.src)?.src ?? null));
  const fire = (src: string) => {
    if (wrapper === 'error') return; // unmounted: React delivers nothing
    const next = afterImageError(sources, failed, src);
    if (next.final) {
      finalErrors++;
      wrapper = 'error';
    } else failed = next.failed;
  };
  const mount = (settled: boolean) => {
    const src = shown();
    if (!src) return;
    requests.push(src);
    if (missedImageEvent(img(src, settled), src) === 'error') fire(src);
  };
  return { mount, fire, shown, state: () => ({ wrapper, finalErrors, requests }) };
}

test('pre-hydration failure is replayed once, falls back to the original, then drops the wrapper', () => {
  const h = harness(42);
  const derivative = '/images/posts/42/320.webp';
  h.mount(true); // the SSR derivative already failed before hydration
  assert.equal(h.shown(), original);
  h.fire(derivative); // a late real event for the old element changes nothing
  h.fire(derivative);
  assert.equal(h.shown(), original);
  h.mount(true); // the original also failed before its effect ran
  h.fire(original); // plus its late real event
  h.fire(original);
  assert.deepEqual(h.state(), { wrapper: 'error', finalErrors: 1, requests: [derivative, original] });
  assert.equal(h.shown(), null);
  h.mount(true); // nothing left to mount: no third request, no loop
  assert.deepEqual(h.state().requests, [derivative, original]);
});

test('post-hydration failures follow the same two steps; no ID means one attempt', () => {
  const h = harness(42);
  h.mount(false);
  h.fire('/images/posts/42/320.webp');
  h.mount(false);
  assert.equal(h.state().wrapper, 'loading');
  h.fire(original);
  assert.deepEqual(h.state(), { wrapper: 'error', finalErrors: 1, requests: ['/images/posts/42/320.webp', original] });

  const plain = harness(undefined);
  plain.mount(true);
  plain.fire(original);
  assert.deepEqual(plain.state(), { wrapper: 'error', finalErrors: 1, requests: [original] });
});

test('icon derivatives cover 1x-3x with the endpoint sizes and reject unsafe slugs', () => {
  assert.deepEqual(ICON_IMAGE_SIZES, [16, 32, 64, 96]);
  assert.deepEqual(iconImageSources('kocpc', 14), {
    src: '/images/icons/kocpc/16.webp',
    srcSet: '/images/icons/kocpc/16.webp 1x, /images/icons/kocpc/32.webp 2x, /images/icons/kocpc/64.webp 3x',
  });
  assert.deepEqual(iconImageSources('a', 32, 'r1'), {
    src: '/images/icons/a/32.webp?v=r1',
    srcSet: '/images/icons/a/32.webp?v=r1 1x, /images/icons/a/64.webp?v=r1 2x, /images/icons/a/96.webp?v=r1 3x',
  });
  assert.equal(iconImageSources('a', 32, 'bad rev&x=1')?.src, '/images/icons/a/32.webp');
  for (const slug of ['', '../x', 'a/b', 'a.png', '-a', 'a b', '%2e', 'a'.repeat(161)])
    assert.equal(iconImageSources(slug, 16), null, slug);
  for (const px of [0, -1, Number.NaN]) assert.equal(iconImageSources('a', px), null, String(px));
});

test("only this site's stored favicon for the same slug counts as local", () => {
  assert.equal(localFaviconRevision('a', '/favicons/a.png'), '');
  assert.equal(localFaviconRevision('a', '/favicons/a.png?v=r1'), 'r1');
  assert.equal(localFaviconRevision('a', 'https://blog.observe.tw/favicons/a.png?v=r1'), 'r1');
  for (const url of [
    null,
    'https://evil.example/favicons/a.png',
    'https://blog.observe.tw.evil.example/favicons/a.png',
    'https://a.example.com/favicon.png',
    '/favicons/b.png',
    '/favicons/a.ico',
    '/favicons/a.png?v=1&x=2',
    '/favicons/a.png#x',
    '/favicons/sub/a.png',
  ]) {
    assert.equal(localFaviconRevision('a', url), null, String(url));
  }
});

test('media icons: derivative first, then the stored PNG, then a foreign iconUrl, then the glyph', () => {
  const manifest = { a: { revision: 'r2', dark: 'invert' as const } };
  const derived = mediaIconSource('a', manifest, null, [], 14);
  assert.deepEqual(derived, {
    src: '/images/icons/a/16.webp?v=r2',
    srcSet: '/images/icons/a/16.webp?v=r2 1x, /images/icons/a/32.webp?v=r2 2x, /images/icons/a/64.webp?v=r2 3x',
    local: true,
  });
  assert.deepEqual(mediaIconSource('a', manifest, null, [derived?.src ?? ''], 14), { src: '/favicons/a.png?v=r2', local: true });
  assert.equal(mediaIconSource('a', manifest, null, [derived?.src ?? '', '/favicons/a.png?v=r2'], 14), null);

  // Server render: the payload iconUrl on this site is used through its derivative.
  const payload = 'https://blog.observe.tw/favicons/a.png?v=r1';
  assert.equal(mediaIconSource('a', {}, payload, [], 32)?.src, '/images/icons/a/32.webp?v=r1');
  assert.deepEqual(mediaIconSource('a', {}, payload, ['/images/icons/a/32.webp?v=r1'], 32), { src: payload, local: false });

  // A foreign favicon is never passed off as a local derivative.
  const foreign = 'https://a.example.com/favicon.png';
  assert.deepEqual(mediaIconSource('a', {}, foreign, [], 14), { src: foreign, local: false });
  assert.deepEqual(mediaIconSource('b', {}, payload, [], 14), { src: payload, local: false });
  assert.equal(mediaIconSource('a', {}, foreign, [foreign], 14), null);
  assert.equal(mediaIconSource('a', {}, null, [], 14), null);
});

test('homepage hero title and summary are server-rendered, not gated on hydration or the image', () => {
  const page = source('app/page.tsx');
  assert.ok(!/^['"]use client['"]/m.test(page), 'page.tsx stays a server component');
  assert.match(page, /export const revalidate = 120;/);
  assert.ok(!/\b(dynamic|Suspense|useEffect|useState)\b/.test(page));
  const hero = page.slice(page.indexOf('<article className={styles.hero}>'), page.indexOf('</article>'));
  const content = hero.slice(hero.indexOf('<div className={styles.heroContent}>'));
  assert.match(content, /\{lead\.title\}/);
  assert.match(content, /\{plainText\(lead\.summary\)\}/);
  // The image is a sibling before the text, never a wrapper around it.
  assert.match(hero, /<NewsImage[\s\S]*?\/>\s*<div className=\{styles\.heroContent\}>/);
  const css = readFileSync(new URL('../src/app/_home/home.module.css', import.meta.url), 'utf8');
  const heroRules = css.split('\n').filter((line) => /\.hero(Content|Badge)?\b|\.heroLink/.test(line));
  for (const line of heroRules) assert.ok(!/animation|opacity:\s*0|visibility:\s*hidden/.test(line), line);
  // MastheadCloud renders its SVG on the server.
  assert.ok(!/^['"]use client['"]/m.test(source('app/_home/MastheadCloud.tsx')));
});

test('image loading hints: eager/high hero, lazy thumbnails and icons, derivative IDs passed', () => {
  const page = source('app/page.tsx');
  assert.match(page, /<NewsImage\s+src=\{lead\.imageUrl\}\s+postId=\{lead\.id\}/);
  assert.match(page, /src=\{post\.imageUrl\}\s+postId=\{post\.id\}/);
  assert.match(source('components/ArticleListItem.tsx'), /<ArticleThumbnail src=\{article\.image\} postId=\{article\.id\}/);
  // Every homepage icon gets the payload logo for its own slug from the same response.
  const icons = page.match(/<BlogIcon [^>]*\/>/g) ?? [];
  assert.equal(icons.length, 4);
  for (const icon of icons) assert.match(icon, /media=\{([\w.]+)\} iconUrl=\{iconUrls\.get\(\1\)\}/, icon);

  const news = source('app/_home/NewsImage.tsx');
  assert.match(news, /fetchPriority=\{priority \? 'high' : undefined\}/);
  assert.match(news, /loading=\{priority \? 'eager' : 'lazy'\}/);
  assert.match(news, /srcWidth=\{priority \? 640 : 320\}/);

  const thumb = source('components/ArticleThumbnail.tsx');
  assert.match(thumb, /loading="lazy"/);
  assert.match(thumb, /srcWidth=\{160\}/);

  const safe = source('components/SafeImage.tsx');
  assert.match(safe, /decoding="async"/);
  assert.match(safe, /referrerPolicy="no-referrer"/);
  assert.ok(!/from 'next\/image'|unoptimized/.test(safe), 'derivatives never go through the Next image proxy');

  const icon = source('components/MediaIcon.tsx');
  assert.match(icon, /loading="lazy"/);
  assert.match(icon, /decoding="async"/);
  assert.match(icon, /source\.local \? mediaIconClass\(media, icons\)/);
  assert.match(icon, /Array\.from\(title \|\| media\)\[0\]/);
  assert.ok(!/from 'next\/image'/.test(icon));
});
