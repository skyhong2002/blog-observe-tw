/**
 * node --env-file=<private-env> tools/repair-content-platforms.ts [--fetch-slug <slug>]... [--apply]
 * Default: read-only preview. Lists inferred content platforms that the blog's own technology scan contradicts, and the
 * WordPress guesses nothing confirms. --apply writes the changes, after saving the rows as they are to
 * ~/Backups/content-platform-repair-<date>/changed.tsv.
 * --fetch-slug reads that blog's home page once (polite, robots as configured) and uses what the page itself says; use it
 * only for named blogs, never in bulk. The pinned Wappalyzer rules must be installed (tools/fetch-wappalyzer-rules.ts).
 */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../app/src/config.js';
import { applyPlatformRepair, type PlatformChange, planPlatformRepair } from '../app/src/content/platform-repair.ts';
import { politeFetch, readFeedBody } from '../app/src/crawl/feed.ts';
import { createDb } from '../app/src/db/client.ts';
import { documentPlatform } from '../app/src/tech/platform.ts';
import { activeWappalyzerRules } from '../app/src/tech/wappalyzer/rules.ts';

const apply = process.argv.includes('--apply');
const slugs = process.argv.flatMap((value, index) =>
  value === '--fetch-slug' && process.argv[index + 1] ? [process.argv[index + 1]] : [],
);
let db: ReturnType<typeof createDb> | undefined;
try {
  if (!activeWappalyzerRules()) throw new Error('rules_not_installed');
  const config = loadConfig();
  db = createDb(undefined, { poolSize: 1 });
  const fresh = new Map<number, ReturnType<typeof documentPlatform>>();
  for (const slug of slugs) {
    const [found] = await db.pool.query('SELECT id,url FROM blogs WHERE slug=? AND status=? LIMIT 1', [slug, 'verified']);
    const blog = (found as { id: number; url: string }[])[0];
    if (!blog) {
      console.log(JSON.stringify({ slug, skipped: 'not_found' }));
      continue;
    }
    const response = await politeFetch(blog.url, { accept: 'text/html' }, { userAgent: config.crawlUserAgent });
    const html = response.ok ? await readFeedBody(response) : '';
    const platform = html ? documentPlatform(response.url || blog.url, html, response.headers) : null;
    fresh.set(blog.id, platform);
    console.log(JSON.stringify({ slug, status: response.status, platform }));
  }
  const plan = await planPlatformRepair(db.pool, fresh);
  for (const change of plan.changes) console.log(JSON.stringify(change));
  const summary = {
    changes: plan.changes.length,
    confirmed: plan.confirmed,
    unverifiedWordpress: plan.unverified.length,
    applied: false,
    changed: 0,
  };
  if (apply && plan.changes.length) {
    const directory = join(homedir(), 'Backups', `content-platform-repair-${new Date().toISOString().slice(0, 10)}`);
    const backup = (changes: PlatformChange[]) => {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
      writeFileSync(
        join(directory, 'changed.tsv'),
        ['blog_id\tslug\tfrom\tto\tevidence', ...changes.map((c) => [c.blogId, c.slug, c.from, c.to, c.evidence].join('\t'))].join('\n'),
        { mode: 0o600 },
      );
    };
    summary.changed = await applyPlatformRepair(db.pool, plan, backup);
    summary.applied = true;
  }
  console.log(JSON.stringify(summary));
  if (plan.unverified.length) console.log(JSON.stringify({ unverifiedWordpress: plan.unverified.map((row) => row.slug) }));
} catch (error) {
  // Driver messages can contain credentials: never print them.
  console.error(
    JSON.stringify({
      error: error instanceof Error && error.message === 'rules_not_installed' ? 'rules_not_installed' : 'platform_repair_failed',
    }),
  );
  process.exitCode = 1;
} finally {
  await db?.close();
}
