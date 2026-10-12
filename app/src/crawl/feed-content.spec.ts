import { describe, expect, it } from 'vitest';
import { articleIdentityKey, MAX_CONTENT_BYTES, parseFeed, parseSitemap, parseSitemapArticle } from './feed.ts';
import { parseHistoryWordpress, restoreEntry, storedEntry } from './history-parse.ts';
import type { HistoryTask } from './history-types.ts';

const home = 'https://body-fixture.example/';
const rss = (fields: string) =>
  `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><guid>p1</guid><link>${home}post</link><title>Body</title>${fields}</item></channel></rss>`;
const atom = (fields: string) =>
  `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>p1</id><link rel="alternate" href="${home}post"/><title>Body</title>${fields}</entry></feed>`;
const task: HistoryTask = {
  id: 'wp',
  blogId: 1,
  kind: 'wordpress',
  url: home + 'wp-json/wp/v2/posts?page=1',
  sourceUrl: home,
  sourceType: 'wordpress',
  depth: 0,
  status: 'pending',
};

describe('internal feed bodies and public previews', () => {
  it('retains RSS full content independently of description, including links beyond preview', () => {
    const html = `<p>${'完整本文'.repeat(500)}</p><a href="https://another.example/post">文章中的提及</a>`;
    const [entry] = parseFeed(
      rss(`<description>短摘要</description><content:encoded><![CDATA[${html}]]></content:encoded>`),
      home + 'feed',
    );
    expect(entry.summary).toBe('短摘要');
    expect(entry.content).toMatchObject({ html, kind: 'rss-content', completeness: 'full', sourceUrl: home + 'feed' });
    expect(entry.content?.html).toContain('another.example');
    expect(entry.summary).not.toContain('another.example');
  });
  it('does not confuse short/image-only full bodies with excerpts', () => {
    for (const html of ['Hi', '<img src="https://body-fixture.example/photo.png" alt="">']) {
      const [entry] = parseFeed(rss(`<content:encoded><![CDATA[${html}]]></content:encoded>`), home + 'feed');
      expect(entry.content).toMatchObject({ html, completeness: 'full' });
    }
    expect(parseFeed(rss('<description>Hi</description>'), home + 'feed')[0].content?.completeness).toBe('partial');
    expect(
      parseFeed(rss('<content:encoded><![CDATA[Hi <a class="more-link" href="/post">Read more</a>]]></content:encoded>'), home + 'feed')[0]
        .content?.completeness,
    ).toBe('partial');
  });
  it('retains Atom XHTML and plain-text semantics; never follows external content src', () => {
    const [xhtml] = parseFeed(
      atom(
        '<summary>Preview</summary><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Hi <a href="https://other.example/">Blog</a></p></div></content>',
      ),
      home + 'atom',
    );
    expect(xhtml.summary).toBe('Preview');
    expect(xhtml.content?.html).toContain('<a href="https://other.example/">Blog</a>');
    expect(xhtml.content?.completeness).toBe('full');
    const [plain] = parseFeed(atom('<content type="text">&lt;literal&gt; &amp; text</content>'), home + 'atom');
    expect(plain.content?.html).toBe('&lt;literal&gt; &amp; text');
    expect(plain.summary).toBe('<literal> & text');
    const [remote] = parseFeed(
      atom('<summary>Preview</summary><content src="https://outside.example/body" type="text/html"/>'),
      home + 'atom',
    );
    expect(remote.content).toMatchObject({ html: 'Preview', completeness: 'partial' });
  });
  it('bounds internal bytes explicitly and derives only a short display preview', () => {
    const [entry] = parseFeed(rss(`<content:encoded><![CDATA[<p>${'文😀'.repeat(50000)}</p>]]></content:encoded>`), home + 'feed');
    expect(Buffer.byteLength(entry.content!.html)).toBeLessThanOrEqual(MAX_CONTENT_BYTES);
    expect(entry.content).toMatchObject({ completeness: 'partial', truncated: true });
    expect(entry.content!.html).not.toContain('\ufffd');
    expect(Array.from(entry.summary)).toHaveLength(500);
  });
  it('passes already fetched sitemap HTML to the internal extractor', () => {
    const candidate = parseSitemap(`<urlset><url><loc>${home}post</loc></url></urlset>`, home)[0];
    const html =
      '<meta property="og:type" content="article"><title>Short</title><meta name="description" content="Preview"><article><p>Hi</p></article>';
    const entry = parseSitemapArticle(html, candidate, candidate.url);
    expect(entry?.summary).toBe('Preview');
    expect(entry?.content).toMatchObject({ html, kind: 'article-html', completeness: 'unknown', sourceUrl: candidate.url });
  });
});

