import assert from 'node:assert/strict';
import test from 'node:test';
import { relativeTime } from '../src/lib/relative-time.ts';

const now = Date.parse('2026-11-13T02:20:00+08:00');
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

test('relative time stays short across minute, hour, day, month and year boundaries', () => {
  for (const [seconds, expected] of [
    [0, '剛剛'],
    [59, '剛剛'],
    [60, '1 分鐘前'],
    [3599, '59 分鐘前'],
    [3600, '1 小時前'],
    [86399, '23 小時前'],
    [86400, '1 天前'],
    [29 * 86400, '29 天前'],
    [30 * 86400, '1 個月前'],
    [364 * 86400, '12 個月前'],
    [365 * 86400, '1 年前'],
  ] as const)
    assert.equal(relativeTime(ago(seconds), now), expected);
});

test('future dates and invalid timestamps never turn into negative or NaN ages', () => {
  assert.equal(relativeTime(ago(-30), now), '即將');
  assert.equal(relativeTime(ago(-3600), now), '1 小時後');
  assert.equal(relativeTime('invalid', now), null);
  assert.equal(relativeTime('', now), null);
  assert.equal(relativeTime(ago(60), Number.NaN), null);
});
