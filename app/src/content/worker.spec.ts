import type { Pool } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ ingest: vi.fn(), fetch: vi.fn(), rule: vi.fn() }));
vi.mock('../crawl/feed.ts', () => ({ politeFetch: mocks.fetch }));
vi.mock('../jobs/budget.ts', () => ({ reserveBudget: async () => true }));
vi.mock('../jobs/lease.ts', () => ({
  withJobLease: async (_p: unknown, _n: string, fn: (assert: () => Promise<void>) => unknown) => fn(async () => {}),
}));
vi.mock('../relations/worker.ts', () => ({
  RELATION_PAGES_DAILY: 2400,
  budgetedRelationFetcher: () => ({ lastFailure: null }),
  relationBudgetAvailable: async () => true,
  relationFailureCode: () => 'fetch-failed',
}));
vi.mock('../tech/observer.ts', () => ({ createTechObserver: () => undefined }));
vi.mock('./store.ts', () => ({
  ingestContentEvidence: mocks.ingest,
  initializeContentRules: async () => {},
  loadContentRule: mocks.rule,
  recordContentAttempt: async () => {},
}));
vi.mock('./article-content.ts', () => ({ inPublication: () => true, wordpressEvidence: () => null }));
vi.mock('./registry.ts', () => ({ contentRequestPlan: () => [{ method: 'article-html', url: 'https://anise.tw/article' }] }));

import { runContentBatch } from './worker.ts';

function fixture() {
  const events: string[] = [];
  const post = {
    id: 1,
    blog_id: 5,
    url: 'https://anise.tw/article',
    blog_url: 'https://anise.tw/',
    status: 'ok',
    source_url: 'https://anise.tw/article',
    source_kind: 'article-html',
    etag: 'etag',
  };
  const connection = {
    beginTransaction: async () => {
      events.push('begin');
    },
    commit: async () => {
      events.push('commit');
    },
    rollback: async () => {
      events.push('rollback');
    },
    release: () => {
      events.push('release');
    },
    query: vi.fn(async (sql: string) => [
      sql.includes('FROM blogs') ? [{ url: post.blog_url, status: 'verified' }] : [{ url: post.url, blog_id: 5 }],
    ]),
    execute: vi.fn(async () => [{}]),
  };
  const pool = { execute: vi.fn(async () => [{}]), query: vi.fn(async () => [[post]]), getConnection: vi.fn(async () => connection) };
  mocks.fetch.mockResolvedValue(new Response('<article>body</article>', { headers: { 'content-type': 'text/html' } }));
  mocks.ingest.mockImplementation(async () => {
    events.push('ingest');
    return { postId: 1, status: 'ok', changed: true, hash: 'internal' };
  });
  return { pool: pool as unknown as Pool, events, connection };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rule.mockResolvedValue({ revision: 1, adapterId: 'generic', rules: {} });
});
describe('content committed adoption', () => {
  it('queues only after commit and release, and forwards no body/hash', async () => {
    const f = fixture();
    const enqueue = vi.fn(async (ids: readonly number[]) => {
      f.events.push('enqueue');
      return { acceptedPostIds: ids };
    });
    const result = await runContentBatch(f.pool, { indexAdoptionEnabled: true, enqueueIndex: enqueue });
    expect(f.events).toEqual(['begin', 'ingest', 'commit', 'release', 'enqueue']);
    expect(enqueue).toHaveBeenCalledWith([1]);
    expect(result.processed).toBe(1);
    expect(result.indexAdoption?.state).toBe('queued');
  });
  it('queue failure leaves committed body successful without noteFailure or rollback', async () => {
    const f = fixture();
    const result = await runContentBatch(f.pool, {
      indexAdoptionEnabled: true,
      enqueueIndex: async () => {
        throw Error('queue secret');
      },
    });
    expect(f.events).toEqual(['begin', 'ingest', 'commit', 'release']);
    expect(f.pool.getConnection).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(1);
    expect(result.indexAdoption?.state).toBe('needs-repair');
  });
  it.each([
    { status: 'ok', changed: false },
    { status: 'partial', changed: true },
  ])('retained/partial does not enqueue: %j', async (written) => {
    const f = fixture();
    mocks.ingest.mockResolvedValue({ postId: 1, hash: null, ...written });
    const enqueue = vi.fn();
    await runContentBatch(f.pool, { indexAdoptionEnabled: true, enqueueIndex: enqueue });
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('304 never invents a changed body event', async () => {
    const f = fixture();
    mocks.fetch.mockResolvedValue(new Response(null, { status: 304 }));
    const enqueue = vi.fn();
    await runContentBatch(f.pool, { indexAdoptionEnabled: true, enqueueIndex: enqueue });
    expect(mocks.ingest).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('rollback does not schedule index', async () => {
    const f = fixture();
    mocks.ingest.mockRejectedValue(Error('ingest failed'));
    const enqueue = vi.fn();
    await runContentBatch(f.pool, { indexAdoptionEnabled: true, enqueueIndex: enqueue });
    expect(f.events.slice(0, 3)).toEqual(['begin', 'rollback', 'release']);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('disabled does not enqueue and owner/post mismatch does not schedule', async () => {
    const f = fixture();
    const enqueue = vi.fn();
    await runContentBatch(f.pool, { enqueueIndex: enqueue });
    expect(enqueue).not.toHaveBeenCalled();
    mocks.ingest.mockResolvedValue({ postId: 99, status: 'ok', changed: true, hash: null });
    await runContentBatch(f.pool, { indexAdoptionEnabled: true, enqueueIndex: enqueue });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
