import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { techObservationQueue } from '../tech/observer.ts';
import { refreshMissingBlogFavicons } from './favicon-batch.ts';
import { type CatalogEntry, type FaviconState, loadFaviconState, refreshFavicon } from './favicons.ts';
import { type FeedFetcher, politeFetch } from './feed.ts';

vi.mock('./favicons.ts', () => ({ loadFaviconState: vi.fn(), refreshFavicon: vi.fn() }));
const dirs: string[] = [];
const stamp = new Date('2026-10-12T00:00:00Z');
const row = (id: number) => ({ id, slug: `blog-${id}`, name: `Blog ${id}`, url: `https://blog-${id}.test/` });
const pool = (ids: number[]) => ({ query: vi.fn(async () => [ids.map(row), []]) }) as unknown as Pick<Pool, 'query'>;
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'blog-icon-batch-'));
  dirs.push(root);
  const state: FaviconState = { catalog: {}, local: {} };
  vi.mocked(loadFaviconState).mockResolvedValue(state);
  vi.mocked(refreshFavicon).mockImplementation(async (target) => ({ status: 'success', slug: target.slug, reason: undefined }));
  return { root, state, now: () => stamp };
}
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('automatic missing favicon batches', () => {
  it.each([false, true])('preserves the original observer enabled=%s and isolates its rejected promise', async (enabled) => {
    vi.stubEnv('BLOG_TECH_ENABLED', String(enabled));
    const options = await setup();
    vi.spyOn(techObservationQueue, 'enqueue').mockReturnValue(true);
    const observer = vi.fn((): Promise<void> => Promise.reject(Error('optional-callback-failed')));
    const id = enabled ? 82 : 81;
    vi.mocked(refreshFavicon).mockImplementation(async (target, settings) => {
      if (!enabled) expect(settings?.observer).toBe(observer);
      await settings?.observer?.({
        requestedUrl: target.url!,
        url: target.url!,
        status: 200,
        headers: { 'content-type': 'text/html' },
        html: '<meta name="generator" content="WordPress">',
        htmlTruncated: false,
        observedAt: stamp,
      });
      return { status: 'success', slug: target.slug, reason: undefined };
    });
    // Real politeFetch isolates callback rejection while disabled; the mocked entrypoint must do likewise.
    if (!enabled) observer.mockImplementation(() => Promise.resolve());
    await expect(refreshMissingBlogFavicons(pool([id]), { ...options, observer })).resolves.toMatchObject({ processed: 1 });
    expect(observer).toHaveBeenCalledOnce();
  });
  it.each([false, true])('favicon observer enabled=%s preserves existing homepage fetch count', async (enabled) => {
    vi.stubEnv('BLOG_TECH_ENABLED', String(enabled));
    const options = await setup();
    const enqueue = vi.spyOn(techObservationQueue, 'enqueue').mockReturnValue(true);
    const fetcher = vi.fn<FeedFetcher>(async (url) =>
      String(url).endsWith('/robots.txt')
        ? new Response('')
        : new Response('<html><meta name="generator" content="WordPress"></html>', { headers: { 'content-type': 'text/html' } }),
    );
    vi.mocked(refreshFavicon).mockImplementation(async (target, settings) => {
      expect(Boolean(settings?.observer)).toBe(enabled);
      await politeFetch(target.url!, {}, settings);
      expect(enqueue).not.toHaveBeenCalled();
      return { status: 'success', slug: target.slug, reason: undefined };
    });
    // Separate hosts avoid the existing process-wide robots cache masking request parity.
    const id = enabled ? 72 : 71;
    const db = pool([id]);
    await refreshMissingBlogFavicons(db, { ...options, fetcher, resolveHost: async () => ['93.184.216.34'], delayMs: 250 });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([`https://blog-${id}.test/robots.txt`, `https://blog-${id}.test/`]);
    expect(enqueue).toHaveBeenCalledTimes(Number(enabled));
    expect(db.query).toHaveBeenCalledOnce();
  });
  it('shares the CLI lock, does not take over an old owner, and performs no query while busy', async () => {
    const options = await setup();
    const lock = join(options.root, 'app/data/.favicon-refresh.lock');
    await mkdir(join(options.root, 'app/data'), { recursive: true });
    const owner = JSON.stringify({ pid: 99999999, startedAt: '2000-01-01' });
    await writeFile(lock, owner);
    const db = pool([1]);
    expect(await refreshMissingBlogFavicons(db, options)).toMatchObject({ skipped: 'favicon-refresh-busy', processed: 0 });
    expect(db.query).not.toHaveBeenCalled();
    expect(await readFile(lock, 'utf8')).toBe(owner);
  });
  it('caps selection at ten and holds the PID lock during refresh, then releases it', async () => {
    const options = await setup();
    const lock = join(options.root, 'app/data/.favicon-refresh.lock');
    vi.mocked(refreshFavicon).mockImplementation(async (target, settings) => {
      expect(JSON.parse(await readFile(lock, 'utf8')).pid).toBe(process.pid);
      expect(settings?.maxTargetMs).toBeLessThanOrEqual(30_000);
      return { status: 'success', slug: target.slug, reason: undefined };
    });
    const db = pool(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await refreshMissingBlogFavicons(db, { ...options, limit: 100 })).toMatchObject({ selected: 10, processed: 10 });
    expect(String(vi.mocked(db.query).mock.calls[0][0])).toContain("status='verified' AND url IS NOT NULL");
    await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('skips existing PNGs and recent failures, prioritizes untried sites and retries oldest failures first', async () => {
    const options = await setup();
    for (const [id, checkedAt] of [
      [1, '2026-10-10'],
      [2, '2026-10-01'],
      [3, '2026-09-01'],
    ] as const)
      options.state.catalog[`blog-${id}`] = { ...row(id), status: 'failure', checkedAt } as unknown as CatalogEntry;
    options.state.local['blog-4'] = { targetUrl: row(4).url } as FaviconState['local'][string];
    await mkdir(join(options.root, 'web/public/favicons'), { recursive: true });
    await writeFile(join(options.root, 'web/public/favicons/blog-4.png'), 'existing');
    await refreshMissingBlogFavicons(pool([1, 2, 3, 4, 5]), options);
    expect(vi.mocked(refreshFavicon).mock.calls.map(([target]) => target.id)).toEqual([5, 3, 2]);
  });
  it('retries missing files and changed identities, and releases its lock after failure', async () => {
    const options = await setup();
    options.state.local['blog-1'] = { targetUrl: row(1).url } as FaviconState['local'][string];
    options.state.catalog['blog-2'] = { url: 'https://old.test/', status: 'failure', checkedAt: stamp.toISOString() } as CatalogEntry;
    await refreshMissingBlogFavicons(pool([1, 2]), options);
    expect(vi.mocked(refreshFavicon).mock.calls.map(([target]) => target.id)).toEqual([1, 2]);
    vi.mocked(refreshFavicon).mockRejectedValueOnce(new Error('cache write failed'));
    await expect(refreshMissingBlogFavicons(pool([1]), options)).rejects.toThrow('cache write failed');
    await expect(stat(join(options.root, 'app/data/.favicon-refresh.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('stops starting sites at the batch deadline while waiting for the current cache write', async () => {
    const options = await setup();
    let elapsed = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => stamp.getTime() + elapsed);
    vi.mocked(refreshFavicon).mockImplementation(async (target) => {
      elapsed += 30_000;
      return { status: 'failure', slug: target.slug, reason: 'test' };
    });
    expect(await refreshMissingBlogFavicons(pool([1, 2, 3, 4, 5, 6]), options)).toMatchObject({ selected: 6, processed: 4 });
  });
});
