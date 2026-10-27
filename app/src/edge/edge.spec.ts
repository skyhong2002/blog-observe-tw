import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, RequestOptions, Server } from 'node:http';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { archiveAssets } from './assets.ts';
import { createEdge, endToEndHeaders, safePath } from './proxy.ts';
import { legacyHost, legacyRedirectEnabled } from './public-host.ts';
import { verifyArchive } from './release-integrity.ts';
import { atomicJson, type EdgeState, parseState, StateReader, socketFd } from './state.ts';

const servers: Server[] = [];
const directories: string[] = [];
const commit = 'a'.repeat(40);
const blue: EdgeState = { active: 'blue', generation: 1, commit };
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('test_address');
  return address.port;
}
async function temp() {
  const path = await mkdtemp(join(tmpdir(), 'blog-edge-test-'));
  directories.push(path);
  return path;
}
function redirectTransport(mapping: Record<number, number>, calls: RequestOptions[] = []): typeof request {
  return ((options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    calls.push(options);
    expect(options.hostname).toBe('127.0.0.1');
    expect([18174, 18175]).toContain(options.port);
    return request({ ...options, port: mapping[Number(options.port)] }, callback);
  }) as typeof request;
}
function get(port: number, path = '/', method = 'GET', headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: IncomingMessage['headers']; text: string }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => {
        text += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('weblog domain migration', () => {
  it('keeps the old site available until enabled, then redirects every path before static/proxy access', async () => {
    const assets = await temp();
    await writeFile(join(assets, 'fixture.js'), 'retained bytes');
    const calls: RequestOptions[] = [];
    const gateway = await listen(createServer((_req, res) => res.end('application')));
    let enabled = false;
    const port = await listen(
      createEdge({
        state: { get: async () => blue },
        assets,
        request: redirectTransport({ 18174: gateway }, calls),
        redirectLegacy: async () => enabled,
      }),
    );
    expect((await get(port, '/', 'GET', { host: 'blog.observe.tw' })).status).toBe(200);
    enabled = true;
    for (const method of ['GET', 'HEAD', 'POST']) {
      for (const path of [
        '/',
        '/topics/%E6%97%85%E8%A1%8C/?a=1&a=2&next=%2Fx',
        '/_next/static/fixture.js?v=1',
        '/api/v1/articles?hours=24',
        '/auth/google',
      ]) {
        const response = await get(port, path, method, { host: 'Blog.Observe.Tw:443' });
        expect(response.status).toBe(308);
        expect(response.headers.location).toBe(`https://weblog.tw${path}`);
        expect(response.headers['cache-control']).toContain('no-store');
        expect(response.headers['set-cookie']).toBeUndefined();
      }
    }
    expect(calls).toHaveLength(1);
    expect((await get(port, '/', 'GET', { host: 'weblog.tw', 'x-forwarded-host': 'blog.observe.tw' })).status).toBe(200);
    expect((await get(port, '/_next/static/fixture.js', 'GET', { host: 'weblog.tw' })).text).toBe('retained bytes');
    expect((await get(port, '//evil.example', 'GET', { host: 'blog.observe.tw' })).status).toBe(400);
    enabled = false;
    expect((await get(port, '/', 'GET', { host: 'blog.observe.tw' })).status).toBe(200);
    for (const host of ['evil.example', 'blog.observe.tw.evil.example', 'weblog.tw', 'blog.observe.tw:1234'])
      expect(legacyHost(host)).toBe(false);
  });
  it('defaults missing state to disabled and rejects malformed operator state', async () => {
    const path = join(await temp(), 'migration.json');
    expect(await legacyRedirectEnabled(path)).toBe(false);
    await writeFile(path, '{"enabled":true}');
    expect(await legacyRedirectEnabled(path)).toBe(true);
    await writeFile(path, '{"enabled":"true"}');
    await expect(legacyRedirectEnabled(path)).rejects.toThrow('invalid_legacy_redirect_state');
  });
});

describe('host-only HSTS', () => {
  it('sets exactly one day on HTTPS HTML, API, static and errors, never plain HTTP', async () => {
    const gateway = await listen(
      createServer((req, res) => {
        res.writeHead(req.url === '/missing' ? 404 : 200, { 'strict-transport-security': 'max-age=31536000; includeSubDomains; preload' });
        res.end('body');
      }),
    );
    const assets = await temp();
    await writeFile(join(assets, 'fixture.js'), 'console.log(1)');
    const port = await listen(createEdge({ state: { get: async () => blue }, assets, request: redirectTransport({ 18174: gateway }) }));
    for (const path of ['/', '/api/v1/openapi.json', '/_next/static/fixture.js', '/missing', '//invalid']) {
      const secure = await get(port, path, 'GET', { 'x-forwarded-proto': 'https' });
      expect(secure.headers['strict-transport-security']).toBe('max-age=86400');
      const plain = await get(port, path);
      expect(plain.headers['strict-transport-security']).toBeUndefined();
    }
  });
});

describe('visibility cache boundary', () => {
  it('does not let gateway/CDN cache headers retain mutable HTML, API or XML', async () => {
    const gateway = await listen(
      createServer((_req, res) => {
        res.writeHead(200, {
          'cache-control': 'public, s-maxage=300',
          'cdn-cache-control': 'public, max-age=999',
          expires: 'Wed, 21 Oct 2037 07:28:00 GMT',
        });
        res.end('visible content');
      }),
    );
    const port = await listen(
      createEdge({ state: { get: async () => blue }, assets: await temp(), request: redirectTransport({ 18174: gateway }) }),
    );
    for (const path of ['/', '/blogs/example/', '/api/v1/articles', '/sitemaps/topics.xml']) {
      const response = await get(port, path);
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['cdn-cache-control']).toBeUndefined();
      expect(response.headers.expires).toBeUndefined();
    }
  });
});

