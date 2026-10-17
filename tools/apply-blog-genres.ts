import { readFile, writeFile } from 'node:fs/promises';
import { type GenreReview, genreMap } from './lib/blog-genres.ts';

// Apply the review file to a repository artifact, never to the production database.
if (process.argv.length !== 3 || !['--dry-run', '--apply'].includes(process.argv[2])) throw Error('usage: --dry-run | --apply');
const review: GenreReview = JSON.parse(await readFile(new URL('../data/blog-genre-review.json', import.meta.url), 'utf8'));
const next = JSON.stringify(genreMap(review), null, 2) + '\n';
const path = new URL('../data/blog-genres.json', import.meta.url);
const previous = await readFile(path, 'utf8').catch((error) => {
  if (error.code !== 'ENOENT') throw error;
  return '';
});
if (process.argv[2] === '--apply' && next !== previous) await writeFile(path, next);
console.log(JSON.stringify({ dryRun: process.argv[2] === '--dry-run', changed: next !== previous, classified: review.entries.length }));
