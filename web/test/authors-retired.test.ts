import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NAV_GROUPS } from '../src/lib/site-nav.ts';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('the author list is retired: no menu entry, old links redirect to the directory, which counts authors per blog', () => {
  assert.ok(NAV_GROUPS.every((group) => group.links.every((link) => link.href !== '/authors/')));
  assert.match(read('app/authors/page.tsx'), /permanentRedirect\('\/blogs\/'\)/);
  assert.doesNotMatch(read('app/page.tsx'), /\/authors\//);
  assert.doesNotMatch(read('components/SourceProfile.tsx'), /\/authors\//);
  const catalog = read('components/public/BlogCatalog.tsx');
  assert.match(catalog, /<Th col="authors" label="作者"/);
  // Names, URLs, counts and dates share the row baseline.
  assert.match(catalog, /\[&>td\]:align-baseline/);
});
