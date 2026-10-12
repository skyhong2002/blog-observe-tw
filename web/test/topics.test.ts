import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blogContribution, exclusionReasonLabel, exclusionRows, matchingPolicyText, matchSplit } from '../src/lib/topics.ts';

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
  assert.equal(exclusionReasonLabel('future-rule'), '其他排除規則（future-rule）');
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
