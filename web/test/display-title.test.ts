import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { displayTitle, type Post, plainText } from '../src/lib/api.ts';

const SRC = join(import.meta.dirname, '../src');
const source = (path: string) => readFileSync(join(SRC, path), 'utf8');

test('displayTitle: the reported publisher title reads as text', () => {
  assert.equal(
    displayTitle('She Rarely Reaches Out But Our Chemistry &#038; Sex Are Great'),
    'She Rarely Reaches Out But Our Chemistry & Sex Are Great',
  );
});

test('displayTitle: decimal (leading zeros), hex and the named references', () => {
  assert.equal(displayTitle('A &#038; B &#38; C &#0000038; D'), 'A & B & C & D');
  assert.equal(displayTitle('A &#x26; B &#X26; C &#x0026;'), 'A & B & C &');
  assert.equal(displayTitle('&amp; &quot; &apos; &lt; &gt;'), '& " \' < >');
  assert.equal(displayTitle('a&nbsp;b'), 'a b');
  assert.equal(displayTitle('It&#8217;s &#8220;fine&#8221;'), 'It’s “fine”');
});

test('displayTitle: supplementary code points decode to one character', () => {
  assert.equal(displayTitle('樹 &#x1F333; &#127795;'), '樹 🌳 🌳');
  assert.equal([...displayTitle('&#x1F333;')].length, 1);
});

test('displayTitle: unknown and invalid references stay as written, never throw', () => {
  for (const kept of [
    '&copy;',
    '&hellip;',
    '&toString;',
    '&valueOf;',
    '&constructor;',
    '&hasOwnProperty;',
    '&#;',
    '&#x;',
    '&#xZZ;',
    '&#0;',
    '&#xD800;',
    '&#55296;',
    '&#x110000;',
    '&#99999999;',
    '&#x7F;',
    '&#x85;',
    '&#1;',
    '&amp',
    '& amp;',
    'AT&T',
    'a & b',
  ])
    assert.equal(displayTitle(kept), kept, kept);
  assert.equal(displayTitle('tab&#9;nl&#10;'), 'tab\tnl\n');
  assert.equal(displayTitle(''), '');
  assert.equal(displayTitle(null), '');
  assert.equal(displayTitle(undefined), '');
});

test('displayTitle: decodes exactly once (double-encoded stays one level encoded)', () => {
  assert.equal(displayTitle('Chemistry &amp;#038; Sex'), 'Chemistry &#038; Sex');
  assert.equal(displayTitle('&amp;amp;'), '&amp;');
  assert.equal(displayTitle(displayTitle('&amp;lt;')), '<', 'a second call is a second, explicit decode');
});

test('displayTitle: literal markup is visible text, not removed or parsed', () => {
  assert.equal(displayTitle('Why <div> matters'), 'Why <div> matters');
  assert.equal(displayTitle('<script>alert(1)</script> tips'), '<script>alert(1)</script> tips');
  assert.equal(displayTitle('&lt;script&gt;x&lt;/script&gt;'), '<script>x</script>');
});

test('displayTitle: the raw Post is not changed; summaries keep plainText', () => {
  const post: Post = { id: 1, title: 'Chemistry &#038; Sex', summary: '<p>A &amp; B &#038; C</p>' };
  const copy = structuredClone(post);
  assert.equal(displayTitle(post.title), 'Chemistry & Sex');
  assert.deepEqual(post, copy);
  // plainText behaviour is unchanged by this helper (it still does not decode numeric references).
  assert.equal(plainText(post.summary), 'A & B &#038; C');
});

test('displayTitle: every public article-title consumer goes through the shared helper', () => {
  const page = source('app/page.tsx');
  assert.match(page, /import \{ displayTitle, plainText, taipei \} from '@\/lib\/api';/);
  assert.match(page, /title=\{displayTitle\(lead\.title\)\}\s+variant="hero"/);
  assert.match(page, /\{displayTitle\(lead\.title\)\}\s*<\/a>/);
  assert.match(page, /\{displayTitle\(post\.title\)\}\s*<\/a>/);
  assert.match(page, /title=\{displayTitle\(post\.title\)\}\s*variant="thumbnail"/);
  assert.match(page, /const title = displayTitle\(latest\?\.title\)\.trim\(\) \|\| '未提供標題';/);
  assert.doesNotMatch(page, /\{(lead|post)\.title\}/);
  const list = source('components/ArticleListItem.tsx');
  assert.match(list, /const shownTitle = displayTitle\(post\.title\);/);
  assert.doesNotMatch(list, /exec\(article\.title\)/);
  assert.match(source('components/public/TopicDetail.tsx'), /const title = displayTitle\(raw\);/);
  const relations = source('components/BlogRelations.tsx');
  for (const field of ['e.postTitle', 'hit.sourceArticleTitle', 'hit.targetArticleTitle', 'side.title'])
    assert.ok(relations.includes(`displayTitle(${field})`), field);
  // The row identity still uses the raw title as sent.
  assert.match(relations, /e\.postId,\s*e\.postTitle,/);
  // Text only: no HTML injection or DOM parsing for titles.
  for (const path of [
    'app/page.tsx',
    'components/ArticleListItem.tsx',
    'components/public/TopicDetail.tsx',
    'components/BlogRelations.tsx',
  ])
    assert.doesNotMatch(
      source(path).replace(/<script type="application\/ld\+json"[^\n]*/, ''),
      /dangerouslySetInnerHTML|DOMParser|innerHTML/,
      path,
    );
});
