import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  blogPath,
  breadcrumbSchema,
  canonicalPath,
  pageMetadata,
  SITE_TITLE,
  serializeJsonLd,
  shortText,
  topicPath,
} from '../src/lib/seo.ts';

test('canonicals are absolute, on blog.observe.tw, with one trailing slash and no query', () => {
  assert.equal(canonicalPath('/blogs'), '/blogs/');
  assert.equal(canonicalPath('/topics/?days=7'), '/topics/');
  assert.equal(canonicalPath('/'), '/');
  const meta = pageMetadata('/api/', 'API 文件', 'docs');
  assert.equal(meta.alternates.canonical, 'https://blog.observe.tw/api/');
  assert.equal(meta.openGraph.url, 'https://blog.observe.tw/api/');
  assert.deepEqual(meta.title, { absolute: 'API 文件 · 部落格觀察' });
  assert.equal(meta.twitter.title, 'API 文件 · 部落格觀察');
  assert.equal(meta.openGraph.images[0].url, 'https://blog.observe.tw/opengraph-image.png');
});

test('list pages do not lend each other a title or canonical', () => {
  const a = pageMetadata('/authors/', '文章作者', 'x');
  const b = pageMetadata('/articles/', '最新文章', 'y');
  assert.notEqual(a.alternates.canonical, b.alternates.canonical);
  assert.notDeepEqual(a.title, b.title);
});

test('the home page keeps the site title', () => {
  const meta = pageMetadata('/', null, 'home');
  assert.deepEqual(meta.title, { absolute: SITE_TITLE });
  assert.equal(meta.alternates.canonical, 'https://blog.observe.tw/');
});

test('detail paths percent-encode the slug or topic id once', () => {
  const hash = 'a'.repeat(64);
  assert.equal(topicPath(`tag:${hash}`), `/topics/tag%3A${hash}/`);
  assert.equal(blogPath('中文 站'), '/blogs/%E4%B8%AD%E6%96%87%20%E7%AB%99/');
  assert.equal(pageMetadata(topicPath(`tag:${hash}`), 'x', 'y').alternates.canonical, `https://blog.observe.tw/topics/tag%3A${hash}/`);
});

test('descriptions are one short line', () => {
  assert.equal(shortText('  a\n\tb  '), 'a b');
  assert.equal(shortText('x'.repeat(200), 10), `${'x'.repeat(9)}…`);
  assert.equal(shortText(null), '');
});

test('JSON-LD cannot close its script element', () => {
  const text = serializeJsonLd(breadcrumbSchema([['/blogs/x/', '</script><b>']]));
  assert.ok(!text.includes('<'));
  assert.equal(JSON.parse(text).itemListElement[1].name, '</script><b>');
  assert.equal(JSON.parse(text).itemListElement[0].item, 'https://blog.observe.tw/');
});
