import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('relation graph: blogs drawn as their icons (green dot only without one), labels in the page font, overlaps hidden', () => {
  const graph = read('components/BlogRelationGraph.tsx');
  assert.match(graph, /symbol: src && loaded\.has\(src\) \? `image:\/\/\$\{src\}` : 'circle'/);
  assert.match(graph, /image\.onerror/);
  assert.match(graph, /placeLabels\(/);
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

test('graph labels: most-mentioned names first; a colliding or off-canvas name is left to hover', async () => {
  const { placeLabels } = await import('../src/lib/graph-labels.ts');
  const opts = { maxWidth: 100, lineHeight: 15, gap: 5, pad: 2, width: 400, height: 300 };
  const node = (x: number, y: number, rank: number, wanted = true) => ({ x, y, size: 20, textWidth: 60, rank, wanted });
  // 0 and 1 sit 30px apart: their names collide, and the more-mentioned (1) keeps its name.
  // 2 is far away, 3 is not wanted, 4's name would run off the bottom, 5's name would cover node 6.
  const shown = placeLabels(
    [
      node(100, 100, 2),
      node(130, 100, 5),
      node(300, 100, 1),
      node(300, 200, 9, false),
      node(200, 290, 3),
      node(50, 200, 4),
      node(50, 225, 0, false),
    ],
    opts,
  );
  assert.deepEqual([...shown].sort(), [1, 2]);
  // A long name wraps: two lines tall, so a node just below the first line still blocks it.
  const long = placeLabels([{ x: 200, y: 100, size: 20, textWidth: 180, rank: 1, wanted: true }, node(200, 140, 0, false)], opts);
  assert.equal(long.size, 0);
});
