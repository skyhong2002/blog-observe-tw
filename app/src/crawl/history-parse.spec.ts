import { describe, expect, it } from 'vitest';
import { historyInPublication, parseHistoryHome, parseHistoryWordpress, parseHistoryXml } from './history-parse.ts';
import type { HistoryTask } from './history-types.ts';

const blog = { id: 1, slug: 'history', url: 'https://history.test/' };
const task: HistoryTask = {
  id: 'one',
  blogId: 1,
  kind: 'feed',
  url: 'https://history.test/feed',
  sourceUrl: 'https://history.test/feed',
  sourceType: 'rss',
  depth: 0,
  status: 'pending',
};
const headers = new Headers();
describe('history publication and archives', () => {
  it('retains every sitemap shard and URL, including old dates, without treating lastmod as publication', () => {
    const index = `<sitemapindex>${Array.from({ length: 12 }, (_, i) => `<sitemap><loc>https://history.test/posts-${i}.xml</loc></sitemap>`).join('')}</sitemapindex>`;
    const result = parseHistoryXml(index, task, blog, task.url, headers);
    expect(result.tasks).toHaveLength(12);
    const sitemap = `<urlset>${Array.from({ length: 1100 }, (_, i) => `<url><loc>https://history.test/posts/${i}</loc><lastmod>2002-01-01</lastmod></url>`).join('')}</urlset>`;
    const urls = parseHistoryXml(sitemap, task, blog, task.url, headers);
    expect(urls.tasks).toHaveLength(1100);
    expect(urls.tasks[0].payload).toMatchObject({ lastmod: '2002-01-01T00:00:00.000Z' });
    expect(urls.entries).toEqual([]);
  });
  it('Atom next is durable work and updated is never invented as published', () => {
    const result = parseHistoryXml(
      '<feed><link rel="next" href="?page=2"/><entry><id>old</id><title>short</title><link href="https://history.test/a"/><updated>2001-01-01</updated></entry></feed>',
      task,
      blog,
      task.url,
      headers,
    );
    expect(result.tasks.find((item) => item.kind === 'feed')?.url).toBe('https://history.test/feed?page=2');
    expect(result.tasks.find((item) => item.kind === 'entry')?.payload?.entry?.publishedAt).toBeNull();
    expect(result.archiveSeen).toBe(true);
  });
  it('isolates platform author articles, sitemap shards and next-page URLs', () => {
    expect(historyInPublication('https://medium.com/@other/article', 'https://medium.com/@owner')).toBe(false);
    expect(historyInPublication('https://medium.com/@owner/article', 'https://medium.com/@owner')).toBe(true);
    expect(historyInPublication('https://medium.com/article', 'https://medium.com/')).toBe(false);
    const source = { ...task, url: 'https://medium.com/feed/@owner', sourceUrl: 'https://medium.com/feed/@owner' };
    const result = parseHistoryXml(
      '<rss><channel><link rel="next" href="https://medium.com/feed/@other"/><item><link>https://medium.com/@other/post</link></item></channel></rss>',
      source,
      { ...blog, url: 'https://medium.com/@owner' },
      source.url,
      headers,
    );
    expect(result.tasks).toEqual([]);
    expect(result.warnings).toContain('out-of-publication-entries-skipped');
    expect(result.warnings).toContain('pagination-cycle-or-outside-publication');
  });
  it('Blogger OpenSearch walks beyond the latest feed window', () => {
    const result = parseHistoryXml(
      '<feed xmlns:openSearch="urn:test"><generator>Blogger</generator><openSearch:totalResults>43</openSearch:totalResults><openSearch:startIndex>1</openSearch:startIndex><openSearch:itemsPerPage>20</openSearch:itemsPerPage><entry><title>old</title><link href="https://history.test/a"/></entry></feed>',
      task,
      blog,
      task.url,
      headers,
    );
    expect(result.tasks.find((item) => item.kind === 'feed')?.url).toContain('start-index=21');
    expect(result.archiveSeen).toBe(true);
  });
  it('WordPress schedules public next pages with or without count headers and excludes products', () => {
    const wp = { ...task, kind: 'wordpress' as const, url: 'https://history.test/wp-json/wp/v2/posts?page=1' };
    const body = JSON.stringify([
      { type: 'post', status: 'publish', link: 'https://history.test/old', title: { rendered: 'Old' }, date_gmt: '2000-01-01T00:00:00' },
      { type: 'product', link: 'https://history.test/product' },
    ]);
    for (const h of [new Headers({ 'x-wp-totalpages': '7' }), headers]) {
      const result = parseHistoryWordpress(body, wp, blog, wp.url, h);
      expect(result.tasks.filter((item) => item.kind === 'entry')).toHaveLength(1);
      expect(result.tasks.find((item) => item.kind === 'wordpress')?.url).toContain('page=2');
      expect(result.tasks.find((item) => item.kind === 'entry')?.payload?.entry).toMatchObject({
        imageUrl: null,
        publishedAt: '2000-01-01T00:00:00.000Z',
      });
    }
  });
  it('rejects HTML/DTD sources and does not certify a plain feed window', () => {
    expect(() => parseHistoryXml('<html>no</html>', task, blog, task.url, headers)).toThrow('invalid_xml_source');
    expect(() => parseHistoryXml('<!DOCTYPE x><rss><channel/></rss>', task, blog, task.url, headers)).toThrow();
    expect(parseHistoryXml('<rss><channel/></rss>', task, blog, task.url, headers)).toMatchObject({
      archiveSeen: false,
      warnings: ['feed-window-only'],
    });
  });
});

