import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleImage, externalHref } from '../src/lib/images.ts';

test('only public https URLs count as article images', () => {
  assert.equal(articleImage('https://img.example.com/a.jpg'), 'https://img.example.com/a.jpg');
  assert.equal(articleImage('  https://img.example.com/a.jpg  '), 'https://img.example.com/a.jpg');
  for (const bad of [
    null,
    undefined,
    '',
    '   ',
    'not a url',
    '/relative.jpg',
    'http://img.example.com/a.jpg',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    'https://user:pass@img.example.com/a.jpg',
    'https://img.example.com:8443/a.jpg',
    'https://localhost/a.jpg',
    'https://127.0.0.1/a.jpg',
    'https://[::1]/a.jpg',
  ]) {
    assert.equal(articleImage(bad), null, String(bad));
  }
});

test('original-article links must be absolute http(s)', () => {
  assert.equal(externalHref('https://blog.example.com/p/1'), 'https://blog.example.com/p/1');
  assert.equal(externalHref('http://blog.example.com/p/1'), 'http://blog.example.com/p/1');
  for (const bad of [null, undefined, '', ' ', '/p/1', 'javascript:alert(1)', 'mailto:a@example.com']) {
    assert.equal(externalHref(bad), null, String(bad));
  }
});
