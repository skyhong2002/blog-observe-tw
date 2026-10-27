// biome-ignore-all lint/suspicious/noExplicitAny: Fastify request/reply test doubles
import { describe, expect, it, vi } from 'vitest';
import { createUiProxy } from './ui-proxy.js';

describe('UI proxy path isolation', () => {
  it.each(['//evil.example/x', '/\\evil.example/x', '/%2F%2Fevil.example/x', '/%5Cevil.example/x', 'https://evil.example/x'])(
    'rejects %s',
    async (raw) => {
      const request = vi.fn();
      const proxy = createUiProxy('http://127.0.0.1:18162', { request });
      const send = vi.fn();
      const reply: any = { code: vi.fn().mockReturnThis(), send, header: vi.fn().mockReturnThis(), type: vi.fn().mockReturnThis() };
      await proxy({ raw: { url: raw }, url: raw, headers: {}, method: 'GET', log: { warn: vi.fn() } } as any, reply);
      expect(reply.code).toHaveBeenCalledWith(400);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each(['/blogs/', '/favicon.ico', '/feeds/', '/2026/', '/tags/'])(
    'keeps %s on the fixed UI origin without credentials',
    async (path) => {
      const request = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: { dump: vi.fn() } });
      const proxy = createUiProxy('http://127.0.0.1:18162', { request });
      const reply: any = { code: vi.fn().mockReturnThis(), send: vi.fn(), header: vi.fn().mockReturnThis() };
      await proxy(
        {
          raw: { url: path },
          headers: { cookie: 'blog_session=secret', authorization: 'Bearer secret', host: 'weblog.tw' },
          method: 'GET',
          log: { warn: vi.fn() },
        } as any,
        reply,
      );
      expect(request.mock.calls[0][0].origin).toBe('http://127.0.0.1:18162');
      expect(request.mock.calls[0][0].pathname).toBe(path);
      expect(request.mock.calls[0][1].headers).not.toHaveProperty('cookie');
      expect(request.mock.calls[0][1].headers).not.toHaveProperty('authorization');
    },
  );
  it('uses an explicit legacy path without mutating the request or double-encoding its query', async () => {
    const request = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: { dump: vi.fn() } });
    const proxy = createUiProxy('http://127.0.0.1:18162', { request });
    const reply: any = { code: vi.fn().mockReturnThis(), send: vi.fn(), header: vi.fn().mockReturnThis() };
    const body = { untouched: true },
      original = '/topics/%E7%BE%8E%E9%A3%9F/?q=%2Ftest';
    const req: any = { raw: { url: original }, url: original, body, headers: {}, method: 'HEAD', log: { warn: vi.fn() } };
    await proxy(req, reply, '/topics/tag%3Aabc/?q=%2Ftest');
    expect(request.mock.calls[0][0].href).toBe('http://127.0.0.1:18162/topics/tag%3Aabc/?q=%2Ftest');
    expect(request.mock.calls[0][1].method).toBe('HEAD');
    expect(req.raw.url).toBe(original);
    expect(req.url).toBe(original);
    expect(req.body).toBe(body);
  });
  it.each([
    ['/blogs/x/', '//evil.test/'],
    ['/blogs/x/', '/%2F%2Fevil.test/'],
    ['/blogs/x/', 'https://evil.test/'],
    ['//evil.test/', '/blogs/stable/'],
    ['/blogs/%', '/blogs/stable/'],
  ])('validates both original %s and override %s', async (original, override) => {
    const request = vi.fn(),
      proxy = createUiProxy('http://127.0.0.1:18162', { request });
    const reply: any = { code: vi.fn().mockReturnThis(), send: vi.fn() };
    await proxy({ raw: { url: original }, headers: {}, method: 'GET' } as any, reply, override);
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(request).not.toHaveBeenCalled();
  });
});
