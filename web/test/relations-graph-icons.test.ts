import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('relation graph: blogs drawn as their icons (green dot only without one), labels in the page font, overlaps hidden', () => {
  const graph = read('components/BlogRelationGraph.tsx');
  assert.match(graph, /symbol: src && loaded\.has\(src\) \? `image:\/\/\$\{src\}` : 'circle'/);
  assert.match(graph, /image\.onerror/);
  assert.match(graph, /labelLayout: \{ hideOverlap: true \}/);
  assert.match(graph, /fontFamily: getComputedStyle\(document\.body\)\.fontFamily/);
});

test('relation lists keep each icon and name on one line', () => {
  const map = read('components/public/RelationMap.tsx');
  assert.match(map, /className="inline-flex min-w-0 items-center gap-1\.5/);
  assert.match(map, /<li className="flex items-center justify-between gap-4 py-3 text-sm"/);
  assert.match(map, /className="flex flex-wrap items-center gap-x-1\.5 gap-y-1"/);
});

test('relation graph: fitted into view at every width; only blogs mentioned twice or more keep a permanent name', () => {
  const graph = read('components/BlogRelationGraph.tsx');
  assert.doesNotMatch(graph, /fitted = !narrow/);
  assert.match(graph, /label: \{ show: \(incoming\.get\(n\.id\) \?\? 0\) >= LABELLED_MENTIONS \}/);
  assert.match(graph, /emphasis: \{ focus: 'adjacency', label: \{ show: true \} \}/);
  // A resize before the first setOption fires 'finished' with no model; it must neither throw nor use up the fit.
  assert.match(graph, /\.getModel\(\)\s*\?\.getSeriesByIndex\(0\)/);
  assert.match(graph, /if \(!points\.length\) return;\s*fitted = true;/);
});
