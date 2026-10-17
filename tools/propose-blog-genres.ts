import { readFile, writeFile } from 'node:fs/promises';
import { proposeGenres } from './lib/blog-genres.ts';

// Input is a bounded read-only export: { observedAt, blogs, tags }. No database connection is opened.
const input = process.argv[process.argv.indexOf('--input') + 1];
if (!process.argv.includes('--input') || !input) throw Error('usage: --input snapshot.json [--dry-run]');
const snapshot = JSON.parse(await readFile(input, 'utf8'));
const review = proposeGenres(snapshot.blogs, snapshot.tags, snapshot.observedAt);
if (!process.argv.includes('--dry-run'))
  await writeFile(new URL('../data/blog-genre-review.json', import.meta.url), JSON.stringify(review, null, 2) + '\n');
console.log(
  JSON.stringify({ total: review.totalBlogs, classified: review.entries.length, unclassified: review.totalBlogs - review.entries.length }),
);
