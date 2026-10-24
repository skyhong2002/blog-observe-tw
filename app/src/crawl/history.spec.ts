import { describe, expect, it, vi } from 'vitest';
import type { FeedEntry, FeedFetcher } from './feed.ts';
import { historyFailureReason, runHistoryBatch } from './history.ts';
import { historyTaskKey, storedEntry } from './history-parse.ts';
import type { HistoryPageResult, HistoryRun, HistoryStore, HistoryTask, HistoryTaskInput } from './history-types.ts';

const blog = { id: 1, slug: 'history', url: 'https://history-run.test/' };
const entry = (i: number): FeedEntry => ({
  guid: String(i),
  url: `${blog.url}${i}`,
  title: `post ${i}`,
  summary: 'short',
  publishedAt: null,
  updatedAt: null,
  author: null,
  imageUrl: null,
  categories: [],
});
function memory(inputs: HistoryTaskInput[]) {
  const tasks = new Map<string, HistoryTask>();
  const add = (input: HistoryTaskInput) => {
    const id = historyTaskKey(1, input);
    if (!tasks.has(id)) tasks.set(id, { ...input, id, blogId: 1, status: 'pending' });
  };
  inputs.forEach(add);
  const posts: FeedEntry[] = [];
  const run: HistoryRun = {
    blogId: 1,
    status: 'partial',
    pagesFetched: 0,
    articlesWritten: 0,
    tasksTotal: tasks.size,
    tasksDone: 0,
    archiveSeen: false,
    warnings: [],
    nextAttemptAt: null,
    lastError: null,
  };
  let failWrite = false;
  const commitTask = vi.fn(async (_blog, task: HistoryTask, result: HistoryPageResult) => {
    if (failWrite && result.entries.length) throw new Error('database down');
    result.tasks.forEach(add);
    posts.push(...result.entries);
    tasks.get(task.id)!.status = 'done';
    run.pagesFetched += Number(result.fetched);
    run.articlesWritten += result.entries.length;
    run.tasksDone++;
    run.tasksTotal = tasks.size;
    run.archiveSeen ||= Boolean(result.archiveSeen);
    run.warnings.push(...(result.warnings || []));
    run.status = 'partial';
    return { written: result.entries.length, queued: result.tasks.length };
  });
  const store: HistoryStore = {
    acquire: vi.fn(async () => true),
    assertLease: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
    initialize: vi.fn(async () => ({ ...run })),
    nextTask: vi.fn(
      async (_, allowed) => [...tasks.values()].find((task) => task.status === 'pending' && allowed.includes(task.kind)) || null,
    ),
    commitTask,
    failTask: vi.fn(async (_, task, reason) => {
      const saved = tasks.get(task.id)!;
      saved.attempts = (saved.attempts || 0) + 1;
      if (saved.attempts < 3) return false;
      saved.status = 'failed';
      run.warnings.push(`failed-task:${reason}`);
      run.tasksDone++;
      run.nextAttemptAt = null;
      run.status = 'partial';
      return true;
    }),
    defer: vi.fn(async (_, reason, until, status) => {
      run.status = status;
      run.nextAttemptAt = until?.toISOString() || null;
      run.lastError = reason;
    }),
    finish: vi.fn(async () => {
      if (![...tasks.values()].some((task) => task.status === 'pending'))
        run.status = run.archiveSeen && !run.warnings.length ? 'complete' : 'exhausted';
      return { ...run };
    }),
  };
  return {
    store,
    tasks,
    posts,
    run,
    fail: () => {
      failWrite = true;
    },
  };
}
const input = (url: string, kind: HistoryTaskInput['kind']): HistoryTaskInput => ({
  url,
  kind,
  sourceUrl: blog.url,
  sourceType: 'sitemap',
  depth: 0,
});
const options = (fetcher: FeedFetcher) => ({ fetcher, resolveHost: async () => ['93.184.216.34'], delayMs: 250 });
describe('resumable history batches', () => {
  it('persists all child work and resumes across article budget boundaries without marking partial complete', async () => {
    const m = memory([input(`${blog.url}sitemap.xml`, 'sitemap')]);
    const fetcher = vi.fn<FeedFetcher>(async (url) =>
      String(url).endsWith('/robots.txt')
        ? new Response('')
        : String(url).endsWith('.xml')
          ? new Response(
              `<urlset>${[1, 2, 3].map((i) => `<url><loc>${blog.url}${i}</loc><lastmod>2000-01-01</lastmod></url>`).join('')}</urlset>`,
            )
          : new Response('<html><meta property="og:type" content="article"><title>Old short post</title></html>'),
    );
    const first = await runHistoryBatch(m.store, blog, { ...options(fetcher), maxPages: 1, maxArticles: 1 });
    expect(first.status).toBe('partial');
    expect(m.tasks.size).toBe(4);
    expect(m.posts).toHaveLength(1);
    expect(m.posts[0].publishedAt).toBeNull();
    const second = await runHistoryBatch(m.store, blog, { ...options(fetcher), maxPages: 1, maxArticles: 2 });
    expect(second.status).toBe('complete');
    expect(m.posts).toHaveLength(3);
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('.xml'))).toHaveLength(1);
  });
  it('serialized feed entries need no refetch, preserve Unicode, and remain pending after failed write', async () => {
    const article = { ...entry(1), summary: '日😀'.repeat(30000) };
    const m = memory([{ ...input(article.url, 'entry'), payload: { entry: storedEntry(article) } }]);
    m.fail();
    const fetcher = vi.fn<FeedFetcher>();
    const result = await runHistoryBatch(m.store, blog, options(fetcher));
    expect(result.status).toBe('blocked');
    expect([...m.tasks.values()][0].status).toBe('pending');
    expect(m.posts).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(Buffer.byteLength([...m.tasks.values()][0].payload!.entry!.summary)).toBeLessThanOrEqual(60 * 1024);
    expect(m.store.release).toHaveBeenCalledOnce();
  });
  it.each([403, 429])('stops a %i response with a persistent cooldown, never advances task', async (status) => {
    const m = memory([input(`${blog.url}feed`, 'feed'), input(`${blog.url}sitemap.xml`, 'sitemap')]);
    const fetcher = vi.fn<FeedFetcher>(async (url) =>
      String(url).endsWith('/robots.txt') ? new Response('') : new Response('', { status }),
    );
    const result = await runHistoryBatch(m.store, blog, options(fetcher));
    expect(result.status).toBe('blocked');
    expect(m.store.commitTask).not.toHaveBeenCalled();
    expect(m.run.nextAttemptAt).not.toBeNull();
    const before = fetcher.mock.calls.length;
    await runHistoryBatch(m.store, blog, options(fetcher));
    expect(fetcher.mock.calls).toHaveLength(before);
  });
  it('honors robots and leaves blocked work pending', async () => {
    const b = { ...blog, url: 'https://history-robots.test/' };
    const m = memory([{ ...input(`${b.url}feed`, 'feed'), sourceUrl: b.url }]);
    const fetcher = vi.fn<FeedFetcher>(async () => new Response('User-agent: *\nDisallow: /'));
    const result = await runHistoryBatch(m.store, b, options(fetcher));
    expect(result.status).toBe('blocked');
    expect(m.run.lastError).toBe('history_robots_denied');
    expect(m.store.commitTask).not.toHaveBeenCalled();
  });
  it('does not index products in a sitemap, and lease loss stops before fetch', async () => {
    const m = memory([input(`${blog.url}product`, 'article')]);
    const fetcher = vi.fn<FeedFetcher>(async (url) =>
      String(url).endsWith('/robots.txt')
        ? new Response('')
        : new Response('<script type="application/ld+json">{"@type":"Product","name":"shop"}</script>'),
    );
    await runHistoryBatch(m.store, blog, options(fetcher));
    expect(m.posts).toHaveLength(0);
    const lost = memory([input(`${blog.url}feed`, 'feed')]);
    lost.store.assertLease = vi.fn(async () => {
      throw new Error('lease lost');
    });
    fetcher.mockClear();
    await runHistoryBatch(lost.store, blog, options(fetcher));
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('history failed-task recovery', () => {
  it('finishes optional sitemap HTML soft-404 and continues with valid archive, without claiming complete', async () => {
    const m = memory([
      { ...input(`${blog.url}bad.xml`, 'sitemap'), payload: { optional: true } },
      input(`${blog.url}valid.xml`, 'sitemap'),
    ]);
    const fetcher: FeedFetcher = async (url) =>
      String(url).endsWith('/robots.txt')
        ? new Response('')
        : String(url).endsWith('bad.xml')
          ? new Response('<html><title>Not found</title></html>')
          : new Response('<urlset/>');
    const result = await runHistoryBatch(m.store, blog, options(fetcher));
    expect(result.status).toBe('exhausted');
    expect(m.run.tasksDone).toBe(2);
    expect(m.run.warnings).toContain('unavailable-optional-source-invalid');
    expect(m.store.defer).not.toHaveBeenCalled();
  });
  it('retries persistent 5xx at most three times then continues remaining tasks', async () => {
    const m = memory([input(`${blog.url}broken.xml`, 'sitemap'), input(`${blog.url}valid.xml`, 'sitemap')]);
    const fetcher: FeedFetcher = async (url) =>
      String(url).endsWith('/robots.txt')
        ? new Response('')
        : String(url).endsWith('broken.xml')
          ? new Response('down', { status: 503 })
          : new Response('<urlset/>');
    for (let attempt = 0; attempt < 3; attempt++) {
      m.run.nextAttemptAt = null;
      const result = await runHistoryBatch(m.store, blog, options(fetcher));
      expect(result.status).toBe(attempt < 2 ? 'blocked' : 'exhausted');
    }
    expect([...m.tasks.values()][0]).toMatchObject({ status: 'failed', attempts: 3 });
    expect([...m.tasks.values()][1].status).toBe('done');
    expect(m.run.warnings).toContain('failed-task:history_http_503');
  });
  it('retains access-policy blocks after three batches instead of skipping around denial', async () => {
    const m = memory([input(`${blog.url}denied.xml`, 'sitemap')]);
    const fetcher: FeedFetcher = async (url) =>
      String(url).endsWith('/robots.txt') ? new Response('') : new Response('denied', { status: 403 });
    for (let attempt = 0; attempt < 3; attempt++) {
      m.run.nextAttemptAt = null;
      expect((await runHistoryBatch(m.store, blog, options(fetcher))).status).toBe('blocked');
    }
    expect(m.store.failTask).not.toHaveBeenCalled();
    expect([...m.tasks.values()][0].status).toBe('pending');
  });
  it('records article parse gaps and feed-window-only as exhausted, even if a sitemap was enumerated', async () => {
    const m = memory([input(`${blog.url}plain`, 'article')]);
    m.run.archiveSeen = true;
    const fetcher: FeedFetcher = async (url) =>
      String(url).endsWith('/robots.txt') ? new Response('') : new Response('<html><title>Article without machine metadata</title></html>');
    expect((await runHistoryBatch(m.store, blog, options(fetcher))).status).toBe('exhausted');
    expect(m.run.warnings).toContain('article-unparsed');
    const window = memory([input(`${blog.url}feed`, 'feed')]);
    window.run.archiveSeen = true;
    expect(
      (
        await runHistoryBatch(
          window.store,
          blog,
          options(async (url) => (String(url).endsWith('/robots.txt') ? new Response('') : new Response('<rss><channel/></rss>'))),
        )
      ).status,
    ).toBe('exhausted');
  });
});

it('retires already-persisted oEmbed tasks without HTTP and proceeds to other work', async () => {
  const embed = `${blog.url}wp-json/oembed/1.0/embed?url=post&format=xml`;
  const m = memory([input(embed, 'feed'), { ...input(entry(8).url, 'entry'), payload: { entry: storedEntry(entry(8)) } }]);
  const fetcher = vi.fn<FeedFetcher>();
  expect((await runHistoryBatch(m.store, blog, options(fetcher))).status).toBe('exhausted');
  expect(fetcher).not.toHaveBeenCalled();
  expect(m.posts).toHaveLength(1);
  expect([...m.tasks.values()][0].status).toBe('done');
  expect(m.run.warnings).toContain('non-syndication-source');
});

it('classifies failures without persisting private URLs, SQL messages or arbitrary codes', () => {
  const secret = 'private-token-value';
  const cases: Array<[unknown, string]> = [
    [Object.assign(new Error(secret), { name: 'TimeoutError' }), 'history_timeout'],
    [Object.assign(new Error(secret), { cause: { code: 'UND_ERR_BODY_TIMEOUT' } }), 'history_timeout'],
    [new Error(`crawl response exceeds 8388608 bytes ${secret}`), 'history_body_limit'],
    [new Error('invalid_xml_source'), 'history_invalid_xml'],
    [new SyntaxError(`Unexpected token ${secret}`), 'history_invalid_json'],
    [Object.assign(new Error(`INSERT secret ${secret}`), { code: 'ER_DATA_TOO_LONG' }), 'history_sql_er_data_too_long'],
    [Object.assign(new Error(secret), { code: `ER_${secret}`, sqlState: '45000' }), 'history_sql_error'],
    [Object.assign(new Error(secret), { cause: { code: 'ECONNRESET' } }), 'history_connection_error'],
    [new Error(`unsafe crawl address: ${secret}`), 'history_unsafe_target'],
    [new Error(`history_${secret}`), 'history_fetch_or_write_failed'],
  ];
  for (const [error, expected] of cases) {
    expect(historyFailureReason(error)).toBe(expected);
    expect(historyFailureReason(error)).not.toContain(secret);
  }
});
