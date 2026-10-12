import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validPublicPayload } from '../src/lib/public-contracts.ts';
import { createPublicLoader } from '../src/lib/public-loader.ts';
import { isPublicApiPath, publicKindOf } from '../src/lib/public-paths.ts';
import { isHistoryCursor, topicApiPath } from '../src/lib/public-query.ts';
import { readPublic } from '../src/lib/public-read.ts';
import {
  evidenceLabel,
  type HistoryArticle,
  historyRows,
  historySummary,
  type TopicDetail,
  type TopicHistory,
  topicArticleMode,
  topicPageDescription,
} from '../src/lib/topics.ts';
import { EMPTY, json } from './public-payloads.ts';

const HASH = 'a'.repeat(64);
const STABLE = `tag:${HASH}`;
const article = (id: number, state: HistoryArticle['evidenceState'], extra: Record<string, unknown> = {}) =>
  ({
    id,
    title: `文章 ${id}`,
    url: `https://example.com/${id}`,
    publishedAt: '2026-01-02T03:04:05.000Z',
    blogSlug: 'a',
    blogName: '甲',
    evidenceState: state,
    observedAt: '2026-02-03T00:00:00.000Z',
    ...extra,
  }) as HistoryArticle;
const history = (articles: HistoryArticle[], more: Partial<TopicHistory> = {}): TopicHistory => ({
  articles,
  nextCursor: null,
  confirmed: articles.filter((a) => a.evidenceState === 'confirmed').length,
  pending: articles.filter((a) => a.evidenceState === 'pending').length,
  lastObservedAt: '2026-02-03T00:00:00.000Z',
  total: articles.length,
  ...more,
});
const detail = (more: Partial<TopicDetail> = {}) => ({ ...(structuredClone(EMPTY.topic) as TopicDetail), ...more });
const recent = { id: 9, title: '新文', url: 'https://example.com/9', publishedAt: null, blogSlug: 'a', blogName: '甲' };

test('history: a period without articles shows the topic history; recent articles keep the old view', () => {
  const past = history([article(1, 'confirmed'), article(2, 'pending')]);
  assert.equal(topicArticleMode(detail({ history: past })), 'history');
  assert.equal(topicArticleMode(detail({ articles: [recent], history: past })), 'recent');
  assert.equal(topicArticleMode(detail({ articles: [recent] })), 'recent');
});

test('history: no history (older payload, reads off) or an empty one keeps the old empty state', () => {
  assert.equal(topicArticleMode(detail()), 'empty');
  assert.equal(topicArticleMode(detail({ history: history([]) })), 'empty');
  // Only revoked/unknown evidence left: nothing to show, so the old empty state.
  assert.equal(topicArticleMode(detail({ history: history([article(3, 'revoked' as never)]) })), 'empty');
  assert.equal(validPublicPayload('topic', detail()), true, 'a payload without history stays valid');
});

test('history: confirmed and pending are labelled apart; pending never reads as a current match', () => {
  const pending = evidenceLabel('pending', '2026/2/3');
  assert.match(pending, /過去曾觀測到提及，待重新確認/);
  assert.match(pending, /觀測於 2026\/2\/3/);
  assert.doesNotMatch(pending, /目前|命中中/);
  const confirmed = evidenceLabel('confirmed', '2026/2/3');
  assert.notEqual(confirmed, pending);
  assert.match(confirmed, /觀測於 2026\/2\/3/);
  assert.equal(historySummary(history([article(1, 'confirmed'), article(2, 'pending')])), '共 2 篇（已確認 1 · 待重新確認 1）');
  assert.equal(historySummary({ total: 1200 }), '共 1,200 篇');
  assert.equal(historySummary({}), '');
});

test('history: rows carry title, original URL, blog and dates only, never article text', () => {
  const rows = historyRows(
    history([
      article(1, 'pending', { content: '全文', body: '全文', excerpt: '摘要', html: '<p>全文</p>', blogCanonicalPath: '/blogs/a/' }),
    ]),
  );
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    'blogCanonicalPath',
    'blogName',
    'blogSlug',
    'evidenceState',
    'id',
    'observedAt',
    'publishedAt',
    'title',
    'url',
  ]);
  assert.ok(!JSON.stringify(rows).includes('全文'));
  assert.deepEqual(historyRows(undefined), []);
  assert.deepEqual(historyRows(null), []);
});

test('history contract: rows need their fields; a malformed history fails the payload instead of rendering', () => {
  assert.equal(validPublicPayload('topic', detail({ history: history([article(1, 'confirmed')], { nextCursor: 'c1' }) })), true);
  for (const bad of [
    null,
    {},
    { articles: [], nextCursor: 3 },
    { articles: [{ id: 1, title: 't' }], nextCursor: null },
    { articles: null, nextCursor: null },
  ])
    assert.equal(validPublicPayload('topic', { ...detail(), history: bad }), false, JSON.stringify(bad));
});

test('history paging: reads use the stable id with days and historyCursor, never the readable canonical path', () => {
  const path = topicApiPath(STABLE, '30', 'eyJpZCI6MX0');
  assert.equal(path, `/api/topics/tag%3A${HASH}?days=30&historyCursor=eyJpZCI6MX0`);
  assert.equal(publicKindOf(path), 'topic');
  assert.equal(new URL(path, 'http://x').searchParams.get('historyCursor'), 'eyJpZCI6MX0', 'the cursor arrives unchanged');
  assert.ok(!path.includes('/topics/%E6'), 'not a readable key');
  // Without a cursor the path is the same as before.
  assert.equal(topicApiPath(STABLE, '7'), `/api/topics/tag%3A${HASH}?days=7`);
  // Other query keys stay outside the topic allowlist.
  assert.equal(isPublicApiPath(`/api/topics/tag%3A${HASH}?days=30&cursor=x`), false);
  assert.equal(isPublicApiPath(`/api/topics/tag%3A${HASH}?days=30&historyCursor=a&historyCursor=b`), false);
});

