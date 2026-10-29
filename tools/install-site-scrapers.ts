import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDb } from '../app/src/db/client.ts';
import { withJobLease } from '../app/src/jobs/lease.ts';
import { checkedSiteDefinition, installSiteScraper } from '../app/src/scrapers/site-catalog.ts';

const args = process.argv.slice(2),
  apply = args.includes('--apply');
const option = (key: string, fallback: string) => {
  const i = args.indexOf(key);
  return i < 0 ? fallback : args[i + 1] || fallback;
};
const definitions = resolve(option('--definitions-dir', 'data/site-scrapers'));
const reports = resolve(option('--reports-dir', '.reviews/scraper-fleet'));
const output = option('--output', '');
const wanted = option('--ids', '').split(',').filter(Boolean).map(Number);
if (wanted.some((x) => !Number.isSafeInteger(x) || x < 1)) throw Error('invalid_ids');
const reportPaths = new Map<number, string>();
for (const folder of await readdir(reports)) {
  if (!/^agent-\d\d$/.test(folder)) continue;
  for (const file of await readdir(join(reports, folder))) {
    const match = /^(\d+)-validation\.json$/.exec(file);
    if (match) reportPaths.set(Number(match[1]), join(reports, folder, file));
  }
}
const db = apply ? createDb(undefined, { poolSize: 4 }) : null;
const results: object[] = [];
const work = async () => {
  for (const file of (await readdir(definitions)).filter((f) => /^\d+\.json$/.test(f)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10))) {
    const id = parseInt(file, 10);
    if (wanted.length && !wanted.includes(id)) continue;
    try {
      const raw = JSON.parse(await readFile(join(definitions, file), 'utf8'));
      const report = reportPaths.get(id);
      if (!report) {
        results.push({ blogId: id, status: 'held', reason: 'no_validation_report' });
        continue;
      }
      const validation = JSON.parse(await readFile(report, 'utf8'));
      checkedSiteDefinition(raw, validation);
      if (!db) {
        results.push({ blogId: id, status: 'ready', home: raw.home });
        continue;
      }
      let result: Awaited<ReturnType<typeof installSiteScraper>> | undefined;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          result = await installSiteScraper(db.pool, raw, validation);
          break;
        } catch (e) {
          const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : '';
          if (!['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(code) || attempt === 3) throw e;
          await delay(150 * (attempt + 1));
        }
      }
      results.push({ ...result, home: raw.home });
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      const reason =
        /^(?:invalid_site_definition|unusable_site_definition|fresh_matching_validation_required|passing_validation_required)$/.test(
          message,
        )
          ? message
          : 'installation_or_report_failed';
      results.push({ blogId: id, status: 'held', reason });
    }
  }
};
try {
  if (db) {
    if ((await withJobLease(db.pool, 'site-scraper-install', work)) === null) throw Error('installer_busy');
  } else await work();
  const counts: Record<string, number> = {};
  for (const r of results) {
    const s = String((r as { status: string }).status);
    counts[s] = (counts[s] || 0) + 1;
  }
  const summary = { at: new Date().toISOString(), apply, counts, results };
  if (output) await writeFile(resolve(output), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(summary));
} finally {
  await db?.close();
}
