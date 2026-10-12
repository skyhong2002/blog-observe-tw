import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  categoryName,
  chartable,
  countryName,
  defaultCompare,
  monthChange,
  monthsEnding,
  normalizeTraffic,
  pageOf,
  selectTraffic,
  stateOf,
  type TrafficBlog,
  trafficMonths,
  visitsAt,
} from '../src/lib/traffic.ts';

/** Shape of the gateway's /api/traffic, one blog per status. */
const fixture = {
  source: 'similarweb-extension',
  scope: 'domain',
  limitations: '整個網域的估算。',
  blogs: [
    {
      slug: 'ready',
      name: '甲部落格',
      domain: 'a.example',
      status: 'ready',
      fetchedAt: '2026-10-01T00:00:00Z',
      traffic: {
        monthly: [
          { month: '202608', visits: 2000 },
          { month: '202607', visits: 1000 },
          { month: '202609', visits: 3000 },
          { month: '2026-09', visits: 1 },
          { month: '202613', visits: 1 },
          { month: '202606', visits: -5 },
        ],
        globalRank: 120000,
        countryRank: { code: 'tw', rank: 900 },
        category: 'Lifestyle/Food',
        topCountries: [
          { code: 'US', share: 0.1 },
          { code: 'TW', share: 0.8 },
          { code: 'XX1', share: 0.1 },
          { code: 'JP', share: 2 },
        ],
      },
    },
    {
      slug: 'stale',
      name: '乙部落格',
      domain: 'b.example',
      status: 'unavailable',
      fetchedAt: '2026-09-01T00:00:00Z',
      traffic: { monthly: [{ month: '202609', visits: 0 }], globalRank: null, countryRank: null, category: null, topCountries: [] },
    },
    { slug: 'pending', name: '丙部落格', domain: 'c.example', status: 'pending', fetchedAt: null, traffic: null },
    { slug: 'blocked', name: '丁部落格', domain: 'd.example', status: 'blocked', fetchedAt: 'not a date', traffic: null },
    { slug: 'nodata', name: '戊部落格', domain: 'e.example', status: 'no-data', fetchedAt: null, traffic: null },
    { slug: 'weird', name: '己部落格', domain: 'f.example', status: 'exploded', fetchedAt: null, traffic: null },
    { slug: 'ready', name: '重複', domain: 'dup.example', status: 'ready', fetchedAt: null, traffic: null },
    { name: '沒有 slug', domain: 'g.example', status: 'ready' },
  ],
};

test('normalizeTraffic keeps only valid months, ranks and countries, and never invents values', () => {
  const data = normalizeTraffic(fixture);
  assert.ok(data);
  assert.deepEqual(
    data.blogs.map((b) => b.slug),
    ['ready', 'stale', 'pending', 'blocked', 'nodata', 'weird'],
  );
  const ready = data.blogs[0];
  assert.deepEqual(ready.traffic?.monthly, [
    { month: '202607', visits: 1000 },
    { month: '202608', visits: 2000 },
    { month: '202609', visits: 3000 },
  ]);
  assert.deepEqual(ready.traffic?.countryRank, { code: 'TW', rank: 900 });
  assert.deepEqual(
    ready.traffic?.topCountries.map((c) => c.code),
    ['TW', 'US'],
  );
  assert.equal(data.blogs[3].fetchedAt, null, 'unparseable dates are dropped');
  assert.equal(data.blogs[5].status, 'unavailable', 'unknown status reads as unavailable');
  assert.equal(data.blogs[2].traffic, null, 'pending blogs keep traffic null, not zero');
});

test('normalizeTraffic rejects payloads it cannot read', () => {
  for (const bad of [null, undefined, 'x', [], { blogs: 'no' }, { error: 'traffic unavailable' }])
    assert.equal(normalizeTraffic(bad), null);
  assert.deepEqual(normalizeTraffic({ blogs: [] })?.blogs, []);
});

test('states separate ready, kept old values, pending, blocked and no-data', () => {
  const data = normalizeTraffic(fixture);
  assert.ok(data);
  assert.deepEqual(data.blogs.map(stateOf), ['ready', 'stale', 'pending', 'blocked', 'no-data', 'unavailable']);
  const readyWithout: TrafficBlog = { ...data.blogs[2], status: 'ready', traffic: null };
  assert.equal(stateOf(readyWithout), 'unavailable');
});

test('month helpers: gaps stay null, a source-reported zero stays zero', () => {
  const data = normalizeTraffic(fixture);
  assert.ok(data);
  const [ready, stale, pending] = data.blogs;
  assert.deepEqual(trafficMonths(data.blogs), ['202607', '202608', '202609']);
  assert.equal(visitsAt(stale, '202609'), 0);
  assert.equal(visitsAt(stale, '202608'), null);
  assert.equal(visitsAt(pending, '202609'), null);
  assert.equal(monthChange(ready, '202609'), 0.5);
  assert.equal(monthChange(ready, '202607'), null);
  assert.equal(monthChange(stale, '202609'), null);
  const january: TrafficBlog = {
    ...ready,
    traffic: {
      ...(ready.traffic as NonNullable<TrafficBlog['traffic']>),
      monthly: [
        { month: '202512', visits: 100 },
        { month: '202601', visits: 50 },
      ],
    },
  };
  assert.equal(monthChange(january, '202601'), -0.5);
  assert.deepEqual(monthsEnding('202602', 3), ['202512', '202601', '202602']);
  assert.deepEqual(monthsEnding('', 3), []);
});

test('sorting keeps missing values last in both directions and filters by state and text', () => {
  const data = normalizeTraffic(fixture);
  assert.ok(data);
  const order = (ascending: boolean) =>
    selectTraffic(data.blogs, { sort: 'visits', ascending, month: '202609' })
      .map((b) => b.slug)
      .slice(0, 2);
  assert.deepEqual(order(false), ['ready', 'stale']);
  assert.deepEqual(order(true), ['stale', 'ready']);
  const ranked = selectTraffic(data.blogs, { sort: 'global', ascending: true, month: '202609' });
  assert.equal(ranked[0].slug, 'ready');
  assert.deepEqual(
    selectTraffic(data.blogs, { sort: 'name', ascending: true, month: '', state: 'blocked' }).map((b) => b.slug),
    ['blocked'],
  );
  assert.deepEqual(
    selectTraffic(data.blogs, { sort: 'name', ascending: true, month: '', query: 'C.EXAMPLE' }).map((b) => b.slug),
    ['pending'],
  );
});

test('pages hold at most 50 rows and clamp out-of-range pages', () => {
  const rows = Array.from({ length: 323 }, (_, i) => i);
  assert.equal(pageOf(rows, 1).rows.length, 50);
  assert.equal(pageOf(rows, 1).pages, 7);
  assert.deepEqual(pageOf(rows, 99).rows, rows.slice(300));
  assert.equal(pageOf(rows, 99).page, 7);
  assert.equal(pageOf(rows, -3).page, 1);
  assert.equal(pageOf([], 1).pages, 1);
});

test('only blogs with two or more real months are charted or compared by default', () => {
  const data = normalizeTraffic(fixture);
  assert.ok(data);
  assert.deepEqual(
    data.blogs.filter(chartable).map((b) => b.slug),
    ['ready'],
  );
  assert.deepEqual(defaultCompare(data.blogs), ['ready']);
});

test('labels', () => {
  assert.equal(countryName('TW'), '台灣');
  assert.equal(typeof countryName('JP'), 'string');
  assert.equal(categoryName('Lifestyle/Food'), '生活風格 / Food');
  assert.equal(categoryName('Pets_and_Animals'), 'Pets and Animals');
});
