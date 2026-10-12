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
  assert.equal(data.blog.reason, '尚未完整取得', 'partial status with an unknown error reads as not fully fetched');
  assert.equal(data.blog.lastSuccessAt, null, 'unrecorded time stays null');
  assert.equal(data.blog.lastMethod, 'wordpress-api');
  assert.equal(data.blog.platform, 'wordpress');
  assert.deepEqual(data.sources[1], { status: 'blocked', source: 'article-html', completeness: null, count: null });
  assert.deepEqual(
    data.sources[2],
    { status: null, source: null, completeness: 'mystery', count: null },
    'unknown codes are not shown, -1 is not a count',
  );
});

test('reasons map to fixed reader phrases by group', () => {
  // Source restriction: robots / 401 / 403 / paywall only.
  assert.equal(reasonText('robots-disallow', 'missing'), '來源限制');
  assert.equal(reasonText('HTTP_403', 'partial'), '來源限制');
  assert.equal(reasonText('http-401', 'missing'), '來源限制');
  assert.equal(reasonText('paywall', 'partial'), '來源限制');
  // content-limit is our own length cap, never a source block — even if the status says blocked.
  assert.equal(reasonText('content-limit', 'partial'), '內容超過收錄長度上限');
  assert.equal(reasonText('content-limit', 'blocked'), '內容超過收錄長度上限');
  assert.notEqual(reasonText('content-limit', 'missing'), '來源限制');
  // Budget / deferral waits for the next run.
  assert.equal(reasonText('budget-deferred', 'missing'), '等待下次處理');
  assert.equal(reasonText('budget', 'pending'), '等待下次處理');
  assert.equal(reasonText('deferred', 'deferred'), '等待下次處理');
  assert.equal(reasonText('publisher-excerpt', 'partial'), '來源只提供部分內容');
  // Anything else falls back on the status.
  assert.equal(reasonText('timeout', 'missing'), '尚未取得');
  assert.equal(reasonText('timeout', 'partial'), '尚未完整取得');
  assert.equal(reasonText('rate-limit', 'missing'), '尚未取得');
  assert.equal(reasonText('http-4031', 'missing'), '尚未取得');
  assert.equal(reasonText(null, 'missing'), '尚未取得');
  assert.equal(reasonText('anything', 'blocked'), '來源限制');
  assert.equal(reasonText('anything', 'ok'), null);
  assert.equal(reasonText('content-limit', 'ok'), null);
  assert.equal(reasonText(null, 'pending'), null);
});

test('raw error strings never leak into the reason', () => {
  const raw = 'TypeError: fetch failed at https://example.test/secret?token=abc (/srv/app/worker.ts:42)';
  for (const current of ['missing', 'partial', 'blocked', 'deferred', 'pending', null] as const) {
    const text = reasonText(raw, current);
    assert.ok(text === null || ['尚未取得', '尚未完整取得', '來源限制'].includes(text), `${current}: ${text}`);
  }
  const data = normalizeContent({ blog: { status: 'missing', reason: raw, platform: 'MySecretCMS v2' } });
  const json = JSON.stringify(data);
  for (const leak of ['fetch failed', 'secret', 'token', '/srv/', 'MySecretCMS']) assert.ok(!json.includes(leak), leak);
});

test('unusable payloads read as unavailable', () => {
  for (const bad of [null, {}, { blog: 'x' }, []]) assert.equal(normalizeContent(bad), null);
  assert.deepEqual(normalizeContent({ blog: {} })?.sources, []);
});

test('labels', () => {
  assert.equal(completenessLabel('full'), '完整');
  assert.equal(completenessLabel('mystery'), null);
  const known = {
    generic: '一般網頁',
    wordpress: 'WordPress',
    blogger: 'Blogger',
    pixnet: '痞客邦',
    medium: 'Medium',
    substack: 'Substack',
    vocus: '方格子',
    matters: 'Matters',
    hugo: 'Hugo',
    jekyll: 'Jekyll',
  };
  for (const [code, text] of Object.entries(known)) assert.equal(platformLabel(code), text);
  assert.equal(platformLabel('Generic'), '一般網頁');
  assert.equal(normalizeContent({ blog: { platform: 'generic' } })?.blog.platform, 'generic');
  // Unknown values only ever read 尚未辨識, never the raw value.
  for (const unknown of ['<script>', 'custom-cms', 'constructor', '__proto__', 'unrecognized'])
    assert.equal(platformLabel(unknown), '尚未辨識', unknown);
  assert.equal(normalizeContent({ blog: { platform: 'custom-cms' } })?.blog.platform, 'unrecognized');
  assert.equal(platformLabel(null), null);
  assert.equal(platformLabel(''), null);
});
