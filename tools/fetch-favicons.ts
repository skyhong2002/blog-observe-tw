// Blog adaptation of tag.observe.tw afe0a65 tools/fetch-favicons.ts (MIT, Sky Hong).
import { mkdir, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { loadConfig } from '../app/src/config.js';
import { type FaviconTarget, loadFaviconState, MONTH_MS, refreshFavicon } from '../app/src/crawl/favicons.ts';
import { createDb } from '../app/src/db/client.ts';

const args = process.argv.slice(2);
const allowed = new Set(['--all', '--include-candidates', '--monthly', '--help']);
if (args.some((arg) => arg.startsWith('--') && !allowed.has(arg))) throw new Error('unknown option');
if (args.includes('--help')) {
  console.log(
    'node tools/fetch-favicons.ts [--all | --monthly] [--include-candidates] [slug ...]\nDefault: only missing blog icons. --monthly: refresh after 30 days. Candidates never become approved.',
  );
  process.exit(0);
}
const root = resolve(process.env.BLOG_FAVICON_ROOT || new URL('../', import.meta.url).pathname);
await mkdir(resolve(root, 'app/data'), { recursive: true });
const lockPath = resolve(root, 'app/data/.favicon-refresh.lock');
// Exclusive create, no unsafe stale takeover. A crashed owner must be inspected before removal.
const lock = await open(lockPath, 'wx').catch(() => {
  throw new Error('favicon refresh already locked; inspect owner before removing app/data/.favicon-refresh.lock');
});
await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
let close: (() => Promise<void>) | undefined;
try {
  const config = loadConfig();
  const store = createDb(config.blogDbUrl, { poolSize: 1 });
  close = store.close;
  const [blogs] = await store.pool.query<RowDataPacket[]>('SELECT id, slug, name, url FROM blogs ORDER BY id');
  const targets: FaviconTarget[] = blogs.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.name,
    url: row.url || null,
    kind: 'blog',
  }));
  if (args.includes('--include-candidates')) {
    const [candidates] = await store.pool.query<RowDataPacket[]>('SELECT id, name, url FROM discovery_candidates ORDER BY id');
    targets.push(
      ...candidates.map(
        (row): FaviconTarget => ({
          id: row.id,
          slug: `candidate-${row.id}`,
          title: row.name || row.url,
          url: row.url || null,
          kind: 'candidate',
        }),
      ),
    );
  }
  const filter = new Set(args.filter((arg) => !arg.startsWith('--')));
  const state = await loadFaviconState(root);
  const batchCache = new Map<string, string>();
  const summary = {
    blogs: { success: 0, failure: 0, default: 0, skipped: 0 },
    candidates: { success: 0, failure: 0, default: 0, skipped: 0 },
  };
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  for (const target of targets) {
    if (stopped) break;
    if (filter.size && !filter.has(target.slug)) continue;
    const result = await refreshFavicon(target, {
      root,
      state,
      batchCache,
      timeoutMs: 8000,
      maxTargetMs: 30_000,
      all: args.includes('--all'),
      refreshAfterMs: args.includes('--monthly') ? MONTH_MS : undefined,
      userAgent: config.crawlUserAgent,
      delayMs: config.crawlDelayMs,
    });
    summary[target.kind === 'blog' ? 'blogs' : 'candidates'][result.status]++;
    console.log(JSON.stringify({ kind: target.kind, ...result }));
  }
  process.off('SIGTERM', stop);
  process.off('SIGINT', stop);
  console.log(JSON.stringify({ summary, interrupted: stopped }, null, 2));
} finally {
  await close?.();
  await lock.close();
  await unlink(lockPath);
}
