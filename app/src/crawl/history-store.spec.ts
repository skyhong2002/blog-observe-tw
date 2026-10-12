import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { createHistoryStore } from './history-store.ts';
import type { HistoryTask } from './history-types.ts';

const blog = { id: 7, slug: 'history', url: 'https://store-history.test/' };
const task: HistoryTask = {
  id: 'task',
  blogId: 7,
  kind: 'entry',
  sourceUrl: blog.url,
  sourceType: 'rss',
  url: `${blog.url}post`,
  depth: 1,
  status: 'pending',
};
const caps = { maxTasks: 100, maxTotalPages: 100, maxTotalArticles: 100 };
function fixture(failWrite = false) {
  const queries: string[] = [];
  const lease = { query: vi.fn(async (_sql: string) => [[{ acquired: 1, held: 1, released: 1 }], []]), release: vi.fn(), destroy: vi.fn() };
  const connection = {
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.startsWith('SELECT id,url,status')) return [[{ id: 7, url: blog.url, status: 'verified' }], []];
      if (sql.startsWith('SELECT * FROM history_tasks')) return [[{ ...task, source_url: task.sourceUrl }], []];
      if (sql.startsWith('SELECT * FROM history_runs')) return [[{ pages_fetched: 0, articles_written: 0, warnings: '[]' }], []];
      if (sql.startsWith('SELECT COUNT')) return [[{ total: 0 }], []];
      return [[], []];
    }),
    execute: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.startsWith('INSERT INTO posts') && failWrite) throw new Error('ER_DATA_TOO_LONG');
      if (sql.startsWith('SELECT guid')) return [[{ guid: 'existing-rss-guid' }], []];
      if (sql.startsWith('SELECT')) return [[], []];
      return [{ insertId: 3, affectedRows: 1 }, []];
    }),
  };
  const pool = { getConnection: vi.fn().mockResolvedValueOnce(lease).mockResolvedValue(connection) } as unknown as Pool;
  return { pool, lease, connection, queries };
}
const result = {
  entries: [
    {
      guid: 'sitemap-url',
      url: task.url,
      title: 'history',
      summary: 'short',
      author: '作者',
      publishedAt: null,
      updatedAt: null,
      imageUrl: null,
      categories: ['旅遊'],
    },
  ],
  tasks: [],
  fetched: false,
};
describe('history SQL transactions', () => {
  it('rolls back serialized work and never advances its cursor when a post write fails', async () => {
    const f = fixture(true);
    const store = createHistoryStore(f.pool);
    await store.acquire();
    await expect(store.commitTask(blog, task, result, caps, new Date())).rejects.toThrow('ER_DATA_TOO_LONG');
    expect(f.connection.rollback).toHaveBeenCalledOnce();
    expect(f.connection.commit).not.toHaveBeenCalled();
    expect(f.queries.some((sql) => sql.startsWith('UPDATE history_tasks'))).toBe(false);
    await store.release();
    expect(f.lease.release).toHaveBeenCalledOnce();
  });
  it('locks ownership and commits posts/authors/tags before the durable cursor, preserving original GUID and dates', async () => {
    const f = fixture();
    const store = createHistoryStore(f.pool);
    await store.acquire();
    await store.commitTask(blog, task, result, caps, new Date());
    expect(f.connection.commit).toHaveBeenCalledOnce();
    expect(f.connection.rollback).not.toHaveBeenCalled();
    const postCall = f.connection.execute.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO posts'));
    expect(postCall?.[0]).toContain('published_at=COALESCE(VALUES(published_at),published_at)');
    const calls = f.connection.execute.mock.calls as unknown as Array<[string, unknown[]]>;
    expect(calls.find(([sql]) => sql.startsWith('INSERT INTO posts'))?.[1][1]).toBe('existing-rss-guid');
    expect(f.queries.findIndex((sql) => sql.startsWith('UPDATE history_tasks'))).toBeGreaterThan(
      f.queries.findIndex((sql) => sql.includes('INSERT INTO blog_tags')),
    );
    expect(f.queries.some((sql) => sql.includes('GREATEST(COALESCE(last_published_at'))).toBe(true);
    await store.release();
  });
  it('rolls back children and leaves parent pending when total task quota is exhausted', async () => {
    const f = fixture();
    const store = createHistoryStore(f.pool);
    await store.acquire();
    await expect(
      store.commitTask(
        blog,
        task,
        {
          ...result,
          entries: [],
          tasks: [{ url: `${blog.url}child`, sourceUrl: blog.url, kind: 'article', sourceType: 'sitemap', depth: 2 }],
        },
        { ...caps, maxTasks: 0 },
        new Date(),
      ),
    ).rejects.toThrow('history_task_limit');
    expect(f.connection.rollback).toHaveBeenCalledOnce();
    expect(f.queries.some((sql) => sql.startsWith('UPDATE history_tasks'))).toBe(false);
    await store.release();
  });
});

it('records deleted-source terminal failure without rechecking removed ownership or writing posts', async () => {
  const f = fixture();
  f.connection.query.mockImplementation(async (sql: string) => {
    f.queries.push(sql);
    if (sql.startsWith('SELECT id,url,status')) return [[{ id: 7, url: blog.url, status: 'verified' }], []];
    if (sql.startsWith('SELECT * FROM history_tasks')) return [[{ ...task, source_url: task.sourceUrl, attempts: 2 }], []];
    if (sql.startsWith('SELECT * FROM history_runs')) return [[{ pages_fetched: 0, articles_written: 0, warnings: '[]' }], []];
    return [[], []];
  });
  const store = createHistoryStore(f.pool);
  await store.acquire();
  expect(await store.failTask(blog, task, 'history_source_ownership_changed', new Date())).toBe(true);
  expect(f.connection.commit).toHaveBeenCalledOnce();
  expect(f.queries.some((sql) => sql.includes('FROM feed_sources'))).toBe(false);
  expect(f.queries.some((sql) => sql.startsWith('INSERT INTO posts'))).toBe(false);
  const calls = f.connection.execute.mock.calls as unknown as Array<[string, unknown[]]>;
  expect(calls.find(([sql]) => sql.startsWith('UPDATE history_tasks'))?.[1].slice(0, 3)).toEqual([
    3,
    'history_source_ownership_changed',
    'failed',
  ]);
  expect(calls.find(([sql]) => sql.startsWith('UPDATE history_runs'))?.[1][0]).toContain('failed-task:history_source_ownership_changed');
  await store.release();
});
