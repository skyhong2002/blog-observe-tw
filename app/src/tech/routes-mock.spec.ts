import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { detectTechnology } from './detector.ts';
import { registerTechRoutes } from './routes.ts';

vi.mock('../seo/page-routes.ts', () => ({
  getPublicPages: vi.fn(async () => new Map()),
  resolvePublicPage: vi.fn(async () => null),
  isPublicRouteKey: (_kind: string, value: string) => /^[a-z0-9-]+$/.test(value),
}));
vi.mock('../v1/favicon-routes.ts', () => ({ iconManifest: vi.fn(async () => ({})) }));
vi.mock('../v1/icons.ts', () => ({ iconUrl: () => '/icon.svg' }));

function scan(id: number, status: 'detected' | 'unknown' | 'failed' | 'blocked' | 'not-observed') {
  const o = detectTechnology({
    url: `https://site${id}.example/`,
    html: status === 'unknown' ? '<p>A diary</p>' : '<meta name="generator" content="Hugo">',
    observedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  return {
    id,
    slug: `site-${id}`,
    name: `Site ${id}`,
    url: `https://site${id}.example/`,
    status: status === 'not-observed' ? null : status,
    detections: o.detections,
    coverage: o.coverage,
    source_url: o.sourceUrl,
    source_type: o.sourceType,
    observed_at: o.observedAt,
    last_attempt_at: '2026-01-02T00:00:00.000Z',
    rule_version: o.ruleVersion,
    last_error_code: status === 'failed' ? 'timeout' : status === 'blocked' ? 'robots' : null,
  };
}

function offlinePool(query: (sql: string, values?: unknown[]) => unknown): Pool {
  return {
    getConnection: vi.fn(async () => ({
      query: (options: { sql: string; values?: unknown[]; timeout: number }) => {
        expect(options.sql).toMatch(/^SET STATEMENT max_statement_time=0\.25 FOR SELECT/);
        expect(options.timeout).toBe(500);
        return query(options.sql.replace(/^SET STATEMENT max_statement_time=0\.25 FOR /, ''), options.values);
      },
      release: vi.fn(),
      destroy: vi.fn(),
    })),
  } as unknown as Pool;
}

describe('optional technology HTTP routes with offline storage adapter', () => {
  it('keeps public feature off by default and requires exact opt-in', () => {
    const env = { BLOG_DB_URL: 'mysql://test.invalid/blog' };
    expect(loadConfig(env).techPublicEnabled).toBe(false);
    expect(loadConfig({ ...env, BLOG_TECH_PUBLIC_ENABLED: '1' }).techPublicEnabled).toBe(false);
    expect(loadConfig({ ...env, BLOG_TECH_PUBLIC_ENABLED: 'true' }).techPublicEnabled).toBe(true);
  });
  it('keeps all five states in the denominator, retains separately dated success, and reads fresh', async () => {
    let rows = ['detected', 'unknown', 'failed', 'blocked', 'not-observed'].map((status, i) =>
      scan(i + 1, status as Parameters<typeof scan>[1]),
    );
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT COUNT')) return [[{ total: rows.length }]];
      // Assert real query obligations, while the adapter supplies already-filtered rows.
      expect(sql).toContain("WHERE b.status='verified'");
      expect(sql).toContain('LEFT JOIN blog_tech_scans s ON s.blog_id=b.id AND');
      expect(sql).toContain('tech_source.blog_id=b.id');
      expect(sql).toContain('tech_attempt.blog_id=b.id');
      expect(sql).toContain('tech_source.published_at<=UTC_TIMESTAMP()');
      expect(sql).toContain('tech_attempt.published_at<=UTC_TIMESTAMP()');
      return [rows];
    });
    const app = Fastify();
    registerTechRoutes(app, offlinePool(query), { enabled: true });
    try {
      const first = await app.inject('/api/tech?limit=2');
      expect(first.statusCode).toBe(200);
      expect(first.headers['cache-control']).toContain('no-store');
      expect(first.json().coverage).toEqual({
        totalBlogs: 5,
        scannedBlogs: 5,
        truncated: false,
        detected: 1,
        unknown: 1,
        failed: 1,
        blocked: 1,
        notObserved: 1,
      });
      expect(first.json().items).toHaveLength(2);
      expect(first.json().pagination.nextCursor).toBe('2');
      // /tech/ shows not-observed under 未辨識: status=unknown lists both, status=not-observed only its own.
      const unknown = (await app.inject('/api/tech?status=unknown')).json();
      expect(unknown.items.map((i: { status: string }) => i.status)).toEqual(['unknown', 'not-observed']);
      expect(unknown.pagination.total).toBe(2);
      expect((await app.inject('/api/tech?status=not-observed')).json().pagination.total).toBe(1);
      const failed = (await app.inject('/api/tech?status=failed')).json();
      expect(failed.items).toHaveLength(1);
      expect(failed.items[0]).toMatchObject({
        status: 'failed',
        observedAt: '2026-01-01T00:00:00.000Z',
        lastAttemptAt: '2026-01-02T00:00:00.000Z',
        errorCode: 'timeout',
        url: null,
      });
      expect(failed.items[0].detections[0]).toMatchObject({ id: 'hugo', version: 'unknown' });
      // Simulate public-source JOIN masking the former successful snapshot.
      rows = [scan(3, 'not-observed')];
      const next = (await app.inject('/api/tech')).json();
      expect(next.coverage.notObserved).toBe(1);
      expect(next.technologies).toEqual([]);
      expect(next.items[0].detections).toEqual([]);
      expect(query).toHaveBeenCalledTimes(10);
    } finally {
      await app.close();
    }
  });
  it('bounds HTTP admission even after acquisition timeouts, and serves a fresh request after a late release', async () => {
    const a = Promise.withResolvers<unknown>(),
      b = Promise.withResolvers<unknown>();
    const entered = Promise.withResolvers<void>();
    const getConnection = vi
      .fn()
      .mockImplementationOnce(() => a.promise)
      .mockImplementationOnce(() => {
        entered.resolve();
        return b.promise;
      });
    const app = Fastify();
    registerTechRoutes(app, { getConnection } as unknown as Pool, { enabled: true });
    await app.ready();
    vi.useFakeTimers();
    try {
      const first = app.inject('/api/tech').then((r) => r);
      const second = app.inject('/api/blogs/site-1/tech').then((r) => r);
      await entered.promise;
      const busy = await app.inject('/api/tech');
      expect(busy.statusCode).toBe(503);
      expect(busy.json()).toEqual({ error: 'technology_unavailable' });
      expect(busy.headers['cache-control']).toContain('no-store');
      expect(getConnection).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2501);
      for (const r of await Promise.all([first, second])) {
        expect(r.statusCode).toBe(503);
        expect(r.json()).toEqual({ error: 'technology_unavailable' });
        expect(r.headers['cache-control']).toContain('no-store');
      }
      expect((await app.inject('/api/tech')).statusCode).toBe(503);
      expect(getConnection).toHaveBeenCalledTimes(2);
      const released = Promise.withResolvers<void>();
      const late = { release: vi.fn(() => released.resolve()), query: vi.fn(), destroy: vi.fn() };
      a.resolve(late);
      await released.promise;
      expect(late.query).not.toHaveBeenCalled();
      const freshQuery = vi.fn(async (options: { sql: string }) => (options.sql.includes('COUNT(*)') ? [[{ total: 0 }]] : [[]]));
      getConnection.mockResolvedValueOnce({ query: freshQuery, release: vi.fn(), destroy: vi.fn() });
      const next = await app.inject('/api/tech');
      expect(next.statusCode).toBe(200);
      expect(next.json().items).toEqual([]);
      expect(freshQuery).toHaveBeenCalledTimes(2);
      b.reject(Error('late pool rejection'));
    } finally {
      vi.useRealTimers();
      await app.close();
    }
  });

  it('isolates missing-table/DB errors as fixed no-store 503 while unrelated routes still work', async () => {
    const query = vi.fn().mockRejectedValue(Error('SELECT private_database.credentials FROM private_table'));
    const app = Fastify();
    registerTechRoutes(app, offlinePool(query), { enabled: true });
    app.get('/existing-page', async () => ({ ok: true }));
    try {
      for (const url of ['/api/tech', '/api/blogs/site-1/tech']) {
        const response = await app.inject(url);
        expect(response.statusCode).toBe(503);
        expect(response.headers['cache-control']).toContain('no-store');
        expect(response.json()).toEqual({ error: 'technology_unavailable' });
        expect(response.body).not.toMatch(/private_database|credentials|private_table|SELECT/);
      }
      expect((await app.inject('/existing-page')).json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });
});