describe('fixed deployment state and inherited socket', () => {
  it('rejects arbitrary targets and malformed state; retains last good target on later damage', async () => {
    let raw = JSON.stringify(blue);
    const reader = new StateReader('unused', async () => raw);
    expect(await reader.get()).toEqual(blue);
    for (const bad of [
      '{',
      JSON.stringify({ ...blue, active: 'http://evil' }),
      JSON.stringify({ ...blue, port: 6379 }),
      JSON.stringify({ ...blue, active: 'green', generation: 0 }),
      JSON.stringify({ ...blue, active: 'green' }),
    ]) {
      raw = bad;
      expect(await reader.get()).toEqual(blue);
    }
    raw = JSON.stringify({ ...blue, active: 'green', generation: 2 });
    expect((await reader.get()).active).toBe('green');
    raw = JSON.stringify({ ...blue, generation: 3 }); // rollback uses a NEW generation
    expect((await reader.get()).active).toBe('blue');
    expect(() => parseState(JSON.stringify({ ...blue, commit: 'main' }))).toThrow();
    await expect(new StateReader('unused', async () => '{').get()).rejects.toThrow();
  });
  it('publishes complete durable JSON and only accepts one named socket for this pid', async () => {
    const path = join(await temp(), 'active.json');
    await atomicJson(path, blue);
    expect(parseState(await readFile(path, 'utf8'))).toEqual(blue);
    expect(socketFd({ LISTEN_PID: '123', LISTEN_FDS: '1', LISTEN_FDNAMES: 'http' }, 123)).toBe(3);
    for (const env of [
      {},
      { LISTEN_PID: '124', LISTEN_FDS: '1', LISTEN_FDNAMES: 'http' },
      { LISTEN_PID: '123', LISTEN_FDS: '2', LISTEN_FDNAMES: 'http:other' },
    ])
      expect(() => socketFd(env, 123)).toThrow();
  });
});

