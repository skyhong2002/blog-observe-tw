import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaIconSrc, mediaIcons, suppliedIconUrl } from '../src/lib/media-icons.ts';

const supplied = 'https://blog.observe.tw/favicons/a.png?v=r1';

test('server render (empty manifest) uses the payload iconUrl, or the glyph when it is null', () => {
  assert.deepEqual(mediaIcons, {});
  assert.equal(mediaIconSrc('a', mediaIcons, supplied), supplied);
  assert.equal(mediaIconSrc('a', mediaIcons, null), null);
  assert.equal(mediaIconSrc('a', mediaIcons), null);
});

test('a refreshed manifest entry wins over the payload iconUrl; others keep the iconUrl', () => {
  const refreshed = { a: { revision: 'r2' } };
  assert.equal(mediaIconSrc('a', refreshed, supplied), '/favicons/a.png?v=r2');
  assert.equal(mediaIconSrc('b', refreshed, supplied), supplied);
  // Callers without iconUrl behave as before.
  assert.equal(mediaIconSrc('a', refreshed), '/favicons/a.png?v=r2');
});

test('a failed source falls back to the next one, then to the glyph', () => {
  const refreshed = { a: { revision: 'r2' } };
  assert.equal(mediaIconSrc('a', refreshed, supplied, ['/favicons/a.png?v=r2']), supplied);
  assert.equal(mediaIconSrc('a', refreshed, supplied, ['/favicons/a.png?v=r2', supplied]), null);
  assert.equal(mediaIconSrc('a', mediaIcons, supplied, [supplied]), null);
});

test('only https URLs and same-origin paths count as a supplied iconUrl', () => {
  assert.equal(suppliedIconUrl(supplied), supplied);
  assert.equal(suppliedIconUrl('/favicons/a.png'), '/favicons/a.png');
  assert.equal(suppliedIconUrl(' /favicons/a.png?v=r1#x '), '/favicons/a.png?v=r1#x');
  assert.equal(suppliedIconUrl('/favicons/a b.png'), '/favicons/a b.png');
  for (const bad of [
    null,
    undefined,
    1,
    {},
    '',
    '   ',
    'not a url',
    '//evil.example/a.png',
    // Browsers normalize these to the protocol-relative `//evil.example`.
    '/\\evil.example/a.png',
    '/\\/evil.example/a.png',
    '\\\\evil.example/a.png',
    '/\t/evil.example/a.png',
    '/\n/evil.example/a.png',
    '/\r/evil.example/a.png',
    // Backslashes and control characters anywhere in a path.
    '/favicons\\a.png',
    '/favicons/\u0000a.png',
    '/favicons/\u007fa.png',
    '/favicons/\u0085a.png',
    'http://blog.observe.tw/a.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'https://u:p@blog.observe.tw/a.png',
  ]) {
    assert.equal(suppliedIconUrl(bad), null, String(bad));
    assert.equal(mediaIconSrc('a', mediaIcons, bad), null, String(bad));
  }
});
