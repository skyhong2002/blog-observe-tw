import { describe, expect, it } from 'vitest';
import {
  compilePublicationAliases,
  identityKey,
  normalizeLink,
  publicationDecision,
  publicationHome,
  resolvePublication,
} from './identity.ts';
import { parseArticleLinks } from './parser.ts';
import { projectRelations, relationDays, withinRelationWindow } from './routes.ts';
import { relationFailureCode } from './worker.ts';

const aliases = [
  { blogId: 1, url: 'https://alice.example/' },
  { blogId: 1, url: 'http://old-alice.example/' },
  { blogId: 2, url: 'https://bob.example/' },
  { blogId: 3, url: 'https://medium.com/@alice' },
  { blogId: 4, url: 'https://medium.com/@bob' },
  { blogId: 5, url: 'https://medium.com/my-publication' },
];
const parse = (html: string, limit = 100) => parseArticleLinks(html, 'https://alice.example/post', 1, aliases, limit);
describe('publication identities', () => {
  it('normalizes transport/tracking but preserves publication path casing and meaningful query', () => {
    expect(normalizeLink('https://WWW.Example.COM/path?utm_source=x&foo=1#section')).toBe('https://www.example.com/path?foo=1');
    expect(identityKey('http://www.example.com/A/')).toBe('example.com/A');
    expect(identityKey('https://example.com/a')).not.toBe(identityKey('https://example.com/A'));
  });
  it('rejects credentials, local targets, private IP, non-web protocols/ports and oversized URLs', () => {
    for (const u of [
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://169.254.169.254/',
      'http://localhost/',
      'http://foo.internal/',
      'http://foo.local/',
      'https://a.example:18160/',
      'https://user:pass@a.example/',
      'javascript:alert(1)',
      'https://a.example/\\evil',
      `https://a.example/${'a'.repeat(1100)}`,
    ])
      expect(normalizeLink(u), u).toBeNull();
  });
  it('keeps separate platform owners and refuses platform roots', () => {
    for (const u of [
      'https://medium.com/',
      'https://medium.com/tag/life',
      'https://medium.com/some-article-abcdef123456',
      'https://wordpress.com/',
      'https://pixnet.net/',
      'https://substack.com/',
      'https://vocus.cc/article/a',
    ])
      expect(publicationHome(u), u).toBeNull();
    expect(publicationHome('https://medium.com/@alice/post')).toBe('https://medium.com/@alice');
    expect(publicationHome('https://medium.com/my-publication/article-123')).toBe('https://medium.com/my-publication');
    expect(publicationHome('https://alice.pixnet.net/blog/post/123')).toBe('https://alice.pixnet.net/');
    expect(publicationHome('https://alice.blogspot.com/2026/post')).toBe('https://alice.blogspot.com/');
    expect(publicationHome('https://alice.wordpress.com/post')).toBe('https://alice.wordpress.com/');
    expect(publicationHome('https://alice.substack.com/p/post')).toBe('https://alice.substack.com/');
    expect(publicationHome('https://vocus.cc/salon/alice/article/123')).toBe('https://vocus.cc/salon/alice');
  });
  it('resolves aliases and owner boundaries without network or cross-owner prefix matches', () => {
    expect(resolvePublication('https://www.old-alice.example/x', aliases)).toBe(1);
    expect(resolvePublication('https://medium.com/@alice/post', aliases)).toBe(3);
    expect(resolvePublication('https://medium.com/@alice-other/post', aliases)).toBeNull();
    expect(resolvePublication('https://medium.com/my-publication/post', aliases)).toBe(5);
    expect(resolvePublication('https://medium.com/@bob/post', [...aliases, { blogId: 6, url: 'https://medium.com/' }])).toBe(4);
  });
  it('prefers a specific known publication path over another host publication', () => {
    expect(
      resolvePublication('https://example.com/bob/post', [
        { blogId: 8, url: 'https://example.com/' },
        { blogId: 9, url: 'https://example.com/bob/' },
      ]),
    ).toBe(9);
  });
});
describe('semantic article relationships', () => {
  it('separates body, sidebar, blogroll and comments nested inside article', () => {
    const result = parse(`<article><div class="entry-content"><p>Hello <a href="https://bob.example/post">Bob</a> world.</p>
      <aside><a href="https://side.example/">Side</a><div class="blogroll"><a href="https://roll.example/">Roll</a></div></aside>
      <div id="comments"><a href="https://comment.example/">Commenter</a></div></div></article>`);
    expect(result.links.map((x) => x.location)).toEqual(['body', 'blogroll', 'sidebar', 'comment']);
    expect(result.bodyText).toBe('Hello Bob world.');
    expect(result.links[0]).toMatchObject({ targetBlogId: 2, anchorText: 'Bob', context: 'Hello Bob world.' });
  });
  it('does not extract comment articles or sidebar body-shaped widgets as正文', () => {
    const result = parse(
      '<article class="comment">Comment text <a href="https://comment.example/">Comment</a></article><aside><div class="entry-content">Sidebar text <a href="https://side.example/">Side</a></div></aside>',
    );
    expect(result.bodyText).toBeNull();
    expect(result.links.map((l) => l.location).sort()).toEqual(['comment', 'sidebar']);
  });
  it('never treats a generic main page as article body', () => {
    const result = parse('<main><p>Text <a href="https://bob.example/">Bob</a></p></main>');
    expect(result.bodyText).toBeNull();
    expect(result.extraction).toBe('no-semantic-body');
    expect(result.links).toEqual([]);
  });
  it('removes self links including www and moved aliases, unsafe links, fragments, header/nav and forms', () => {
    const result = parse(`<article><a href="/self">Self</a><a href="https://www.old-alice.example/x">Old</a>
      <a href="#frag">Frag</a><a href="http://127.0.0.1:18160/">Bad</a><nav><a href="https://nav.example/">Nav</a></nav>
      <form><input value="secret"><a href="https://form.example">Token</a></form><script>secret</script><p>Public</p></article>`);
    expect(result.links).toEqual([]);
    expect(result.bodyText).not.toContain('secret');
    expect(result.bodyText).not.toContain('Nav');
  });
  it('keeps links between owners on the same platform host', () => {
    const result = parseArticleLinks(
      '<article><a href="/@bob/post">Bob</a><a href="/@alice/other">Self</a></article>',
      'https://medium.com/@alice/post',
      3,
      aliases,
    );
    expect(result.links).toHaveLength(1);
    expect(result.links[0].targetBlogId).toBe(4);
  });
  it('deduplicates identical anchors while retaining different contexts and locations', () => {
    const result = parse(
      '<article><a href="https://bob.example/?utm_source=a">Bob</a><a href="https://bob.example/">Bob</a><a href="https://bob.example/">Another anchor</a><aside><a href="https://bob.example/">Bob</a></aside></article>',
    );
    expect(result.links).toHaveLength(3);
    expect(result.links.map((l) => l.ordinal)).toEqual([0, 1, 2]);
  });
  it('records truncation and keeps body text within 60KB even with four-byte characters', () => {
    const result = parse(
      `<article>${'😀'.repeat(20000)}${Array.from({ length: 101 }, (_, i) => `<a href="https://b${i}.example/">${'字'.repeat(300)}</a>`).join('')}</article>`,
    );
    expect(result.truncated).toBe(true);
    expect(result.links).toHaveLength(100);
    expect(result.externalLinks).toBe(101);
    expect(Buffer.byteLength(result.bodyText || '')).toBeLessThanOrEqual(60000);
    expect(Array.from(result.links[0].anchorText)).toHaveLength(255);
    expect(result.links.every((l) => Array.from(l.context).length <= 320)).toBe(true);
  });
  it('prioritizes body evidence when a preceding sidebar contains hundreds of links', () => {
    const result = parse(
      `<aside>${Array.from({ length: 101 }, (_, i) => `<a href="https://side${i}.example/">Side</a>`).join('')}</aside><article><a href="https://bob.example/">Bob</a></article>`,
    );
    expect(result.links[0]).toMatchObject({ targetBlogId: 2, location: 'body' });
    expect(result.links).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });
  it('has deterministic content hashes and ignores tracking parameters', () => {
    expect(parse('<article><a href="https://bob.example/?utm_source=a">Bob</a></article>').contentHash).toBe(
      parse('<article><a href="https://bob.example/">Bob</a></article>').contentHash,
    );
  });
});
describe('body reference arithmetic and dates', () => {
  it('excludes self edges from numerator and denominator and recognizes reciprocity', () => {
    const edge = (sourceBlogId: number, targetBlogId: number, count: number) => ({
      sourceBlogId,
      targetBlogId,
      count,
      firstMentionAt: null,
      lastMentionAt: null,
    });
    const result = projectRelations([edge(1, 1, 99), edge(1, 2, 3), edge(1, 3, 1), edge(2, 1, 2)]);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ share: 0.75, mutual: true });
    expect(result[1]).toMatchObject({ share: 0.25, mutual: false });
  });
  it('uses the complete SQL denominator when a graph is capped', () => {
    expect(
      projectRelations([{ sourceBlogId: 1, targetBlogId: 2, count: 3, denominator: 12, firstMentionAt: null, lastMentionAt: null }])[0]
        .share,
    ).toBe(0.25);
  });
  it('retains missing publication dates and excludes future/unknown/out-of-window dates', () => {
    const now = new Date('2026-10-12T00:00:00Z');
    expect(withinRelationWindow(null, now, 7)).toBe(false);
    expect(withinRelationWindow(new Date('2026-10-13'), now, 7)).toBe(false);
    expect(withinRelationWindow(new Date('2026-10-05'), now, 7)).toBe(true);
    expect(withinRelationWindow(new Date('2026-10-04'), now, 7)).toBe(false);
    expect(relationDays(undefined)).toBe(90);
    expect(relationDays('7')).toBe(7);
    expect(relationDays('365')).toBeNull();
  });
  it('never stores raw error messages or credentials', () => {
    expect(relationFailureCode(Error('secret token https://user:password@example.com'))).toBe('fetch-or-parse-failed');
    expect(relationFailureCode(Error('http_403'))).toBe('http-403');
    expect(relationFailureCode(Error('unsafe crawl URL: secret'))).toBe('unsafe-target');
  });
});

