import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { generatedScraper } from '../app/src/scrapers/contract.ts';
import { PageCache, reportPasses, validateScraper } from '../app/src/scrapers/generate.ts';
import { fetchRendered } from '../app/src/scrapers/render.ts';
import { runInSandbox } from '../app/src/scrapers/sandbox.ts';

// Bound concurrent heavy sandbox validations across all authoring agents without changing runtime limits.
if (!process.argv.includes('--validation-slot-held')) {
  let done = false;
  while (!done) {
    for (let slot = 0; slot < 3; slot++) {
      const code = await new Promise<number>((accept, reject) => {
        const child = spawn(
          'flock',
          [
            '--nonblock',
            '--conflict-exit-code',
            '75',
            join(tmpdir(), `weblog-scraper-validation-${process.getuid?.() ?? 0}-${slot}.lock`),
            process.execPath,
            fileURLToPath(import.meta.url),
            ...process.argv.slice(2),
            '--validation-slot-held',
          ],
          { stdio: 'inherit' },
        );
        child.on('error', reject);
        child.on('close', (status) => accept(status ?? 1));
      });
      if (code !== 75) {
        process.exitCode = code;
        done = true;
        break;
      }
    }
    if (!done) await delay(250);
  }
} else {
  // Read-only validation. Never loads credentials or writes to the database.
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw Error('usage: validate-site-scraper.ts definition.json private-report.json');
  const raw = JSON.parse(await readFile(resolve(input), 'utf8'));
  if (!Number.isSafeInteger(raw.blogId) || raw.blogId <= 0 || typeof raw.home !== 'string') throw Error('invalid_definition');
  const scraper = { ...generatedScraper(raw.scraper, raw.home), render: raw.scraper.render === true };
  const options = { timeoutMs: 10000, delayMs: 1500, userAgent: 'weblog.tw/0.3 (+https://weblog.tw/about; mailto:b@blog.observe.tw)' };
  const pages = new PageCache(options, fetchRendered);
  pages.render = scraper.render;
  const report = await validateScraper(scraper, raw.home, pages, runInSandbox);
  const result = {
    blogId: raw.blogId,
    home: raw.home,
    codeSha256: createHash('sha256').update(scraper.code).digest('hex'),
    definitionSha256: createHash('sha256').update(JSON.stringify(raw)).digest('hex'),
    checkedAt: new Date().toISOString(),
    passed: reportPasses(report),
    fetched: pages.fetched,
    report,
  };
  await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(
    JSON.stringify({
      blogId: result.blogId,
      passed: result.passed,
      listed: report.listed,
      samples: report.samples.length,
      problems: report.problems,
    }),
  );
  if (!result.passed) process.exitCode = 2;
}
