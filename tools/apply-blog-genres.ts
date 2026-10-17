import { readFile } from 'node:fs/promises';
import type { RowDataPacket } from 'mysql2/promise';
import { isBlogGenre } from '../app/src/blog-genre-vocabulary.ts';
import { createDb } from '../app/src/db/client.ts';
import { validateGenreSeed } from './lib/genre-seed.ts';

if (process.argv.length !== 3 || !['--dry-run', '--apply'].includes(process.argv[2])) throw Error('usage: --dry-run | --apply');
const seed = validateGenreSeed(JSON.parse(await readFile(new URL('../data/blog-genre-seed.json', import.meta.url), 'utf8')));
const dryRun = process.argv[2] === '--dry-run';
const own = createDb(undefined, { poolSize: 1 });
let matched = 0;
try {
  for (const entry of seed.entries) {
    const c = await own.pool.getConnection();
    try {
      if (!dryRun) await c.beginTransaction();
      const [[blog]] = await c.query<RowDataPacket[]>(
        dryRun
          ? "SET STATEMENT max_statement_time=1 FOR SELECT id FROM blogs WHERE slug=? AND status='verified' LIMIT 1"
          : "SELECT id FROM blogs WHERE slug=? AND status='verified' LIMIT 1 FOR UPDATE",
        [entry.slug],
      );
      if (blog) {
        matched++;
        if (!dryRun) {
          // Only replace the AI baseline; admin overrides and all votes survive a rerun.
          for (const assignment of entry.genres) {
            if (!isBlogGenre(assignment.genre)) throw Error('invalid genre');
            await c.execute(
              `INSERT INTO blog_genre_assignments (blog_id,genre,source,status,reason,created_at,updated_at)
               VALUES (?,?,'ai','active',?,?,?)
               ON DUPLICATE KEY UPDATE status=VALUES(status),reason=VALUES(reason),updated_at=VALUES(updated_at)`,
              [blog.id, assignment.genre, assignment.reason, entry.labelledAt, entry.labelledAt],
            );
          }
          await c.query("DELETE FROM blog_genre_assignments WHERE blog_id=? AND source='ai' AND genre NOT IN (?)", [
            blog.id,
            entry.genres.map((g) => g.genre),
          ]);
        }
      }
      if (!dryRun) await c.commit();
    } catch (error) {
      if (!dryRun) await c.rollback();
      throw error;
    } finally {
      c.release();
    }
  }
  console.log(JSON.stringify({ dryRun, entries: seed.entries.length, matched, skipped: seed.entries.length - matched }));
} finally {
  await own.close();
}
