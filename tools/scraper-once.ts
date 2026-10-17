import { loadConfig } from '../app/src/config.js';
import { createDb } from '../app/src/db/client.ts';
import { runScraperRepairBatch } from '../app/src/scrapers/repair.ts';

// npm run scraper:once -- [--candidate ID | --blog ID [--trigger feed_dead|scraper_failing|content_failing]] [--code] [--apply]
// Without a target it picks what the worker would. Without --apply nothing is written: the code and its live
// validation report are printed for review. Operator runs skip the daily generation budget, not the model-call one.
const args = process.argv.slice(2);
const id = (flag: string) => {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const n = Number(args[i + 1]);
  if (!Number.isSafeInteger(n) || n < 1) throw Error(`invalid ${flag}`);
  return n;
};
const trigger = args.includes('--trigger') ? args[args.indexOf('--trigger') + 1] : undefined;
if (trigger && !['feed_dead', 'scraper_failing', 'content_failing'].includes(trigger)) throw Error('invalid --trigger');
const config = loadConfig();
const db = createDb(config.blogDbUrl, { poolSize: 2 });
try {
  const outcome = await runScraperRepairBatch(db.pool, {
    apply: args.includes('--apply'),
    operator: true,
    candidateId: id('--candidate'),
    blogId: id('--blog'),
    trigger: trigger as 'feed_dead' | 'scraper_failing' | 'content_failing' | undefined,
    userAgent: config.crawlUserAgent,
    delayMs: 1500,
    timeoutMs: 15000,
  });
  const generation = outcome.generation;
  const code = generation?.ok ? generation.scraper.code : null;
  console.log(
    JSON.stringify(
      {
        ...outcome,
        generation: generation && {
          ...generation,
          ...(generation.ok ? { scraper: { ...generation.scraper, code: `${code!.length} characters` } } : {}),
        },
      },
      null,
      2,
    ),
  );
  if (code && args.includes('--code')) console.log(code);
} finally {
  await db.close();
}
