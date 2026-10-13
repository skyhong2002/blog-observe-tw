import assert from 'node:assert/strict';
import test from 'node:test';
import { contrast, parseColor } from './contrast-audit.mjs';

test('WCAG endpoints and opaque compositing', () => {
  assert.equal(contrast('#ffffff', '#000000').ratio, 21);
  assert.equal(contrast('#ffffff', '#000000', 0).ratio, 1);
  assert.ok(Math.abs(contrast('#ffffff', '#000000', 0.5).ratio - 5.28082) < 0.0001);
});
test('OKLCH conversion neutral and red reference, explicit clipping', () => {
  assert.ok(parseColor('oklch(100% 0 0)').every((x) => Math.abs(x - 1) < 0.0001));
  assert.ok(parseColor('oklch(62.795536% .2576833 29.233885)').every((x, i) => Math.abs(x - (i === 0 ? 1 : 0)) < 0.001));
  assert.ok(parseColor('oklch(70% .4 30)').every((x) => x >= 0 && x <= 1));
});
test('CSS D50 Lab adaptation approximates deployed zinc fallback', () => {
  const rgb = parseColor('lab(47.8878% 1.65477 -5.77283)');
  assert.ok(rgb.every((x, i) => Math.abs(x - [113, 113, 123][i] / 255) < 0.003));
});
test('unknown colors and invalid inputs remain unknown', () => {
  for (const c of ['transparent', 'var(--unknown)', 'color(display-p3 1 0 0)', 'oklch(200% 0 0)'])
    assert.equal(contrast(c, '#000000').status, 'unknown');
  assert.equal(contrast('#ffffff', '#000000', 2).status, 'unknown');
});
