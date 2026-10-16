import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalog = readFileSync(new URL('../src/components/public/BlogCatalog.tsx', import.meta.url), 'utf8');

test('/blogs/ search filters as you type without reloading the page (tag.observe.tw /media/traffic/)', () => {
  // No submit round trip: 250 ms after the last keystroke, or at once on Enter, ?q= follows via replaceState.
  assert.match(catalog, /setTimeout\(\(\) => go\(value\), 250\)/);
  assert.match(catalog, /event\.preventDefault\(\);\s*go\(text\);/);
  assert.match(catalog, /window\.history\.replaceState\(null, '', /);
  assert.doesNotMatch(catalog, /type="submit"/);
  // The box is never remounted per query (it would drop the caret mid-word).
  assert.doesNotMatch(catalog, /key=\{q\}/);
  // Only a column the reader clicked survives a new search; the default order would hide best-match ranking.
  assert.match(catalog, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(catalog, /if \(sort === 'relevance' \|\| \(sort === 'latest' && dir === 'desc'\)\)/);
});

test('/blogs/ search shows what matched and keeps the previous rows while loading', () => {
  assert.match(catalog, /<Highlight text=\{blog\.name\} words=\{words\} \/>/);
  assert.match(catalog, /normalize\('NFKC'\)/);
  assert.match(catalog, /符合「\$\{q\}」的部落格 \$\{total\} 個/);
  assert.match(catalog, /沒有符合「\$\{q\}」的部落格。/);
  assert.match(catalog, /status="ready" busy \/>/);
  // Phones: 16px text so iOS does not zoom into the box.
  assert.match(catalog, /text-base sm:text-sm/);
});
