import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadConfig } from '../app/src/config.js';
import { applyVerifiedSeed } from '../app/src/crawl/seed-url-resolution.ts';
import { validateSeedUrl } from '../app/src/crawl/seed-url-validation.ts';
import { createDb } from '../app/src/db/client.ts';

const args = process.argv.slice(2);
const reportArg = args.indexOf('--report');
if (reportArg < 0 || !args[reportArg + 1])
  throw new Error('usage: resolve-seed-urls.ts research.json [research.json] --report private.json [--apply] [--ids 2,3]');
const reportPath = resolve(args[reportArg + 1]);
const files = args.slice(0, reportArg);
const apply = args.includes('--apply');
const idsArg = args.indexOf('--ids');
const ids = idsArg >= 0 ? new Set(args[idsArg + 1].split(',').map(Number)) : null;
type Research = {
  id: number;
  urls: string[];
  sourceUrls?: string[];
  aliases?: string[];
  evidence?: Array<{ url: string; title?: string; note?: string; excerpt?: string }>;
  notes?: string;
};
const records = new Map<number, Research>();
for (const file of files) for (const row of JSON.parse(await readFile(file, 'utf8')) as Research[]) records.set(row.id, row);
const config = loadConfig();
const store = createDb(config.blogDbUrl, { poolSize: 2 });
const report: { generatedAt: string; apply: boolean; results: unknown[] } = { generatedAt: new Date().toISOString(), apply, results: [] };
await mkdir(dirname(reportPath), { recursive: true, mode: 0o700 });
async function checkpoint() {
  await writeFile(reportPath + '.tmp', JSON.stringify(report, null, 2), { mode: 0o600 });
  await rename(reportPath + '.tmp', reportPath);
}
try {
  const [rows] = await store.pool.query('SELECT id,slug,name,url,status FROM blogs ORDER BY id');
  for (const blog of rows as Array<{ id: number; slug: string; name: string; url: string | null; status: string }>) {
    if (blog.url || (ids && !ids.has(blog.id))) continue;
    const research = records.get(blog.id);
    if (!research?.urls.length) {
      report.results.push({ id: blog.id, name: blog.name, status: 'unresolved', reason: 'no-research-candidate' });
      await checkpoint();
      continue;
    }
    const attempts = [];
    const researchEvidence = (research.aliases ?? []).flatMap((alias) =>
      (research.evidence ?? [])
        .filter((e) => `${e.title ?? ''} ${e.note ?? ''} ${e.excerpt ?? ''}`.includes(alias))
        .map((e) => ({ alias, sourceUrl: e.url, excerpt: `${e.title ?? ''} ${e.note ?? ''} ${e.excerpt ?? ''}`.slice(0, 1500) })),
    );
    for (const url of [...new Set(research.urls)].slice(0, 4)) {
      const check = await validateSeedUrl(
        { id: blog.id, name: blog.name, url, sourceUrls: research.sourceUrls, aliases: research.aliases, researchEvidence },
        { userAgent: config.crawlUserAgent, delayMs: config.crawlDelayMs, timeoutMs: 10000 },
      );
      attempts.push(check);
    }
    const valid = attempts.filter((r) => r.validated);
    const identities = new Set(valid.map((r) => r.finalUrl));
    let outcome: unknown;
    try {
      if (identities.size === 1)
        outcome = apply ? await applyVerifiedSeed(store.pool, valid[0]) : { status: 'verified-dry-run', url: valid[0].finalUrl };
      else
        outcome = {
          status: 'unresolved',
          reason: identities.size > 1 ? 'multiple-verified-identities' : attempts.map((r) => r.reason).join(';'),
        };
    } catch {
      // DB errors may contain connection details: keep logs and reports generic.
      outcome = { status: 'unresolved', reason: 'apply-transaction-failed' };
    }
    report.results.push({ id: blog.id, name: blog.name, research, attempts, outcome });
    await checkpoint();
    console.log(JSON.stringify({ id: blog.id, name: blog.name, ...(outcome as object) }));
  }
} finally {
  await checkpoint();
  await store.close();
}