describe('edge HTTP forwarding', () => {
  it('rejects ambiguous paths and removes all hop headers including Connection-nominated names', () => {
    for (const path of ['//evil/x', '/\\evil', '/%2f%2fevil', 'https://evil/', '/%5cevil', '/bad%0d%0aheader', '/bad%'])
      expect(safePath(path)).toBe(false);
    expect(safePath('/blogs/%E5%8F%B0%E7%81%A3/?q=https%3A%2F%2Fexample.com')).toBe(true);
    expect(
      endToEndHeaders({
        connection: 'x-secret, Keep-Alive',
        'x-secret': 'bad',
        'keep-alive': 'a',
        'proxy-connection': 'b',
        cookie: 'session=opaque',
        authorization: 'Bearer opaque',
        'set-cookie': ['a=1', 'b=2'],
      }),
    ).toEqual({ cookie: 'session=opaque', authorization: 'Bearer opaque', 'set-cookie': ['a=1', 'b=2'] });
  });
  it('preserves own-gateway credentials, host, CF IP, cache/RSC and Set-Cookie; never follows redirect', async () => {
    let captured: IncomingMessage['headers'] = {};
    const upstream = await listen(
      createServer((req, res) => {
        captured = req.headers;
        res.writeHead(302, {
          location: 'https://not-followed.invalid/',
          'set-cookie': ['session=one; HttpOnly', 'csrf=two'],
          connection: 'x-internal',
          'x-internal': 'drop',
          vary: 'RSC',
          'cache-control': 'private, no-store',
          'x-blog-release': 'spoof',
        });
        res.end();
      }),
    );
    const calls: RequestOptions[] = [];
    const edge = await listen(
      createEdge({ state: { get: async () => blue }, assets: await temp(), request: redirectTransport({ 18174: upstream }, calls) }),
    );
    const response = await get(edge, '/auth/me', 'GET', {
      host: 'weblog.tw',
      cookie: 'blog_session=opaque',
      authorization: 'Bearer opaque',
      'x-api-key': 'opaque',
      'cf-connecting-ip': '198.51.100.7',
      rsc: '1',
      origin: 'https://weblog.tw',
      connection: 'x-hidden',
      'x-hidden': 'drop',
    });
    expect(response.status).toBe(302);
    expect(calls).toHaveLength(1);
    expect(captured).toMatchObject({
      host: 'weblog.tw',
      cookie: 'blog_session=opaque',
      authorization: 'Bearer opaque',
      'x-api-key': 'opaque',
      'cf-connecting-ip': '198.51.100.7',
      rsc: '1',
      origin: 'https://weblog.tw',
    });
    expect(captured['x-hidden']).toBeUndefined();
    expect(response.headers['x-internal']).toBeUndefined();
    expect(response.headers['set-cookie']).toHaveLength(2);
    expect(response.headers.vary).toBe('RSC');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['x-blog-release']).toBe(commit);
  });
  it.each(['GET', 'HEAD', 'POST'])('does not replay %s on transport failure', async (method) => {
    let attempts = 0;
    const upstream = await listen(
      createServer((req) => {
        attempts++;
        req.socket.destroy();
      }),
    );
    const edge = await listen(
      createEdge({ state: { get: async () => blue }, assets: await temp(), request: redirectTransport({ 18174: upstream }) }),
    );
    expect((await get(edge, '/api/action', method)).status).toBe(503);
    expect(attempts).toBe(1);
  });
  it('streams request/response chunks before completion and keeps in-flight requests on their original slot', async () => {
    let selected = blue;
    let finish: () => void = () => {};
    let markBody: () => void = () => {};
    const receivedBody = new Promise<void>((resolve) => {
      markBody = resolve;
    });
    let markEnd: () => void = () => {};
    const uploaded = new Promise<void>((resolve) => {
      markEnd = resolve;
    });
    const old = await listen(
      createServer((req, res) => {
        req.once('data', () => {
          markBody();
          res.write('old-first');
        });
        req.on('end', markEnd);
        finish = () => res.end('-last');
      }),
    );
    const fresh = await listen(createServer((_req, res) => res.end('new')));
    const edge = await listen(
      createEdge({ state: { get: async () => selected }, assets: await temp(), request: redirectTransport({ 18174: old, 18175: fresh }) }),
    );
    let firstChunk: () => void = () => {};
    const first = new Promise<void>((resolve) => {
      firstChunk = resolve;
    });
    let client!: ReturnType<typeof request>;
    const complete = new Promise<string>((resolve, reject) => {
      client = request({ host: '127.0.0.1', port: edge, method: 'POST', path: '/upload' }, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
          firstChunk();
        });
        res.on('end', () => resolve(body));
        res.on('error', reject);
      });
      client.on('error', reject);
      client.write('first');
    });
    await receivedBody;
    await first; // Neither the upload nor response has ended.
    selected = { ...blue, active: 'green', generation: 2 };
    expect((await get(edge)).text).toBe('new');
    client.end('last');
    await uploaded;
    finish();
    expect(await complete).toBe('old-first-last');
  });
});

describe('retained immutable Next assets', () => {
  it('checks git archive tracked bytes without .git and rejects altered source', async () => {
    const directory = await temp();
    await writeFile(join(directory, 'server.ts'), 'source\n');
    const hash = createHash('sha1').update('blob 7\0source\n').digest('hex');
    const tree = `100644 blob ${hash}\tserver.ts\0`;
    expect(await verifyArchive(directory, tree)).toBe(1);
    await writeFile(join(directory, 'server.ts'), 'altered\n');
    await expect(verifyArchive(directory, tree)).rejects.toThrow('archive_bytes_do_not_match_commit');
    await expect(verifyArchive(directory, '')).rejects.toThrow('archive_tree_empty');
    await expect(verifyArchive(directory, `120000 blob ${hash}\tserver.ts\0`)).rejects.toThrow('archive_regular_tracked_files_required');
  });
  it('keeps old/new chunks, rejects collisions/symlinks and serves HEAD without a proxy request', async () => {
    const directory = await temp();
    const source = join(directory, 'source');
    const cache = join(directory, 'static');
    await mkdir(source);
    await writeFile(join(source, 'old.js'), 'old bytes');
    expect(await archiveAssets(source, cache)).toBe(1);
    await writeFile(join(source, 'new.js'), 'new bytes');
    expect(await archiveAssets(source, cache)).toBe(1);
    await writeFile(join(source, 'old.js'), 'different');
    await expect(archiveAssets(source, cache)).rejects.toThrow('static_name_collision');
    await writeFile(join(source, 'old.js'), 'old bytes');
    await symlink('/etc/passwd', join(source, 'escape.js'));
    await expect(archiveAssets(source, cache)).rejects.toThrow('static_symlinks_forbidden');
    let proxyCalls = 0;
    const upstream = await listen(
      createServer((_req, res) => {
        proxyCalls++;
        res.writeHead(404);
        res.end();
      }),
    );
    const edge = await listen(
      createEdge({ state: { get: async () => blue }, assets: cache, request: redirectTransport({ 18174: upstream }) }),
    );
    expect((await get(edge, '/_next/static/old.js')).text).toBe('old bytes');
    expect((await get(edge, '/_next/static/new.js', 'HEAD')).headers['content-length']).toBe('9');
    expect(proxyCalls).toBe(0);
    expect((await get(edge, '/_next/static/%2e%2e/secret')).status).toBe(404);
    expect((await get(edge, '/_next/static/new.js', 'POST')).status).toBe(404);
    expect(proxyCalls).toBe(2);
  });
});