describe('history review regressions', () => {
  it('normalizes www on platform domains and reports excluded sitemap shards/articles', () => {
    const owner = { ...blog, url: 'https://www.medium.com/@owner' };
    expect(historyInPublication('https://medium.com/@other/post', owner.url)).toBe(false);
    for (const xml of [
      '<sitemapindex><sitemap><loc>https://medium.com/@other/map.xml</loc></sitemap></sitemapindex>',
      '<urlset><url><loc>https://medium.com/@other/post</loc></url></urlset>',
    ]) {
      const result = parseHistoryXml(xml, task, owner, task.url, headers);
      expect(result.tasks).toEqual([]);
      expect(result.warnings?.some((warning) => warning.includes('out-of-publication'))).toBe(true);
    }
  });
  it('does not infer Blogger archive coverage from missing OpenSearch totals', () => {
    const result = parseHistoryXml(
      '<feed><generator>Blogger</generator><entry><title>one</title><link href="https://history.test/one"/></entry></feed>',
      task,
      blog,
      task.url,
      headers,
    );
    expect(result.archiveSeen).toBe(false);
    expect(result.warnings).toContain('feed-window-only');
  });
  it('excludes comments feeds and comment anchors before canonical identity can overwrite posts', () => {
    for (const [url, title] of [
      ['https://history.test/comments/feed/', 'Our feed'],
      [task.url, 'Comments for Our Blog'],
    ]) {
      const result = parseHistoryXml(
        `<rss><channel><title>${title}</title><item><title>Comment</title><link>https://history.test/post#comment-123</link></item></channel></rss>`,
        task,
        blog,
        url,
        headers,
      );
      expect(result.tasks).toEqual([]);
      expect(result.archiveSeen).not.toBe(true);
    }
    const mixed = parseHistoryXml(
      '<rss><channel><item><link>https://history.test/post#comment-123</link></item><item><link>https://history.test/post</link></item></channel></rss>',
      task,
      blog,
      task.url,
      headers,
    );
    expect(mixed.tasks).toHaveLength(1);
  });
  it('keeps pagination depth constant while article provenance uses actual source type', () => {
    const result = parseHistoryXml(
      '<feed><link rel="next" href="?page=80"/><entry><link href="https://history.test/old"/></entry></feed>',
      { ...task, depth: 63 },
      blog,
      task.url,
      headers,
    );
    expect(result.tasks.find((item) => item.kind === 'feed')).toMatchObject({ depth: 63, sourceType: 'atom' });
    const sitemap = parseHistoryXml('<urlset><url><loc>https://history.test/old</loc></url></urlset>', task, blog, task.url, headers);
    expect(sitemap.tasks[0].sourceType).toBe('sitemap');
  });
});

it('rejects invalid WordPress pagination counts and omits homepage comments feeds', () => {
  const wp = { ...task, kind: 'wordpress' as const, url: 'https://history.test/wp-json/wp/v2/posts?page=1' };
  for (const count of ['oops', '0'])
    expect(() =>
      parseHistoryWordpress(
        JSON.stringify([{ link: 'https://history.test/post' }]),
        wp,
        blog,
        wp.url,
        new Headers({ 'x-wp-totalpages': count }),
      ),
    ).toThrow('history_pagination_metadata_invalid');
  const home = parseHistoryHome(
    '<link rel="alternate" type="application/rss+xml" href="/comments/feed/"><link rel="alternate" type="application/rss+xml" href="/feed/">',
    task,
    blog,
    blog.url,
  );
  expect(home.tasks.filter((item) => item.kind === 'feed').map((item) => item.url)).toEqual(['https://history.test/feed/']);
});

it('does not enqueue oEmbed alternatives as history feeds', () => {
  const home = parseHistoryHome(
    '<link rel="alternate" type="text/xml+oembed" href="/custom-embed.xml"><link rel="alternate" type="application/json+oembed" href="/wp-json/oembed/1.0/embed"><link rel="alternate" type="application/xml" href="/real.xml">',
    task,
    blog,
    blog.url,
  );
  expect(home.tasks.filter((item) => item.kind === 'feed').map((item) => item.url)).toEqual(['https://history.test/real.xml']);
});

it('keeps all supported platform owner paths and Gamer query identities separate during history import', () => {
  for (const [home, own, other] of [
    ['https://note.com/alice', 'https://note.com/alice/n/one', 'https://note.com/bob/n/one'],
    ['https://matters.town/@alice', 'https://matters.town/@alice/one', 'https://matters.town/@bob/one'],
    ['https://hackmd.io/@alice', 'https://hackmd.io/@alice/one', 'https://hackmd.io/@bob/one'],
    ['https://substack.com/@alice', 'https://substack.com/@alice/post', 'https://substack.com/@bob/post'],
    [
      'https://home.gamer.com.tw/homeindex.php?owner=alice',
      'https://home.gamer.com.tw/creation.php?owner=alice&sn=1',
      'https://home.gamer.com.tw/creation.php?owner=bob&sn=1',
    ],
  ]) {
    expect(historyInPublication(own, home)).toBe(true);
    expect(historyInPublication(other, home)).toBe(false);
  }
  expect(historyInPublication('https://custom.example/elsewhere', 'https://custom.example/blog')).toBe(false);
});
