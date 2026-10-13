// lib/shared-labels.ts over synthetic sharedLabels fixtures: none of these is a real tag.observe.tw answer.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  relationCountText,
  relationDepthText,
  relationGroups,
  SHARED_LABEL_SHOWN,
  type SharedLabelRelations,
  sharedLabelPath,
  sharedLabelsView,
  sharedLabelTagOk,
  visualImage,
} from '../src/lib/shared-labels.ts';

const TAG = '旅行';
const SHA = 'b8d030c747f87c997800371e33e1ab2d168ad257';
const hex = (n: number) => n.toString(16).padStart(64, '0');
const tagPath = (label: string) => `/tag/${encodeURIComponent(label)}/`;
const IMAGE = `/api/v1/tags/${encodeURIComponent(TAG)}/visual-image?v=abc123`;

const relation = (id: string, type: string, label: string, more: Record<string, unknown> = {}) => ({
  id,
  type,
  target: { id: hex(label.length + id.length), label, href: tagPath(label) },
  source: 'manual',
  sourceDetail: 'curator',
  createdAt: '2026-09-01T00:00:00.000Z',
  status: 'approved',
  inherited: false,
  depth: 1,
  ...more,
});
const relationsData = (relations: unknown[] = [relation('r1', 'is-a', '戶外活動')], more: Record<string, unknown> = {}) => ({
  tag: TAG,
  tagId: hex(1),
  truncated: false,
  relations,
  ...more,
});
const visualData = (visual: Record<string, unknown> | null = {}) => ({
  tag: TAG,
  visual:
    visual === null
      ? null
      : {
          kind: 'place',
          emoji: null,
          label: '旅行',
          wikidataId: 'Q61509',
          image: IMAGE,
          large: `${IMAGE}&size=large`,
          source: {
            pageUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
            license: 'CC BY-SA 4.0',
            licenseUrl: null,
            artist: null,
          },
          ...visual,
        },
});
const snap = (data: unknown, more: Record<string, unknown> = {}) => ({
  status: 'ready',
  fetchedAt: '2026-10-12T04:00:00.000Z',
  expiresAt: '2026-10-13T04:00:00.000Z',
  sourceContractSha: SHA,
  payloadVersion: null,
  data,
  ...more,
});
const enabled = (relations: unknown = snap(relationsData()), visual: unknown = snap(visualData())) => ({
  status: 'enabled',
  source: 'https://tag.observe.tw',
  relations,
  visual,
});

test('absent, not-enabled and values that do not say enabled render nothing', () => {
  for (const value of [undefined, null, {}, 'enabled', [], { status: 'not-enabled' }, { status: 'on' }, 1]) {
    assert.equal(sharedLabelsView(value, TAG), null, JSON.stringify(value));
  }
});

test('ready snapshots keep the parser shape, fetch time and contract, and no payload version', () => {
  const view = sharedLabelsView(enabled(), TAG);
  assert.ok(view);
  assert.equal(view.source, 'https://tag.observe.tw');
  assert.equal(view.tagHref, `https://tag.observe.tw${tagPath(TAG)}`);
  assert.equal(view.relations.state, 'ready');
  assert.equal(view.relations.fetchedAt, '2026-10-12T04:00:00.000Z');
  assert.equal(view.relations.contractSha, SHA);
  if (view.relations.state === 'ready') assert.equal(view.relations.data.relations[0].target.label, '戶外活動');
  assert.equal(view.visual.state, 'ready');
  if (view.visual.state === 'ready' && view.visual.data.visual) {
    assert.equal(visualImage(view.visual.data.visual), `https://tag.observe.tw${IMAGE}`);
  }
});

test('missing and unavailable stay what they are, apart from each other and from an empty answer', () => {
  const view = sharedLabelsView(
    enabled(snap(undefined, { status: 'missing', fetchedAt: null }), snap(undefined, { status: 'unavailable' })),
    TAG,
  );
  assert.equal(view?.relations.state, 'missing');
  assert.equal(view?.relations.fetchedAt, null);
  assert.equal(view?.visual.state, 'unavailable');
  const empty = sharedLabelsView(enabled(snap(relationsData([])), snap(visualData(null))), TAG);
  assert.equal(empty?.relations.state, 'ready');
  assert.equal(empty?.visual.state, 'ready');
});

