import { describe, expect, it } from 'vitest';
import { parsePublicationBlogroll } from './home.ts';

const aliases = [
  { blogId: 1, url: 'https://alice.example/' },
  { blogId: 2, url: 'https://bob.example/' },
];
const parse = (html: string, dedicated = false, url = 'https://alice.example/') =>
  parsePublicationBlogroll(html, url, 1, aliases, dedicated);
describe('publication homepage and explicit blogroll discovery', () => {
  it('does not treat ordinary homepage, sidebar, navigation or comments as blogroll', () => {
    const r = parse(
      '<main><a href="https://body.example/">Body</a></main><aside><a href="https://side.example/">Side</a></aside><nav><a href="https://nav.example/">Nav</a></nav><div class="comments blogroll"><a href="https://comment.example/">Comment</a></div>',
    );
    expect(r.links).toEqual([]);
    expect(r.confirmed).toBe(false);
  });
  it('extracts only an explicit blogroll widget inside a sidebar', () => {
    const r = parse(
      '<aside><a href="https://side.example/">Ad</a><div class="blogroll"><a href="https://bob.example/">Bob</a></div></aside>',
    );
    expect(r.links).toHaveLength(1);
    expect(r.links[0]).toMatchObject({ targetBlogId: 2, location: 'blogroll' });
  });
  it('uses labelled heading immediate lists, not the whole parent container', () => {
    const r = parse(
      '<aside><h3>部落卷</h3><ul><li><a href="https://bob.example/">Bob</a></li></ul><h3>廣告</h3><ul><li><a href="https://ad.example/">Ad</a></li></ul></aside>',
    );
    expect(r.links).toHaveLength(1);
    expect(r.links[0].targetBlogId).toBe(2);
  });
  it('finds one same-publication dedicated child page, not external navigation or article bookmarks', () => {
    const r = parse(
      '<nav><a href="https://other.example/blogroll">Blogroll</a><a href="/post/123" rel="bookmark">An article</a><a href="/blogroll">友站</a><a href="/links">部落卷</a></nav>',
    );
    expect(r.childUrl).toBe('https://alice.example/blogroll');
    expect(r.links).toEqual([]);
  });
  it('confirms dedicated pages by title/heading/path then excludes navigation/comments/sidebar', () => {
    const r = parse(
      '<title>部落卷</title><main><a href="https://bob.example/">Bob</a><aside><a href="https://ad.example/">Ad</a></aside><div class="comments"><a href="https://comment.example/">Comment</a></div></main>',
      true,
      'https://alice.example/links',
    );
    expect(r.confirmed).toBe(true);
    expect(r.links).toHaveLength(1);
    expect(r.childUrl).toBeNull();
  });
  it('does not elevate an unconfirmed dedicated page to a directory', () => {
    const r = parse('<main><h1>Article</h1><a href="https://bob.example/">Bob</a></main>', true, 'https://alice.example/article');
    expect(r.links).toEqual([]);
    expect(r.confirmed).toBe(false);
  });
  it('deduplicates links, rejects unsafe/self targets and reports cap', () => {
    const r = parse(
      `<div class="blogroll"><a href="http://127.0.0.1/">Unsafe</a><a href="/self">Self</a><a href="https://bob.example/?utm_source=x">Bob</a><a href="https://bob.example/">Bob</a>${Array.from({ length: 101 }, (_, i) => `<a href="https://new${i}.example/">New</a>`).join('')}</div>`,
    );
    expect(r.links).toHaveLength(100);
    expect(r.truncated).toBe(true);
    expect(r.bodySha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('preserves unknown same-platform personal identities and rejects platform root', () => {
    const r = parsePublicationBlogroll(
      '<div class="blogroll"><a href="/@bob/post">Bob</a><a href="/@alice/post">Self</a><a href="/">Platform</a></div>',
      'https://medium.com/@alice',
      1,
      [{ blogId: 1, url: 'https://medium.com/@alice' }],
    );
    expect(r.links).toHaveLength(1);
    expect(r.links[0].targetUrl).toBe('https://medium.com/@bob/post');
  });
});
