import { describe, expect, it, vi } from 'vitest';
import { createUiProxy } from './ui-proxy.js';

describe('UI proxy path isolation', () => {
  it.each(['//evil.example/x', '/\\evil.example/x', '/%2F%2Fevil.example/x', 'https://evil.example/x'])('rejects %s', async (raw) => {
    const request = vi.fn();
    const proxy = createUiProxy('http://127.0.0.1:18162', { request });
    const send = vi.fn();
    const reply: any = { code: vi.fn().mockReturnThis(), send, header: vi.fn().mockReturnThis(), type: vi.fn().mockReturnThis() };
    await proxy({ raw: { url: raw }, url: raw, headers: {}, method: 'GET', log: { warn: vi.fn() } } as any, reply);
    expect(reply.code).toHaveBeenCalledWith(400);
    expect(request).not.toHaveBeenCalled();
  });

  it('does not forward session credentials to the UI', async () => {
    const request = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: { dump: vi.fn() } });
    const proxy = createUiProxy('http://127.0.0.1:18162', { request });
    const reply: any = { code: vi.fn().mockReturnThis(), send: vi.fn(), header: vi.fn().mockReturnThis() };
    await proxy(
      { raw: { url: '/blogs/' }, headers: { cookie: 'blog_session=secret', authorization: 'Bearer secret', host: 'blog.observe.tw' }, method: 'GET', log: { warn: vi.fn() } } as any,
      reply,
    );
    expect(request.mock.calls[0][1].headers).not.toHaveProperty('cookie');
    expect(request.mock.calls[0][1].headers).not.toHaveProperty('authorization');
  });
});