test('a bad half is unavailable on its own; the other half still renders', () => {
  const bad: Array<[string, unknown]> = [
    ['not an object', 'oops'],
    ['another tag', relationsData(undefined, { tag: '露營' })],
    ['bad tagId', relationsData(undefined, { tagId: 'x' })],
    ['unknown type', relationsData([relation('r1', 'parent', '戶外活動')])],
    ['not approved', relationsData([relation('r1', 'is-a', '戶外活動', { status: 'pending' })])],
    ['depth 0', relationsData([relation('r1', 'is-a', '戶外活動', { depth: 0 })])],
    ['inherited missing', relationsData([relation('r1', 'is-a', '戶外活動', { inherited: undefined })])],
    [
      'outside link',
      relationsData([relation('r1', 'is-a', '戶外活動', { target: { id: hex(9), label: '戶外活動', href: 'https://evil.example/' } })]),
    ],
    [
      'href for another label',
      relationsData([relation('r1', 'is-a', '戶外活動', { target: { id: hex(9), label: '戶外活動', href: tagPath('別的') } })]),
    ],
    [
      'group href mismatch',
      relationsData([relation('r1', 'related', '群組', { target: { id: 'group:3', label: '群組', href: '/group/4/' } })]),
    ],
    ['control character', relationsData([relation('r1', 'is-a', '戶外\u0000活動')])],
  ];
  for (const [name, data] of bad) {
    const view = sharedLabelsView(enabled(snap(data)), TAG);
    assert.equal(view?.relations.state, 'unavailable', name);
    assert.equal(view?.visual.state, 'ready', name);
  }
  const group = sharedLabelsView(
    enabled(snap(relationsData([relation('g', 'related', '群組', { target: { id: 'group:3', label: '群組', href: '/group/3/' } })]))),
    TAG,
  );
  assert.equal(group?.relations.state, 'ready');
});

test('only the upstream visual-image path for this tag passes; anything else makes the visual unavailable', () => {
  const images = [
    'https://evil.example/a.png',
    '//evil.example/api/v1/tags/x/visual-image?v=1',
    `https://tag.observe.tw${IMAGE}`,
    `/api/v1/tags/${encodeURIComponent('露營')}/visual-image?v=abc123`,
    `${IMAGE}&w=1`,
    `${IMAGE}&size=small`,
    `${IMAGE}&accent=zzzzzz`,
    `${IMAGE}#x`,
    `/api/v1/tags/${encodeURIComponent(TAG)}/visual-image?v=ABC`,
    'javascript:alert(1)',
  ];
  for (const image of images) {
    const view = sharedLabelsView(enabled(undefined, snap(visualData({ image }))), TAG);
    assert.equal(view?.visual.state, 'unavailable', image);
    assert.equal(view?.relations.state, 'ready', image);
  }
  const accent = sharedLabelsView(enabled(undefined, snap(visualData({ image: `${IMAGE}&accent=00ff7a` }))), TAG);
  assert.equal(accent?.visual.state, 'ready');
  for (const source of [
    { pageUrl: 'http://commons.wikimedia.org/x', license: null, licenseUrl: null, artist: null },
    { pageUrl: 'https://u:p@commons.wikimedia.org/x', license: null, licenseUrl: null, artist: null },
    { pageUrl: 'https://commons.wikimedia.org/x', license: null, licenseUrl: 'javascript:1', artist: null },
    'Commons',
  ]) {
    assert.equal(sharedLabelsView(enabled(undefined, snap(visualData({ source }))), TAG)?.visual.state, 'unavailable');
  }
});

test('page paths must survive URL normalization, as in the gateway parser', () => {
  for (const path of [
    '/tag/./',
    '/tag/../',
    '/tag/%2e/',
    '/tag/%2E%2E/',
    '/tag/a/../b/',
    '/tag//',
    '/group/0/',
    '/group/3',
    '/tag/a/?x',
    '/tag/a/#x',
    '//evil.example/tag/a/',
  ]) {
    assert.equal(sharedLabelPath(path), null, path);
  }
  for (const path of [tagPath(TAG), tagPath('a.b'), tagPath('...'), tagPath('C++'), '/group/3/']) {
    assert.equal(sharedLabelPath(path), path, path);
  }
});

