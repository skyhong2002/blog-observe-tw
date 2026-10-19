import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const profile = readFileSync(new URL('../src/components/SourceProfile.tsx', import.meta.url), 'utf8');

test('a blog page shows how often it posts and how often its RSS is checked, never a fixed default; unknown rows are left out', () => {
  assert.doesNotMatch(profile, /預期更新|expectedIntervalHours/);
  assert.match(profile, /<Row term="發文頻率">\{postingText\(blog\.postingIntervalHours\)\}<\/Row>/);
  assert.match(
    profile,
    /<Row term="檢查頻率">\{blog\.crawlIntervalHours \? `每 \$\{blog\.crawlIntervalHours\} 小時檢查 RSS` : null\}<\/Row>/,
  );
  // Too few posts (null) or an older payload (undefined): no row, never 未提供 or an estimate sentence.
  assert.match(profile, /if \(hours == null\) return null;/);
  assert.match(profile, /if \(children === null \|\| children === undefined \|\| children === ''\) return null;/);
  assert.doesNotMatch(profile, /文章太少，尚無法估計|'未提供'/);
  assert.match(profile, /if \(days <= 1\) return '約每天';/);
});

test('a blog page heads with its whole collection, not the 50 posts listed', () => {
  assert.match(profile, /\{blog\.postCount === undefined \? '本頁收錄' : '收錄文章'\}/);
  assert.match(profile, /\(blog\.postCount \?\? allPosts\.length\)\.toLocaleString\('zh-TW'\)/);
});