test('history paging: only base64url cursors of at most 256 characters (the gateway limit) are sent, and those pass the path rules', () => {
  const real = Buffer.from(JSON.stringify({ v: 1, topic: HASH, at: '2026-10-13T00:00:00.000Z', id: 1 })).toString('base64url');
  for (const cursor of ['abc', 'a_b-c', real, 'x'.repeat(256)]) {
    assert.equal(isHistoryCursor(cursor), true, cursor);
    assert.equal(isPublicApiPath(topicApiPath(STABLE, '90', cursor)), true, cursor);
    assert.equal(new URL(topicApiPath(STABLE, '90', cursor), 'http://x').searchParams.get('historyCursor'), cursor);
  }
  for (const cursor of ['', ' ', 'a b', 'a\nb', '中文', 'eyJ9==', 'a.b', 'a~b', '{"id":1}', '#?&/%', 'x'.repeat(257), null, 3, undefined])
    assert.equal(isHistoryCursor(cursor), false, String(cursor));
});

test('history paging: topic detail pages, cursors included, are never kept in the browser and are fetched no-store', async () => {
  const inits: Array<{ path: string; init: RequestInit }> = [];
  const loader = createPublicLoader({
    fetch: async (path, init) => {
      inits.push({ path, init });
      return json(200, detail());
    },
  });
  const signal = new AbortController().signal;
  const first = topicApiPath(STABLE, '90');
  const second = topicApiPath(STABLE, '90', 'Y3Vyc29yMQ');
  const third = topicApiPath(STABLE, '90', 'Y3Vyc29yMg');
  for (const path of [first, second, third, second]) assert.equal((await loader.load(path, (raw) => raw, signal))?.status, 'ready');
  assert.deepEqual(
    inits.map((call) => call.path),
    [first, second, third, second],
    'a page seen before is read again',
  );
  for (const { init } of inits) {
    assert.equal(init.cache, 'no-store');
    assert.equal(init.credentials, 'omit');
  }
});

test('topic detail in the browser: an article the gateway has since hidden is not served from an earlier answer', async () => {
  const answers = [detail({ articles: [recent] }), detail({ articles: [] })];
  const loader = createPublicLoader({ fetch: async () => json(200, answers.shift()) });
  const path = topicApiPath(STABLE, '7');
  const settled: unknown[] = [];
  const runner = loader.runner<unknown>((_, load) => settled.push(load));
  for (let i = 0; i < 2; i++) {
    runner.run(path, (raw) => raw);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(settled.length, 2);
  assert.equal((settled[0] as { data: TopicDetail }).data.articles.length, 1);
  assert.equal(answers.length, 0, 'the second view asked the gateway again');
  assert.deepEqual((settled[1] as { data: TopicDetail }).data.articles, []);
  // The ranking list is read again on every view as well: no public kind keeps a client TTL.
  const listAnswers = [EMPTY.topics, EMPTY.topics];
  const lists = createPublicLoader({ fetch: async () => json(200, listAnswers.shift()) });
  for (let i = 0; i < 2; i++) await lists.load('/api/topics?days=7', (raw) => raw, new AbortController().signal);
  assert.equal(listAnswers.length, 0);
});

test('410: the server read is "not found" (the page 404s, never 500); the browser shows it as gone', async () => {
  const fetcher = (async () => json(410, { error: 'topic revoked' })) as never;
  assert.deepEqual(await readPublic('http://gw', `/api/topics/tag%3A${HASH}?days=30`, fetcher, async () => {}), {
    found: false,
    gone: true,
  });
  const loader = createPublicLoader({ fetch: async () => json(410, { error: 'topic revoked' }) });
  assert.deepEqual(await loader.load(topicApiPath(STABLE, '7'), (raw) => raw, new AbortController().signal), { status: 'gone' });
});

test('topic page: metadata names no fixed period; the page is per-request, indexable and free of searchParams', () => {
  const description = topicPageDescription('旅行');
  assert.doesNotMatch(description, /近 ?30 ?天/);
  assert.match(description, /「旅行」/);
  const page = readFileSync(fileURLToPath(new URL('../src/app/topics/[id]/page.tsx', import.meta.url)), 'utf8');
  assert.match(page, /pageMetadata\(page\.canonicalPath, `「\$\{label\}」話題`, topicPageDescription\(label\)\)/);
  assert.doesNotMatch(page, /近 30 天台灣部落格/);
  assert.doesNotMatch(page, /searchParams|noindex|robots|export const revalidate/);
  assert.match(page, /export const dynamic = 'force-dynamic';/);
  assert.match(page, /if \(!page\) notFound\(\);/);
  assert.match(page, /if \(!data\?\.topic\) notFound\(\);/);
  // History pages are read by the stable id, as every other API read on the page.
  const view = readFileSync(fileURLToPath(new URL('../src/components/public/TopicDetail.tsx', import.meta.url)), 'utf8');
  assert.match(view, /topicApiPath\(id, days, cursor\)/);
  assert.doesNotMatch(view, /topicApiPath\(path/);
});
