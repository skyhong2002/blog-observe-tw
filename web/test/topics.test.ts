import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  blogContribution,
  exclusionReasonLabel,
  exclusionRows,
  formatBytes,
  formatLift,
  formatPercent,
  inactiveReasonLabel,
  inactiveRows,
  liftExplanation,
  matchingPolicyText,
  matchingReasonLabel,
  matchSplit,
  recorded,
} from '../src/lib/topics.ts';

test('a blog counts each article once, heaviest first, halving each later one', () => {
  assert.equal(blogContribution(2, 1), 3.25, '2 + 1 + 0.25');
  assert.equal(blogContribution(0, 3), 1.75, '1 + 0.5 + 0.25');
  assert.equal(blogContribution(1, 0), 2);
  assert.equal(blogContribution(0, 0), 0);
  assert.equal(blogContribution(1, 1, { titleWeight: 3, bodyWeight: 1, sameBlogDecay: 0.25 }), 3.25);
});

test('the policy explanation is computed from the payload weights, with the gateway default otherwise', () => {
  assert.match(matchingPolicyText(), /標題出現記 2，僅正文出現記 1；.*乘 0\.5.*合計 3\.25/);
  assert.match(matchingPolicyText({ titleWeight: 3, bodyWeight: 1, sameBlogDecay: 0.5 }), /記 3.*合計 4\.75/);
});

test('exclusion reasons get Chinese labels; unknown codes stay visible', () => {
  assert.equal(exclusionReasonLabel('pure-date'), '純日期');
  assert.equal(exclusionReasonLabel('not-in-tag-vocabulary'), '不在共同關鍵字詞庫');
  assert.equal(exclusionReasonLabel('no-equal'), '沿用來源排除清單');
  assert.equal(exclusionReasonLabel('upstream-no-equal'), '來源標示不參與比對');
  assert.equal(exclusionReasonLabel('future-rule'), '其他排除規則（future-rule）');
});

test('inactive reasons are labelled apart from noise exclusions', () => {
  assert.equal(inactiveReasonLabel('low-frequency'), '文章數較少且最近 180 天未觀測到發文');
  assert.equal(inactiveReasonLabel('memory-budget'), '超出本次比對容量');
  assert.equal(inactiveReasonLabel('future-rule'), '其他暫停比對原因（future-rule）');
  assert.notEqual(exclusionReasonLabel('low-frequency'), inactiveReasonLabel('low-frequency'));
  assert.deepEqual(
    inactiveRows({ 'low-frequency': 7, 'memory-budget': 40, other: 0 }).map((r) => [r.reason, r.label, r.count]),
    [
      ['memory-budget', '超出本次比對容量', 40],
      ['low-frequency', '文章數較少且最近 180 天未觀測到發文', 7],
    ],
  );
  assert.deepEqual(inactiveRows(undefined), []);
  assert.deepEqual(inactiveRows(null), []);
});

test('missing optional counts stay unrecorded instead of becoming 0', () => {
  assert.equal(recorded(undefined), null);
  assert.equal(recorded(null), null);
  assert.equal(recorded(Number.NaN), null);
  assert.equal(recorded(0), 0);
  assert.equal(formatBytes(undefined), '—');
  assert.equal(formatBytes(null), '—');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KiB');
  assert.equal(formatBytes(256 * 1024 ** 2), '256 MiB');
});

test('exclusion rows keep positive counts, most frequent first', () => {
  assert.deepEqual(
    exclusionRows({ 'too-short': 2, 'pure-number': 5, 'no-equal': 0, 'pure-date': 2 }).map((r) => [r.reason, r.count]),
    [
      ['pure-number', 5],
      ['pure-date', 2],
      ['too-short', 2],
    ],
  );
  assert.deepEqual(exclusionRows(undefined), []);
});

test('title/body split is optional for older payloads', () => {
  assert.equal(matchSplit({ titlePosts: 1200, bodyOnlyPosts: 3 }), '1,200 / 3');
  assert.equal(matchSplit({ titlePosts: 1 }), '—');
  assert.equal(matchSplit({}), '—');
});

test('lift is a ratio with two decimals; a missing baseline is not zero', () => {
  assert.equal(formatLift(null), '尚無基準');
  assert.equal(formatLift(undefined), '尚無基準');
  assert.equal(formatLift(0), '0.00×');
  assert.equal(formatLift(1.25), '1.25×');
  assert.match(liftExplanation(), /近期文章占比 ÷ 365 日基準占比/);
  assert.match(liftExplanation(), /不是瀏覽流量，也不是成長百分比/);
});

test('high-frequency terms are labelled as title-only, apart from exclusions', () => {
  assert.equal(matchingReasonLabel('high-document-frequency-title-only'), '高頻詞，只計標題命中');
  assert.equal(matchingReasonLabel('future-rule'), '其他比對規則（future-rule）');
  assert.notEqual(exclusionReasonLabel('high-document-frequency-title-only'), matchingReasonLabel('high-document-frequency-title-only'));
  assert.equal(formatPercent(0.02), '2%');
  assert.equal(formatPercent(0.025), '2.5%');
  assert.equal(formatPercent(null), '—');
});
