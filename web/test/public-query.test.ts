import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CatalogQuery } from '../src/lib/api.ts';
import { isPublicApiPath } from '../src/lib/public-paths.ts';
import {
  authorApiPath,
  authorQueryOf,
  catalogApiPath,
  catalogFiltersOf,
  catalogQueryOf,
  decodeParam,
  isAuthorBaseline,
  isAuthorId,
  isCatalogBaseline,
  isSlug,
  isTopicId,
  periodOf,
  profileQueryOf,
  RELATIONS_PERIOD,
  relationsApiPath,
  TOPICS_PERIOD,
  tagApiPath,
  topicApiPath,
  topicsApiPath,
} from '../src/lib/public-query.ts';
import { NO_SEARCH, searchParamsOf, searchPath } from '../src/lib/search.ts';

const q = (search: string) => new URLSearchParams(search);
// The gateway's own normaliser (plain JS, no imports), to keep the pending view's filters in step with it.
const gatewayCatalog = new URL('../../app/src/catalog.js', import.meta.url).href;
const { catalogFilters } = (await import(gatewayCatalog)) as { catalogFilters: (query: CatalogQuery) => unknown };

test('catalog query: only catalog keys, first value, and no query is the prerendered baseline', () => {
  assert.deepEqual(catalogQueryOf(q('')), {});
  assert.equal(isCatalogBaseline(catalogQueryOf(q(''))), true);
  assert.equal(isCatalogBaseline(catalogQueryOf(q('utm_source=x&fbclid=y'))), true);
  const asked = catalogQueryOf(q('q=%E5%92%96%E5%95%A1&sort=latest&dir=desc&page=2&page=9&utm=1'));
  assert.deepEqual(asked, { q: '咖啡', sort: 'latest', dir: 'desc', page: '2' });
  assert.equal(isCatalogBaseline(asked), false);
  // An empty value still asks (links keep q= so the page stays shareable).
  assert.equal(isCatalogBaseline(catalogQueryOf(q('q='))), false);
});

test('catalog query: same-origin path is stable and public', () => {
  assert.equal(catalogApiPath({}), '/api/catalog');
  assert.equal(catalogApiPath({ page: '2', q: 'a b', sort: 'name' }), '/api/catalog?q=a+b&sort=name&page=2');
  assert.equal(catalogApiPath({ limit: '1' }), '/api/catalog?limit=1');
  for (const search of ['', 'q=%3Cscript%3E&category=%E6%97%85&status=x', `q=${'長'.repeat(400)}`])
    assert.equal(isPublicApiPath(catalogApiPath(catalogQueryOf(q(search)))), true, search);
});

test('catalog query: pending filters match the gateway normaliser', () => {
  for (const search of [
    '',
    'sort=posts',
    'sort=status',
    'sort=bogus&dir=sideways',
    'sort=latest&dir=asc',
    'q=%20%20咖啡%20&category=旅行&status=已核對',
    'page=0&limit=500',
    'page=abc&limit=-1',
    'page=99999999999999999999',
    `q=${'長'.repeat(150)}`,
  ]) {
    const asked = catalogQueryOf(q(search));
    assert.deepEqual(catalogFiltersOf(asked), catalogFilters(asked), search);
  }
});

test('author query: ids the gateway accepts, baseline without keys', () => {
  assert.deepEqual(authorQueryOf(q('author=12&page=3&x=1')), { author: '12', page: '3' });
  assert.equal(isAuthorBaseline(authorQueryOf(q('ref=home'))), true);
  assert.equal(isAuthorBaseline(authorQueryOf(q('page=1'))), false);
  for (const id of ['1', '42', '2147483647']) assert.equal(isAuthorId(id), true, id);
  for (const id of ['0', '01', '-1', '1.5', 'abc', '', '2147483648', '1e3']) assert.equal(isAuthorId(id), false, id);
  assert.equal(authorApiPath({}), '/api/catalog/authors');
  assert.equal(authorApiPath({ page: '2', author: '7' }), '/api/catalog/authors?author=7&page=2');
  assert.equal(isPublicApiPath(authorApiPath({ author: '7', page: '2', limit: '20' })), true);
});

test('periods: 7/30/90 only, each page keeps its own default', () => {
  assert.equal(TOPICS_PERIOD, '30');
  assert.equal(RELATIONS_PERIOD, '90');
  assert.equal(periodOf(q(''), TOPICS_PERIOD), '30');
  assert.equal(periodOf(q('days=7'), TOPICS_PERIOD), '7');
  assert.equal(periodOf(q('days=90'), TOPICS_PERIOD), '90');
  assert.equal(periodOf(q('days=365'), RELATIONS_PERIOD), '90');
  assert.equal(periodOf(q('days=7&days=30'), RELATIONS_PERIOD), '7');
  for (const days of ['7', '30', '90'] as const) {
    assert.equal(isPublicApiPath(topicsApiPath(days)), true);
    assert.equal(isPublicApiPath(relationsApiPath(days)), true);
  }
});

test('topic ids: only the gateway shapes are looked up', () => {
  const hash = 'a'.repeat(64);
  for (const id of ['rss:1', 'rss:1234567890', `tag:${hash}`]) {
    assert.equal(isTopicId(id), true, id);
    assert.equal(isPublicApiPath(topicApiPath(id, '30')), true, id);
  }
  for (const id of ['rss:0', 'rss:12345678901', 'tag:abc', `tag:${'A'.repeat(64)}`, '../me', 'rss:1/x', ''])
    assert.equal(isTopicId(id), false, id);
  assert.equal(topicApiPath('rss:12', '7'), '/api/topics/rss%3A12?days=7');
  assert.equal(decodeParam('rss%3A12'), 'rss:12');
  assert.equal(decodeParam('rss:12'), 'rss:12');
  assert.equal(decodeParam('%E0%A4%A'), '%E0%A4%A');
});

test('slugs: one bounded path segment; tag paths stay public', () => {
  for (const slug of ['some-blog', '旅行', 'a.b_c', 'x'.repeat(255)]) {
    assert.equal(isSlug(slug), true, slug);
    assert.equal(isPublicApiPath(tagApiPath(slug)), true, slug);
  }
  for (const slug of ['', 'a/b', '..\\x', 'a b', 'a?b', 'a#b', 'x'.repeat(256), 'a\nb'])
    assert.equal(isSlug(slug), false, JSON.stringify(slug));
});

test('blog profile filter and article search read the same URL as before', () => {
  assert.equal(profileQueryOf(q('q=%E5%92%96%E5%95%A1')), '咖啡');
  assert.equal(profileQueryOf(q('')), '');
  assert.equal(profileQueryOf(q(`q=${'a'.repeat(150)}`)).length, 100);
  const params = q('q=%20咖啡%20&page=2&blog=a-b');
  const asked = searchParamsOf({
    q: params.get('q') ?? undefined,
    page: params.get('page') ?? undefined,
    blog: params.get('blog') ?? undefined,
  });
  assert.deepEqual(asked, { q: '咖啡', page: 2, blog: 'a-b' });
  assert.equal(isPublicApiPath(searchPath(asked)), true);
  assert.deepEqual(searchParamsOf({}), NO_SEARCH);
});
