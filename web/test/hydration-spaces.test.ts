import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('date-time text is the same on the server and in the browser (React #418)', async () => {
  const { plainSpaces, taipei } = await import('../src/lib/api.ts');
  // Node's ICU: thin space U+2009 between date and time; Chrome: a plain space.
  assert.equal(plainSpaces('2026/10/16 15:03'), '2026/10/16 15:03');
  assert.equal(plainSpaces('a b c'), 'a b c');
  assert.doesNotMatch(taipei('2026-10-16T07:03:00Z'), /[  -​ ]/u);
  for (const file of ['components/ApiStatusView.tsx', 'components/ApiKeyManager.tsx'])
    assert.match(read(file), /plainSpaces\(\s*d\.toLocaleString\('zh-TW'/, file);
});
