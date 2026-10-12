import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { brand, brandMark, contrast } from '../src/lib/brand.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const zinc = { 50: '#fafafa', 100: '#f4f4f5', 800: '#27272a', 900: '#18181b', 950: '#09090b' };
const white = '#ffffff';

test('globals.css brand tokens equal lib/brand.ts', () => {
  const css = read('../src/app/globals.css');
  for (const [step, hex] of Object.entries(brand)) {
    assert.match(css, new RegExp(`--color-brand-${step}: ${hex};`), `brand-${step}`);
  }
  assert.doesNotMatch(css, /--color-brand-\d+: var\(--color-orange/);
});

test('primary text pairs meet WCAG AA 4.5:1 in light and dark', () => {
  const pairs: Array<[string, string, string]> = [
    ['brand-700 on white', brand[700], white],
    ['brand-700 on zinc-50 (page)', brand[700], zinc[50]],
    ['brand-700 on zinc-100 (chips)', brand[700], zinc[100]],
    ['brand-700 on brand-50 (hover tint)', brand[700], brand[50]],
    ['brand-800 on brand-50 (nav current)', brand[800], brand[50]],
    ['brand-800 on brand-100 (pressed, avatar)', brand[800], brand[100]],
    ['white on brand-700 (buttons, badge)', white, brand[700]],
    ['white on brand-800 (button hover)', white, brand[800]],
    ['brand-400 on zinc-950 (dark page)', brand[400], zinc[950]],
    ['brand-400 on zinc-900 (dark panel)', brand[400], zinc[900]],
    ['brand-400 on zinc-800 (dark chips)', brand[400], zinc[800]],
    ['brand-300 on brand-950 (dark nav current)', brand[300], brand[950]],
    ['brand-200 on brand-900 (dark pressed, avatar)', brand[200], brand[900]],
  ];
  for (const [name, fg, bg] of pairs) assert.ok(contrast(fg, bg) >= 4.5, `${name}: ${contrast(fg, bg).toFixed(2)}`);
});

test('chart and logo marks keep 3:1 non-text contrast', () => {
  assert.ok(contrast(brandMark(false), white) >= 3);
  assert.ok(contrast(brandMark(true), zinc[950]) >= 3);
  assert.ok(contrast(brand[600], '#1c1c1f') >= 3, 'icon mark on icon tile');
});

test('logo, icon and og SVG use the green mark, not the old vermilion', () => {
  for (const path of [
    '../src/components/Logo.tsx',
    '../src/app/icon.svg',
    '../public/brand/icon.svg',
    '../public/brand/logo.svg',
    '../public/brand/maskable.svg',
    '../public/brand/og.svg',
  ]) {
    const source = read(path);
    assert.ok(source.includes(`fill="${brand[600]}"`), path);
    assert.ok(!/#d9480f/i.test(source), path);
  }
});

/** Decoded RGBA of a PNG (or an ICO's PNG frame), via the web app's own sharp dependency. */
async function pixels(input: Buffer) {
  const { default: sharp } = await import('sharp');
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { at: (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 3)], data, ...info };
}
const near = (rgb: number[], hex: string, tolerance: number) =>
  rgb.every((value, i) => Math.abs(value - Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)) <= tolerance);
const vermilion = (data: Buffer) => {
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128 && near([data[i], data[i + 1], data[i + 2]], '#d9480f', 40)) return true;
  return false;
};
const file = (path: string) => readFileSync(new URL(path, import.meta.url));

test('generated PNG/ICO assets carry the green mark (tools/brand-assets.py output)', async () => {
  // Mark centre in the 512 icon is (429, 414); other assets place the same drawing at these points.
  const cases: Array<[string, number, number]> = [
    ['../public/pwa/icon-512.png', 429, 414],
    ['../public/pwa/icon-192.png', Math.round((429 * 192) / 512), Math.round((414 * 192) / 512)],
    ['../src/app/apple-icon.png', Math.round((429 * 180) / 512), Math.round((414 * 180) / 512)],
    ['../public/pwa/maskable-512.png', Math.round(64 + 429 * 0.75), Math.round(64 + 414 * 0.75)],
    ['../public/pwa/maskable-192.png', Math.round(((64 + 429 * 0.75) * 192) / 512), Math.round(((64 + 414 * 0.75) * 192) / 512)],
    ['../public/opengraph-image.png', 70 + 270, 60 + 237],
  ];
  for (const [path, x, y] of cases) {
    const image = await pixels(file(path));
    assert.ok(near(image.at(x, y), brand[600], 24), `${path} @${x},${y}: ${image.at(x, y)}`);
    assert.ok(!vermilion(image.data), `${path} still has vermilion pixels`);
  }
});

test('favicon.ico frames are green, not vermilion', async () => {
  const ico = file('../src/app/favicon.ico');
  assert.equal(ico.readUInt16LE(2), 1, 'ICO type');
  const count = ico.readUInt16LE(4);
  assert.ok(count >= 3);
  let largest: Awaited<ReturnType<typeof pixels>> | null = null;
  for (let i = 0; i < count; i++) {
    const size = ico.readUInt32LE(6 + i * 16 + 8);
    const offset = ico.readUInt32LE(6 + i * 16 + 12);
    const frame = await pixels(ico.subarray(offset, offset + size));
    assert.ok(!vermilion(frame.data), `frame ${frame.width}px still has vermilion pixels`);
    if (!largest || frame.width > largest.width) largest = frame;
  }
  assert.ok(largest && largest.width >= 48);
  const greenish = (data: Buffer) => {
    for (let i = 0; i < data.length; i += 4)
      if (data[i + 3] > 128 && near([data[i], data[i + 1], data[i + 2]], brand[600], 48)) return true;
    return false;
  };
  assert.ok(greenish(largest.data), 'largest favicon frame shows the green mark');
});
