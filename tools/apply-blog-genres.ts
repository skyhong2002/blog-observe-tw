import { readFile } from 'node:fs/promises';
import type { RowDataPacket } from 'mysql2/promise';
import { genreLabel, isBlogGenre } from '../app/src/blog-genre-vocabulary.ts';
import { AI_SITES_LIMIT, type AiSite, tagClient, tagDomain } from '../app/src/blog-genres/traffic.ts';
import { createDb } from '../app/src/db/client.ts';
import { validateGenreSeed } from './lib/genre-seed.ts';

// The AI seed (data/blog-genre-seed.json) as blog's AI suggestions on traffic.observe.tw (2026-10-24): one
// PUT /internal/v1/tags/ai per 500 blogs replaces only what blog suggested for those domains, so reader tags,
// votes, admin overrides and traffic's editors' list survive a rerun. Tags go by name (food → 美食); traffic keeps
// one reason per site, so each tag's reason is joined into it. The database is only read, for each slug's domain.
//   node --env-file=$HOME/.config/blog-observe.env tools/apply-blog-genres.ts --dry-run | --apply
if (process.argv.length !== 3 || !['--dry-run', '--apply'].includes(process.argv[2])) throw Error('usage: --dry-run | --apply');
const seed = validateGenreSeed(JSON.parse(await readFile(new URL('../data/blog-genre-seed.json', import.meta.url), 'utf8')));
const dryRun = process.argv[2] === '--dry-run';
const own = createDb(undefined, { poolSize: 1 });
try {
  const [rows] = await own.pool.query<RowDataPacket[]>(
    "SET STATEMENT max_statement_time=2 FOR SELECT slug,canonical_host host FROM blogs WHERE status='verified' AND slug IN (?)",
    [seed.entries.map((entry) => entry.slug)],
  );
  const domainOf = new Map(rows.map((row) => [String(row.slug), tagDomain(row.host)]));
  const sites = new Map<string, AiSite>();
  for (const entry of seed.entries) {
    const domain = domainOf.get(entry.slug);
    if (!domain) continue;
    if (entry.genres.some((g) => !isBlogGenre(g.genre))) throw Error('invalid genre');
    const tags = entry.genres.map((g) => genreLabel(g.genre));
    const reason = entry.genres.map((g) => `${genreLabel(g.genre)}：${g.reason.trim()}`).join('\n');
    // Two slugs on one domain (none on 2026-10-24) share its suggestions.
    const prior = sites.get(domain);
    sites.set(
      domain,
      prior ? { domain, tags: [...new Set([...prior.tags, ...tags])], reason: `${prior.reason}\n${reason}` } : { domain, tags, reason },
    );
  }
  const list = [...sites.values()];
  let changed = 0;
  const skipped: unknown[] = [];
  if (!dryRun)
    for (let i = 0; i < list.length; i += AI_SITES_LIMIT) {
      const result = await tagClient().putAi(list.slice(i, i + AI_SITES_LIMIT));
      changed += result.changed;
      skipped.push(...result.skipped);
    }
  console.log(
    JSON.stringify({
      dryRun,
      entries: seed.entries.length,
      matched: list.length,
      notVerified: seed.entries.length - [...domainOf.values()].filter(Boolean).length,
      ...(dryRun ? {} : { changed, skippedByTraffic: skipped }),
    }),
  );
} finally {
  await own.close();
}
