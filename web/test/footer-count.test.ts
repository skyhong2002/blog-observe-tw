import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { validPublicPayload } from '../src/lib/public-contracts.ts';
import { publicKindOf } from '../src/lib/public-paths.ts';
import { PublicGatewayError, readPublic } from '../src/lib/public-read.ts';
import { json } from './public-payloads.ts';

const PATH = '/api/collection-count';
const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

test('footer count has an exact public path without query parameters', () => {
  assert.equal(publicKindOf(PATH), 'collectionCount');
  for (const path of [
    `${PATH}?limit=1`,
    `${PATH}?view=home`,
    `${PATH}?x=1&x=2`,
    `${PATH}?`,
    `${PATH}/`,
    `${PATH}/extra`,
    `https://other.example${PATH}`,
    `/${PATH}`,
    '/api/%63ollection-count',
    '/api/../api/collection-count',
    '/api%2fcollection-count',
    `${PATH}#x`,
    '/api/admin/collection-count',
    '/api/me/collection-count',
  ])
    assert.equal(publicKindOf(path), null, path);
});

test('footer count accepts only nonnegative safe numeric counts', () => {
  for (const blogs of [0, 1, 1234, Number.MAX_SAFE_INTEGER]) assert.equal(validPublicPayload('collectionCount', { blogs }), true);
  for (const blogs of [undefined, null, '1', '', true, {}, [], -1, 1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(validPublicPayload('collectionCount', { blogs }), false);
  for (const body of [null, [], {}, { totals: { blogs: 1 } }]) assert.equal(validPublicPayload('collectionCount', body), false);
});

test('footer count reader always uses fresh fixed GETs without session headers', async () => {
  let calls = 0;
  const fetcher = async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, `https://gateway.invalid${PATH}`);
    assert.deepEqual(Object.keys(init).sort(), ['cache', 'headers', 'method', 'redirect', 'signal']);
    assert.equal(init.method, 'GET');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { accept: 'application/json' });
    assert.ok(init.signal instanceof AbortSignal);
    return json(200, { blogs: calls });
  };
  assert.deepEqual(await readPublic('https://gateway.invalid', PATH, fetcher), { found: true, body: { blogs: 1 } });
  assert.deepEqual(await readPublic('https://gateway.invalid', PATH, fetcher), { found: true, body: { blogs: 2 } });
});

test('footer count rejects malformed success, retains transient retry, and treats old API 404 as missing', async () => {
  for (const body of [{}, { blogs: '1' }, { blogs: -1 }])
    await assert.rejects(
      readPublic('https://gateway.invalid', PATH, async () => json(200, body)),
      PublicGatewayError,
    );
  let calls = 0;
  const waits: number[] = [];
  assert.deepEqual(
    await readPublic(
      'https://gateway.invalid',
      PATH,
      async () => (++calls === 1 ? json(503) : json(200, { blogs: 3 })),
      async (ms) => {
        waits.push(ms);
      },
    ),
    { found: true, body: { blogs: 3 } },
  );
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2000]);
  assert.deepEqual(await readPublic('https://gateway.invalid', PATH, async () => json(404)), { found: false });
});

test('shared footer hides zero and failed reads and preserves the count formatting', async () => {
  const footer = source('components/SiteFooter.tsx');
  // Exercise the real loading/guard statements and formatting expression without interpreting JSX.
  const prelude = footer.match(/async function FooterStats\(\) \{([\s\S]*?)\n {2}return \(/)?.[1];
  const format = footer.match(/\{(totals\.blogs\.toLocaleString\('zh-TW'\))\}/)?.[1];
  assert.ok(prelude);
  assert.ok(format);
  const run = (collectionCount: () => Promise<{ blogs: number }>) =>
    vm.runInNewContext(`(async function () {${prelude}\nreturn ${format};})()`, { collectionCount });
  assert.equal(await run(async () => ({ blogs: 0 })), null);
  assert.equal(
    await run(async () => {
      throw new PublicGatewayError(PATH, 404);
    }),
    null,
  );
  assert.equal(
    await run(async () => {
      throw new PublicGatewayError(PATH, 503);
    }),
    null,
  );
  assert.equal(await run(async () => ({ blogs: 1234 })), (1234).toLocaleString('zh-TW'));
  assert.match(footer, /import \{ collectionCount \} from '@\/lib\/public-api'/);
  assert.doesNotMatch(footer, /\bcatalog\(|\bhomeOverview\(|\boverview\(/);
  assert.match(
    source('lib/public-api.ts'),
    /export const collectionCount = \(\) => publicJson<\{ blogs: number \}>\('\/api\/collection-count'\)/,
  );
});
