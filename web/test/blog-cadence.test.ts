import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const profile = readFileSync(new URL('../src/components/SourceProfile.tsx', import.meta.url), 'utf8');

test('a blog page shows how often it posts and how often its RSS is checked, never a fixed default', () => {
  assert.doesNotMatch(profile, /預期更新|expectedIntervalHours/);
  assert.match(profile, /發文頻率<\/dt>\s*<dd>\{postingText\(blog\.postingIntervalHours\)\}<\/dd>/);
  assert.match(profile, /`每 \$\{blog\.crawlIntervalHours\} 小時檢查 RSS`/);
  assert.match(profile, /if \(hours === null\) return '文章太少，尚無法估計';/);
  assert.match(profile, /if \(days <= 1\) return '約每天';/);
});