describe('quality regression: structural boundaries and eligible publications', () => {
  it.each(['right-sidebar', 'ast-right-sidebar', 'ast-no-sidebar', 'has-sidebar'])(
    'ignores layout token %s outside selected body',
    (token) => {
      const result = parse(
        `<body class="${token}"><article class="tag-movie-comment"><div class="entry-content">正文<a href="https://bob.example/">Bob</a></div></article></body>`,
      );
      expect(result.bodyText).toContain('正文');
      expect(result.links).toHaveLength(1);
      expect(result.links[0].location).toBe('body');
    },
  );
  it('does not allow share, related articles, taxonomy, or navigation into body evidence', () => {
    const widgets = ['sharedaddy', 'jp-relatedposts', 'yarpp', 'addtoany', 'post-tags', 'tagcloud'];
    const result = parse(
      `<article><div class="entry-content">正文<a href="https://bob.example/">Bob</a>${widgets.map((c) => `<div class="${c}">排除<a href="https://${c}.example/">排除</a></div>`).join('')}<a rel="tag" href="https://tags.example/">排除</a></div></article>`,
    );
    expect(result.links).toHaveLength(1);
    expect(result.bodyText).not.toContain('排除');
  });
  it.each([
    ['matters.town', '/@alice/post', '/@alice'],
    ['hackmd.io', '/@alice/note', '/@alice'],
    ['note.com', '/alice/n/123', '/alice'],
    ['substack.com', '/@alice/post', '/@alice'],
  ])('keeps %s owner paths', (host, path, home) => {
    expect(publicationHome(`https://${host}${path}`)).toBe(`https://${host}${home}`);
    const a = [
      { blogId: 1, url: `https://${host}${home}` },
      { blogId: 2, url: `https://${host}${home.replace('alice', 'bob')}` },
    ];
    const result = parseArticleLinks(
      `<article><a href="${path.replace('alice', 'bob')}">Bob</a><a href="${path}">Self</a></article>`,
      `https://${host}${path}`,
      1,
      a,
    );
    expect(result.links).toHaveLength(1);
    expect(result.links[0].targetBlogId).toBe(2);
  });
  it('keeps Gamer owner query identity but refuses owner-less articles', () => {
    expect(publicationHome('https://home.gamer.com.tw/creationDetail.php?sn=12')).toBeNull();
    expect(publicationHome('https://home.gamer.com.tw/homeindex.php?owner=alice')).toBe(
      'https://home.gamer.com.tw/homeindex.php?owner=alice',
    );
    expect(
      resolvePublication('https://home.gamer.com.tw/homeindex.php?owner=bob', [
        { blogId: 1, url: 'https://home.gamer.com.tw/homeindex.php?owner=alice' },
      ]),
    ).toBeNull();
  });
  it.each(['bit.ly', 'lnkd.in', 'reurl.cc'])('rejects unresolved shortener %s before admission budget', (host) =>
    expect(publicationDecision(`https://${host}/x`)).toEqual({ home: null, reason: 'shortener-unresolved' }),
  );
  it.each(['news.ltn.com.tw', 'ptt.cc', 'dcard.tw', 'github.com', 'linktr.ee', 'books.com.tw', 'open.spotify.com'])(
    'rejects non-publication %s',
    (host) => expect(publicationDecision(`https://${host}/x`).reason).toBe('non-publication-host'),
  );
  it('precompiled aliases match longest owner boundary and do not resolve ambiguous owner records', () => {
    const resolver = compilePublicationAliases([
      { blogId: 1, url: 'https://note.com/alice' },
      { blogId: 2, url: 'https://note.com/alice' },
    ]);
    expect(resolvePublication('https://note.com/alice/n/123', resolver)).toBeNull();
  });
});

it('retains explicit footer blogroll as non-body evidence while dropping footer navigation', () => {
  const result = parse(
    '<article>正文</article><footer><div class="blogroll"><a href="https://roll.example/">友站</a></div><a href="https://nav.example/">導覽</a></footer>',
  );
  expect(result.links).toHaveLength(1);
  expect(result.links[0].location).toBe('blogroll');
});

it('does not rediscover its own root from a custom-domain path publication', () => {
  const result = parseArticleLinks('<article><a href="/about">關於</a></article>', 'https://alice.example/blog/post', 1, [
    { blogId: 1, url: 'https://alice.example/blog/' },
  ]);
  expect(result.links).toEqual([]);
});
