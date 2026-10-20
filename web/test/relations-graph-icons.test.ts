import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('relation graph: blogs drawn as their icons (first-character glyph without one), labels in the page font, overlaps hidden', () => {
  const graph = read('components/BlogRelationGraph.tsx');
  assert.match(graph, /symbol: src && loaded\.has\(src\) \? `image:\/\/\$\{src\}` : glyphSymbol\(n\.name, dark\)/);
  assert.match(graph, /image\.onerror/);
  assert.match(graph, /placeLabels\(/);
  assert.match(graph, /fontFamily: getComputedStyle\(document\.body\)\.fontFamily/);
});

test('relation lists keep each icon and name on one line', () => {
  const map = read('components/public/RelationMap.tsx');
  assert.match(map, /className="inline-flex min-w-0 items-center gap-1\.5/);
  assert.match(map, /<li className="flex items-center gap-3 py-2\.5 text-sm"/);
  assert.match(map, /rounded-full border border-zinc-300/);
  // Phones: both list cards may shrink below their widest pair of chips (no sideways page scroll).
  assert.equal(map.match(/<section className="min-w-0 rounded-xl border border-zinc-300 p-4/g)?.length, 2);
  assert.doesNotMatch(map, /<p className="mt-1 text-xs text-zinc-500">期間內兩個方向/);
});

test('relation graph: fitted into view at every width; only blogs mentioned twice or more keep a permanent name', () => {
  const graph = read('components/BlogRelationGraph.tsx');
  assert.doesNotMatch(graph, /fitted = !narrow/);
  assert.match(graph, /wanted: \(incoming\.get\(n\.id\) \?\? 0\) >= LABELLED_MENTIONS/);
  assert.match(graph, /layout: placed \? 'none' : 'force'/);
  assert.match(graph, /emphasis: \{ focus: 'adjacency', label: \{ show: true \} \}/);
  // A resize before the first setOption fires 'finished' with no model; it must neither throw nor use up the fit.
  assert.match(graph, /\.getModel\(\)\s*\?\.getSeriesByIndex\(0\)/);
  assert.match(graph, /if \(!points\.length \|\| points\.length !== linked\.length\) return;\s*settled =/);
});

test('graph labels: points fill the canvas inside its margins', async () => {
  const { fitPoints } = await import('../src/lib/graph-labels.ts');
  const out = fitPoints(
    [
      [0, 0],
      [10, 10],
      [5, 2],
    ],
    400,
    300,
    { side: 20, above: 10, below: 40 },
  );
  assert.deepEqual(out[0], [20, 10]);
  assert.deepEqual(out[1], [380, 260]);
  // A very wide layout in a square canvas is stretched at most 1.6× vertically, and centred.
  const wide = fitPoints(
    [
      [0, 0],
      [100, 10],
    ],
    200,
    200,
    { side: 0, above: 0, below: 0 },
  );
  assert.deepEqual(wide[0], [0, 100 - 16]);
  assert.deepEqual(wide[1], [200, 100 + 16]);
});

test('graph labels: most-mentioned names first, on a free side; a name with no free side is left to hover', async () => {
  const { placeLabels } = await import('../src/lib/graph-labels.ts');
  const opts = { maxWidth: 100, lineHeight: 15, gap: 5, pad: 2, width: 400, height: 300 };
  const node = (x: number, y: number, rank: number, wanted = true) => ({ x, y, size: 20, textWidth: 60, rank, wanted });
  // 1 claims the space below; 0 (30px left of it, less mentioned) moves its name above.
  const pair = placeLabels([node(100, 100, 2), node(130, 100, 5)], opts);
  assert.deepEqual(
    [...pair],
    [
      [1, 'bottom'],
      [0, 'top'],
    ],
  );
  // Unwanted names never show; at the bottom edge the name goes above instead of off the canvas.
  const edge = placeLabels([node(300, 100, 9, false), node(200, 290, 3)], opts);
  assert.deepEqual([...edge], [[1, 'top']]);
  // Boxed in by nodes on all four sides: no name, unless it is among the mustShow most mentioned.
  const boxed = [node(200, 150, 4), node(200, 185, 0, false), node(200, 115, 0, false), node(245, 150, 0, false), node(155, 150, 0, false)];
  assert.equal(placeLabels(boxed, opts).size, 0);
  assert.deepEqual([...placeLabels(boxed, { ...opts, mustShow: 1 })], [[0, 'bottom']]);
});