test('a relation whose href resolves to another page makes the relations half unavailable', () => {
  for (const label of ['.', '..']) {
    const view = sharedLabelsView(enabled(snap(relationsData([relation('r1', 'related', label)]))), TAG);
    assert.equal(view?.relations.state, 'unavailable', label);
    assert.equal(view?.visual.state, 'ready', label);
  }
  const dots = sharedLabelsView(enabled(snap(relationsData([relation('r1', 'related', '...')]))), TAG);
  assert.equal(dots?.relations.state, 'ready');
});

test('the topic label is checked like the gateway checks it before its link is built', () => {
  for (const tag of ['', '.', '..', ' 旅行', '旅行 ', '旅\u0000行', '旅\u007f行', '\ud800', 'x'.repeat(61), undefined, 1]) {
    assert.equal(sharedLabelTagOk(tag), false, JSON.stringify(tag));
    assert.equal(sharedLabelsView(enabled(), tag as string), null, JSON.stringify(tag));
  }
  for (const tag of [TAG, '...', 'a.b', 'x'.repeat(60)]) assert.equal(sharedLabelTagOk(tag), true, tag);
  assert.equal(sharedLabelsView({ status: 'enabled' }, '...')?.tagHref, 'https://tag.observe.tw/tag/.../');
});

test('snapshot metadata is checked: 40-hex contract, null payload version, a known status', () => {
  for (const more of [
    { sourceContractSha: 'abc' },
    { sourceContractSha: SHA.toUpperCase() },
    { payloadVersion: SHA },
    { payloadVersion: undefined },
    { status: 'stale' },
    { fetchedAt: 'yesterday' },
  ]) {
    assert.equal(sharedLabelsView(enabled(snap(relationsData(), more)), TAG)?.relations.state, 'unavailable', JSON.stringify(more));
  }
});

test('an enabled value from another source keeps the block, with both halves unavailable', () => {
  const view = sharedLabelsView({ ...enabled(), source: 'https://evil.example' }, TAG);
  assert.equal(view?.relations.state, 'unavailable');
  assert.equal(view?.visual.state, 'unavailable');
  assert.equal(sharedLabelsView({ status: 'enabled' }, TAG)?.relations.state, 'unavailable');
});

test('at most 24 distinct relations are shown, grouped is-a / related / alias, totals kept', () => {
  const rows = Array.from({ length: 30 }, (_, i) => relation(`r${i % 29}`, ['alias', 'is-a', 'related'][i % 3], `詞${i}`));
  const data = relationsData(rows, { truncated: true }) as SharedLabelRelations;
  const list = relationGroups(data);
  assert.equal(list.shown, SHARED_LABEL_SHOWN);
  assert.equal(list.total, 29, 'r0 repeats once');
  assert.deepEqual(
    list.groups.map((g) => g.type),
    ['is-a', 'related', 'alias'],
  );
  assert.equal(
    list.groups.reduce((n, g) => n + g.rows.length, 0),
    24,
  );
  const ids = list.groups.flatMap((g) => g.rows.map((r) => r.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(relationCountText(list), '本頁收到 29 條，只顯示前 24 條；上游回應已截斷，這不是完整清單');
  assert.equal(relationCountText({ shown: 2, total: 2, truncated: false }), '共 2 條');
});

test('inherited and depth are always said', () => {
  assert.equal(relationDepthText({ inherited: false, depth: 1 }), '直接（第 1 層）');
  assert.equal(relationDepthText({ inherited: true, depth: 3 }), '繼承（第 3 層）');
});

test('the module stays browser-safe: no node built-ins, no fetch', () => {
  const source = readFileSync(new URL('../src/lib/shared-labels.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from 'node:|require\(|Buffer\./);
  assert.doesNotMatch(source, /\bfetch\(/);
});