describe('durable history content payloads', () => {
  it('reuses WordPress rendered content without fetching article pages', () => {
    const result = parseHistoryWordpress(
      JSON.stringify([
        {
          type: 'post',
          status: 'publish',
          link: home + 'post',
          title: { rendered: 'Body' },
          excerpt: { rendered: '<p>Preview</p>' },
          content: { rendered: '<p>Complete <a href="https://other.example/">Other</a></p>', protected: false },
          modified_gmt: '2020-01-01T12:00:00',
        },
      ]),
      task,
      { id: 1, slug: 'body', url: home },
      task.url,
      new Headers({ 'x-wp-totalpages': '1' }),
    );
    const queued = result.tasks.find((t) => t.kind === 'entry')!.payload!.entry!;
    expect(queued.summary).toBe('Preview');
    expect(queued.content).toMatchObject({
      kind: 'wordpress-api',
      completeness: 'full',
      sourceUrl: task.url,
      modifiedAt: '2020-01-01T12:00:00.000Z',
    });
    expect(restoreEntry(JSON.parse(JSON.stringify(queued))).content).toEqual(queued.content);
    expect(result.tasks.map((t) => t.kind)).toEqual(['entry']);
  });
  it('caps serialized HTML including JSON escaping, leaving space for the history path', () => {
    const [entry] = parseFeed(rss(`<content:encoded><![CDATA[<p>${'"\\😀'.repeat(60000)}</p>]]></content:encoded>`), home + 'feed');
    const stored = storedEntry(entry);
    expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThanOrEqual(208 * 1024);
    expect(
      Buffer.byteLength(JSON.stringify({ entry: stored, lineage: Array.from({ length: 32 }, () => home + 'a'.repeat(990)) })),
    ).toBeLessThan(256 * 1024);
    expect(stored.content).toMatchObject({ completeness: 'partial', truncated: true });
    expect(stored.content!.html).not.toContain('\ufffd');
  });
});

it('never reassigns a sitemap GUID across article redirects or meaningful query IDs', () => {
  const candidate = parseSitemap(`<urlset><url><loc>${home}post-a</loc></url></urlset>`, home)[0];
  const page = (canonical: string) =>
    `<meta property="og:type" content="article"><title>Article B</title>${canonical ? `<link rel="canonical" href="${canonical}">` : ''}<article>B body</article>`;
  expect(parseSitemapArticle(page(home + 'post-b'), candidate, home + 'post-b')).toBeNull();
  expect(parseSitemapArticle(page(''), candidate, home + 'category')).toBeNull();
  expect(parseSitemapArticle(page(home + 'post-b'), candidate, candidate.url)).toBeNull();
  expect(
    parseSitemapArticle(
      page('http://www.body-fixture.example/post-a/'),
      candidate,
      'http://www.body-fixture.example/post-a/?utm_source=test',
    ),
  ).not.toBeNull();
  const queryCandidate = { ...candidate, url: home + '?p=1' };
  expect(
    parseSitemapArticle(
      `<script type="application/ld+json">{"@type":"BlogPosting","url":"${home}?p=2","headline":"Wrong post"}</script>`,
      queryCandidate,
      queryCandidate.url,
    ),
  ).toBeNull();
  expect(articleIdentityKey('https://home.gamer.com.tw/creation.php?owner=alice&sn=1')).not.toBe(
    articleIdentityKey('https://home.gamer.com.tw/creation.php?owner=alice&sn=2'),
  );
  expect(articleIdentityKey('http://www.body-fixture.example/post/?b=2&a=1&utm_source=test')).toBe(
    articleIdentityKey('https://body-fixture.example/post?a=1&b=2'),
  );
});
