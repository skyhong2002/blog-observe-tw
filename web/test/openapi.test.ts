import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFence, errorMessage, parseKeys } from '../src/lib/api-keys.ts';
import { schemaTools } from '../src/lib/openapi-fields.mts';
import { endpointAnchor, exampleUrl, fullPath, type OpenApi, operations, parseSpec } from '../src/lib/openapi-spec.ts';

test('a key that arrives after the page was left is discarded, errors included', async () => {
  const fence = createFence();
  let resolve!: (key: string) => void;
  const pending = fence.settle(new Promise<string>((r) => (resolve = r)));
  fence.end(); // pagehide while the create request is in flight
  resolve('blog_secret');
  assert.deepEqual(await pending, { live: false });

  let reject!: (error: Error) => void;
  const failing = fence.settle(new Promise<string>((_, r) => (reject = r)));
  fence.end();
  reject(new Error('late 401'));
  assert.deepEqual(await failing, { live: false });

  // Requests started after coming back are live again.
  assert.deepEqual(await fence.settle(Promise.resolve('meta')), { live: true, value: 'meta' });
  await assert.rejects(fence.settle(Promise.reject(new Error('now'))), /now/);
});

// A minimal fixture for the helpers only; the page itself renders data/openapi.json.
const spec: OpenApi = {
  info: { title: 'Fixture' },
  servers: [{ url: '/api/v1' }],
  paths: {
    '/blogs/{slug}': {
      parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' }, example: 'rss:my blog' }],
      head: { summary: 'One blog (HEAD)' },
      get: {
        summary: 'One blog',
        parameters: [
          { name: 'limit', in: 'query', required: true, schema: { type: 'integer', default: 20 } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
        ],
      },
    },
    '/tags/{slug}': { get: { parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }] } },
  },
};

test('operations fold path-level parameters, HEAD twins and prefix the server path', () => {
  const ops = operations(spec);
  assert.equal(ops.length, 2);
  const [blog, tag] = ops;
  assert.equal(blog.path, '/api/v1/blogs/{slug}');
  assert.equal(blog.method, 'GET');
  assert.equal(blog.head, true);
  assert.equal(tag.head, false);
  assert.deepEqual(
    blog.op.parameters?.map((p) => p.name),
    ['slug', 'limit', 'q'],
  );
  assert.equal(tag.path, '/api/v1/tags/{slug}');
  assert.equal(fullPath(spec, '/api/v1/x'), '/api/v1/x');
});

test('examples come from the spec and are omitted when a path parameter has none', () => {
  const [blog, tag] = operations(spec);
  assert.equal(exampleUrl(blog), '/api/v1/blogs/rss%3Amy%20blog?limit=20');
  assert.equal(exampleUrl(tag), null);
  assert.equal(endpointAnchor('GET', blog.path), 'api-v1-blogs-slug-get');
});

test('parseSpec rejects documents without title or paths', () => {
  assert.throws(() => parseSpec({ info: {} }));
  assert.equal(parseSpec(spec), spec);
});

test('schemaTools flattens referenced response fields', () => {
  const tools = schemaTools({ Blog: { type: 'object', properties: { slug: { type: 'string', description: '代號' } } } });
  const rows = tools.fieldRows({ type: 'object', properties: { blogs: { type: 'array', items: { $ref: '#/components/schemas/Blog' } } } });
  assert.deepEqual(
    rows.map((r) => `${r.field}:${r.type}`),
    ['blogs:object[]', 'blogs[].slug:string'],
  );
});

test('API key errors are short Chinese messages and listings never carry plaintext', () => {
  assert.equal(errorMessage(409, { error: 'limit' }), '已達金鑰數量上限，請先撤銷不用的金鑰。');
  assert.equal(errorMessage(400, { message: '名稱過長' }), '名稱過長');
  assert.match(errorMessage(418, null), /HTTP 418/);
  const keys = parseKeys([{ id: 7, label: 'bot', prefix: 'bo_abc', createdAt: '2026-10-12T00:00:00Z', lastUsedAt: null, key: 'secret' }]);
  assert.deepEqual(keys, [{ id: '7', label: 'bot', prefix: 'bo_abc', createdAt: '2026-10-12T00:00:00Z', lastUsedAt: null }]);
});
