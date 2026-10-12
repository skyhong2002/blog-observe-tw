import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completenessLabel, normalizeContent, platformLabel, reasonText } from '../src/lib/content-sources.ts';

/** Shape of the gateway's /api/blogs/:slug/content. */
const fixture = {
  blog: {
    slug: 'a',
    name: '甲',
    platform: 'wordpress',
    lastMethod: 'wordpress-api',
    status: 'partial',
    reason: 'Error: fetch failed\n    at /srv/app/private/rules.ts:12',
    lastAttemptAt: '2026-10-12T00:00:00Z',
    lastSuccessAt: null,
  },
  sources: [
    { status: 'ok', source: 'rss-content', completeness: 'full', count: 12 },
    { status: 'blocked', source: 'article-html', completeness: null, count: null },
    { status: 'weird', source: 'private-scraper', completeness: 'mystery', count: -1, body: 'PRIVATE' },
  ],
  publicContent: 'summary-only',
  privateBody: 'PRIVATE BODY',
};

test('normalizeContent keeps known fields only and never the raw reason or body', () => {
  const data = normalizeContent(fixture);
  assert.ok(data);
  const json = JSON.stringify(data);
  assert.ok(!json.includes('PRIVATE') && !json.includes('/srv/') && !json.includes('rules'));
  assert.equal(data.blog.reason, '尚未取得');
  assert.equal(data.blog.lastSuccessAt, null, 'unrecorded time stays null');
  assert.equal(data.blog.lastMethod, 'wordpress-api');
  assert.deepEqual(data.sources[1], { status: 'blocked', source: 'article-html', completeness: null, count: null });
  assert.deepEqual(
    data.sources[2],
    { status: null, source: null, completeness: 'mystery', count: null },
    'unknown codes are not shown, -1 is not a count',
  );
});

test('reasons map to two conservative phrases', () => {
  assert.equal(reasonText('robots-disallow', 'missing'), '來源限制');
  assert.equal(reasonText('HTTP_403', 'partial'), '來源限制');
  assert.equal(reasonText('timeout', 'missing'), '尚未取得');
  assert.equal(reasonText(null, 'missing'), '尚未取得');
  assert.equal(reasonText('anything', 'blocked'), '來源限制');
  assert.equal(reasonText('anything', 'ok'), null);
  assert.equal(reasonText(null, 'pending'), null);
});

test('unusable payloads read as unavailable', () => {
  for (const bad of [null, {}, { blog: 'x' }, []]) assert.equal(normalizeContent(bad), null);
  assert.deepEqual(normalizeContent({ blog: {} })?.sources, []);
});

test('labels', () => {
  assert.equal(completenessLabel('full'), '完整');
  assert.equal(completenessLabel('mystery'), null);
  assert.equal(platformLabel('pixnet'), '痞客邦');
  assert.equal(platformLabel('<script>'), null);
});
