import { readFile } from 'node:fs/promises';
import type { RowDataPacket } from 'mysql2/promise';
import { genreLabel, isBlogGenre } from '../app/src/blog-genre-vocabulary.ts';
import { AI_SITES_LIMIT, type AiSite, tagClient, tagDomain } from '../app/src/blog-genres/traffic.ts';
import { createDb } from '../app/src/db/client.ts';
import { validateGenreSeed } from './lib/genre-seed.ts';

// The AI seed (data/blog-genre-seed.json) as blog's AI suggestions on traffic.observe.tw (2026-10-24): one
// PUT /internal/v1/tags/ai per 500 blogs replaces only what blog suggested for those domains, so reader tags,
// votes, admin overrides and traffic's editors' list survive a rerun. Tags go by name (food → 美食), each with its
// own reason (traffic 2cb1a66); traffic drops political-leaning tags itself. The database is only read, for each
// slug's domain. --slug <slug> applies one blog (a check that a write lands).
//   node --env-file=$HOME/.config/blog-observe.env tools/apply-blog-genres.ts --dry-run | --apply [--slug <slug>]
const [mode, flag, only, ...rest] = process.argv.slice(2);
if (!['--dry-run', '--apply'].includes(mode) || (flag !== undefined && (flag !== '--slug' || !only)) || rest.length)
  throw Error('usage: --dry-run | --apply [--slug <slug>]');
const all = validateGenreSeed(JSON.parse(await readFile(new URL('../data/blog-genre-seed.json', import.meta.url), 'utf8')));
const seed = { ...all, entries: only ? all.entries.filter((entry) => entry.slug === only) : all.entries };
if (only && !seed.entries.length) throw Error(`no seed entry for ${only}`);
const dryRun = mode === '--dry-run';
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
    const tags = entry.genres.map((g) => ({ tag: genreLabel(g.genre), reason: g.reason.trim() }));
    // Two slugs on one domain (none on 2026-10-24) share its suggestions; the first reason for a tag stands.
    const prior = (sites.get(domain)?.tags ?? []) as Array<{ tag: string; reason: string }>;
    sites.set(domain, { domain, tags: [...prior, ...tags.filter((t) => !prior.some((p) => p.tag === t.tag))] });
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
