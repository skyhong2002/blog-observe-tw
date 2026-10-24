import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import {
  HOME_MENTIONS_SQL,
  loadHomeMentions,
  loadMentionFeed,
  loadProfileMentionFeed,
  loadProfileMentions,
  MENTION_FEED_AFTER_SQL,
  MENTION_FEED_PAGE,
  MENTION_FEED_SQL,
  mentionPublicUrl,
  mentionQuote,
  PROFILE_FEED_AFTER_SQL,
  PROFILE_FEED_PAGE,
  PROFILE_FEED_SQL,
  PROFILE_MENTIONS_SQL,
  parseMentionCursor,
} from './home-feed.ts';
import { profileMentionRss } from './mention-rss.ts';
import { PUBLIC_RELATION } from './public-relation.ts';

vi.mock('../v1/favicon-routes.ts', () => ({ iconManifest: async () => ({}) }));
vi.mock('../v1/icons.ts', () => ({ iconUrl: (slug: string) => `/favicons/${slug}.png` }));
const row = {
  postId: 10,
  postTitle: '正文引用 &#038; 交流',
  postUrl: 'https://a.example/post/',
  publishedAt: '2026-10-14T01:00:00Z',
  sourceBlogId: 1,
  sourceBlogSlug: 'a',
  sourceBlogName: 'A',
  targetBlogId: 2,
  targetBlogSlug: 'b',
  targetBlogName: 'B 個人專欄',
  targetHomeUrl: 'https://medium.com/@b',
  targetUrl: 'https://medium.com/@b/an-article#quote',
  anchor: 'B',
  context: '文章中的上下文',
  observedAt: '2026-10-14T02:00:00Z',
  matchVersion: 'relations-v2',
  extraction: 'content:html:secret-body-hash-prefix',
};
describe('homepage uses public article→blog body citations', () => {
  it('retains original titles and owner URLs, supplies icons, version and date separately', async () => {
    const query = vi.fn(async () => [[row]]);
    const data = await loadHomeMentions({ query } as unknown as Pool, new Date('2026-10-14T03:00:00Z'));
    expect(data).toMatchObject({ days: 90, limit: 8, truncated: false, evidenceType: 'direct-link', location: 'body' });
    expect(JSON.stringify(data)).not.toContain('secret-body-hash-prefix');
    expect(HOME_MENTIONS_SQL).not.toContain('o.extraction');
    expect(data.items[0]).toMatchObject({
      postId: 10,
      postTitle: row.postTitle,
      targetDomain: 'medium.com',
      targetHomeUrl: 'https://medium.com/@b',
      targetUrl: row.targetUrl,
      targetBlogName: 'B 個人專欄',
      sourceIconUrl: '/favicons/a.png',
      evidenceType: 'direct-link',
      location: 'body',
      matchVersion: 'relations-v2',
      contextSource: 'body',
      publishedAt: '2026-10-14T01:00:00.000Z',
      observedAt: '2026-10-14T02:00:00.000Z',
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(HOME_MENTIONS_SQL).toContain('l.target_url targetUrl');
  });
  it('deduplicates article→target before LIMIT, excludes all revoked/future/nonbody ownership paths in SQL', () => {
    expect(HOME_MENTIONS_SQL).toContain(PUBLIC_RELATION);
    expect(HOME_MENTIONS_SQL).toContain("a.status='verified' AND b.status='verified'");
    expect(HOME_MENTIONS_SQL).toContain('l.source_blog_id=p.blog_id');
    expect(HOME_MENTIONS_SQL).toContain("l.location='body'");
    expect(HOME_MENTIONS_SQL).toContain('PARTITION BY p.id,l.target_blog_id ORDER BY l.ordinal');
    // Newest eligible posts come from links that resolved to a blog, not from every post of the window.
    expect(HOME_MENTIONS_SQL).toContain('FORCE INDEX (relation_links_target)');
    expect(HOME_MENTIONS_SQL).toContain('l.target_blog_id IS NOT NULL');
    expect(HOME_MENTIONS_SQL).toContain('STRAIGHT_JOIN relation_links');
    const pickedLimit = HOME_MENTIONS_SQL.indexOf('ORDER BY publishedAt DESC,postId DESC,targetBlogId LIMIT 9');
    expect(HOME_MENTIONS_SQL.indexOf('WHERE link_number=1')).toBeLessThan(pickedLimit);
    expect(pickedLimit).toBeLessThan(HOME_MENTIONS_SQL.indexOf('FROM picked k'));
    // Nine rows come from the nine newest eligible posts: the index walk stops there, before any ranking.
    const newestPosts = HOME_MENTIONS_SQL.indexOf('ORDER BY p.published_at DESC,p.id DESC LIMIT 9');
    expect(newestPosts).toBeGreaterThan(-1);
    expect(newestPosts).toBeLessThan(HOME_MENTIONS_SQL.indexOf('eligible_links AS'));
    // The newest-post walk applies the same public-link predicate as the rows it feeds.
    expect(HOME_MENTIONS_SQL.split(PUBLIC_RELATION).length - 1).toBe(2);
    expect(HOME_MENTIONS_SQL).toContain('ORDER BY k.publishedAt DESC,k.postId DESC,k.targetBlogId');
    expect(HOME_MENTIONS_SQL).toContain('p.published_at>=? AND p.published_at<=?');
    expect(HOME_MENTIONS_SQL).toContain('tp.blog_id=b.id');
    expect(HOME_MENTIONS_SQL).toContain('tp.published_at<=?');
    expect(HOME_MENTIONS_SQL).toContain('admin_relation_overrides');
  });
  it('caps rows and snippets without altering raw observations; bad URLs never become hrefs', async () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({
      ...row,
      postId: i + 1,
      context: 'X'.repeat(1000),
      postUrl: i ? row.postUrl : 'javascript:alert(1)',
      targetHomeUrl: i ? row.targetHomeUrl : 'https://secret@evil.example/',
      targetUrl: i ? row.targetUrl : 'javascript:alert(1)',
    }));
    const data = await loadHomeMentions({ query: async () => [rows] } as unknown as Pool);
    expect(data.items).toHaveLength(8);
    expect(data.truncated).toBe(true);
    expect(data.items[0].postUrl).toBeNull();
    expect(data.items[0].targetHomeUrl).toBeNull();
    expect(data.items[0].targetUrl).toBeNull();
    expect(data.items[0].context).toHaveLength(240);
    expect(rows[0].context).toHaveLength(1000);
    expect(mentionPublicUrl('//evil.example')).toBeNull();
  });
  it('B reads fresh after hide commit while A remains at its barrier; no shared promise or sleep', async () => {
    let hidden = false,
      first = true,
      release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    const query = vi.fn(async () => {
      const captured = hidden ? [] : [row];
      if (first) {
        first = false;
        await barrier;
      }
      return [captured];
    });
    const pool = { query } as unknown as Pool;
    const a = loadHomeMentions(pool);
    hidden = true;
    expect((await loadHomeMentions(pool)).items).toEqual([]);
    expect(query).toHaveBeenCalledTimes(2);
    release();
    expect((await a).items).toHaveLength(1);
  });
  it('SQL failures propagate; unavailable evidence is never presented as empty results', async () => {
    await expect(
      loadHomeMentions({
        query: async () => {
          throw Error('db_timeout');
        },
      } as unknown as Pool),
    ).rejects.toThrow('db_timeout');
  });
});

describe('homepage citations are links the article writes about in a sentence', () => {
  it('requires prose and clause marks around the anchor and drops reprints, by rule rather than by name', () => {
    expect(HOME_MENTIONS_SQL).toContain('LOCATE(l.anchor_text,l.context)>0');
    expect(HOME_MENTIONS_SQL).toContain("CHAR_LENGTH(REPLACE(l.context,l.anchor_text,''))>=12");
    expect(HOME_MENTIONS_SQL).toMatch(/REGEXP '\[，。！？；、,\.!\?;\]'/);
    expect(HOME_MENTIONS_SQL).toContain(')<=5');
    expect(HOME_MENTIONS_SQL).not.toMatch(/原始文章|©/);
  });
  it('quotes the sentence holding the link and marks omitted text with …', () => {
    expect(mentionQuote('今天看 R 的這篇文章，其中這句話讓我覺得很有意思', 'R')).toBe('今天看 R 的這篇文章，其中這句話讓我覺得很有意思');
    expect(mentionQuote('前一句。「Y」的文筆像水；很好。後一句。', '「Y」')).toBe('…「Y」的文筆像水；很好。…');
    // parser.ts started 100 characters before the anchor: the paragraph began earlier.
    expect(mentionQuote(`${'甲'.repeat(100)}B 寫得好。`, 'B')).toBe(`…${'甲'.repeat(40)}B 寫得好。`);
    expect(mentionQuote(`${'乙'.repeat(10)}B${'丙'.repeat(309)}`, 'B')).toBe(`${'乙'.repeat(10)}B${'丙'.repeat(309)}…`);
    expect(mentionQuote('沒有連結文字', '')).toBe('');
    expect(mentionQuote('上下文', 'X')).toBe('');
  });
});

describe('/mentions/ feed pages by source article', () => {
  const at = (postId: number, publishedAt: string, targetBlogId = 2) => ({ ...row, postId, publishedAt, targetBlogId });
  it('keeps every target of the first MENTION_FEED_PAGE articles and points the cursor at the last one', async () => {
    const rows = Array.from({ length: MENTION_FEED_PAGE + 1 }, (_, i) =>
      at(100 - i, `2026-10-${String(20 - i).padStart(2, '0')}T01:00:00Z`),
    );
    rows.splice(1, 0, at(100, '2026-10-20T01:00:00Z', 3));
    const query = vi.fn(async () => [rows]);
    const now = new Date('2026-10-21T00:00:00Z');
    const data = await loadMentionFeed({ query } as unknown as Pool, null, now);
    expect(query).toHaveBeenCalledWith(MENTION_FEED_SQL, [now, now, now]);
    expect(new Set(data.items.map((m) => m.postId)).size).toBe(MENTION_FEED_PAGE);
    expect(data.items.filter((m) => m.postId === 100).map((m) => m.targetBlogId)).toEqual([2, 3]);
    expect(data.nextCursor).toBe(`2026-10-09T01:00:00.000Z_${100 - MENTION_FEED_PAGE + 1}`);
  });
  it('reads after a cursor with a keyset on publish time and post id; the oldest page has no cursor', async () => {
    const query = vi.fn(async () => [[at(5, '2026-01-01T00:00:00Z')]]);
    const now = new Date('2026-10-21T00:00:00Z');
    const cursor = parseMentionCursor('2026-10-09T01:00:00.000Z_89');
    expect(cursor).toEqual({ publishedAt: new Date('2026-10-09T01:00:00.000Z'), postId: 89 });
    const data = await loadMentionFeed({ query } as unknown as Pool, cursor, now);
    expect(query).toHaveBeenCalledWith(MENTION_FEED_AFTER_SQL, [now, cursor?.publishedAt, cursor?.publishedAt, 89, now, now]);
    expect(MENTION_FEED_AFTER_SQL).toContain('(p.published_at<? OR (p.published_at=? AND p.id<?))');
    expect(MENTION_FEED_AFTER_SQL).toContain(PUBLIC_RELATION);
    expect(data.nextCursor).toBeNull();
  });
  it('rejects anything but its own cursor shape', () => {
    for (const bad of ['', '89', '2026-10-09_89', '2026-10-09T01:00:00.000Z_0', '2026-10-09T01:00:00.000Z_-1', 'x_1', 42, null])
      expect(parseMentionCursor(bad)).toBeNull();
  });
});

describe("a blog's whole list of citing articles (/blogs/<key>/mentions/ and its RSS)", () => {
  const at = (postId: number, publishedAt: string) => ({ ...row, postId, publishedAt });
  const now = new Date('2026-10-21T00:00:00Z');
  it('reads one blog with no date bound, PROFILE_FEED_PAGE articles a page, cursor at the last one', async () => {
    const rows = Array.from({ length: PROFILE_FEED_PAGE + 1 }, (_, i) =>
      at(100 - i, `2026-09-${String(30 - i).padStart(2, '0')}T01:00:00Z`),
    );
    const query = vi.fn(async () => [rows]);
    const data = await loadProfileMentionFeed({ query } as unknown as Pool, 7, null, now);
    expect(query).toHaveBeenCalledWith(PROFILE_FEED_SQL, [7, now, now]);
    expect(PROFILE_FEED_SQL).toContain('l.target_blog_id=? AND p.published_at<=? AND');
    expect(data.items).toHaveLength(PROFILE_FEED_PAGE);
    expect(data.nextCursor).toBe(`2026-09-11T01:00:00.000Z_${100 - PROFILE_FEED_PAGE + 1}`);
    expect(Object.keys(data.items[0])).not.toContain('context');
  });
  it('reads after a cursor with the same keyset as /mentions/; the last page has no cursor', async () => {
    const query = vi.fn(async () => [[at(5, '2026-01-01T00:00:00Z')]]);
    const cursor = parseMentionCursor('2026-09-11T01:00:00.000Z_81');
    const data = await loadProfileMentionFeed({ query } as unknown as Pool, 7, cursor, now);
    expect(query).toHaveBeenCalledWith(PROFILE_FEED_AFTER_SQL, [7, now, cursor?.publishedAt, cursor?.publishedAt, 81, now]);
    expect(PROFILE_FEED_AFTER_SQL).toContain(PUBLIC_RELATION);
    expect(data.nextCursor).toBeNull();
  });
  it('the blog page section keeps its year and its 10 rows', async () => {
    const query = vi.fn(async () => [[row]]);
    const data = await loadProfileMentions({ query } as unknown as Pool, 7, now);
    expect(query).toHaveBeenCalledWith(PROFILE_MENTIONS_SQL, [7, new Date('2025-10-21T00:00:00Z'), now, now]);
    expect(PROFILE_MENTIONS_SQL).toContain('LIMIT 11');
    expect(data.items[0]).toMatchObject({ postId: 10, sourceBlogSlug: 'a', postUrl: 'https://a.example/post/' });
  });
  it('the RSS lists each citing article once, escaped, linked to the original, with a per-article guid', () => {
    const feed = {
      evidenceType: 'direct-link' as const,
      location: 'body' as const,
      limit: PROFILE_FEED_PAGE,
      generatedAt: now.toISOString(),
      nextCursor: null,
      items: [
        {
          postId: 10,
          postTitle: 'A & <B>',
          postUrl: 'https://a.example/post/',
          publishedAt: '2026-10-14T01:00:00.000Z',
          sourceBlogSlug: 'a',
          sourceBlogName: 'A 站',
          sourceIconUrl: null,
          targetUrl: null,
          anchor: 'B',
          quote: '我讀了 B 的文章。',
        },
        {
          postId: 11,
          postTitle: '',
          postUrl: null,
          publishedAt: null,
          sourceBlogSlug: 'c d',
          sourceBlogName: 'C',
          sourceIconUrl: null,
          targetUrl: null,
          anchor: '',
          quote: '',
        },
      ],
    };
    const xml = profileMentionRss(feed, { slug: 'b', name: 'B "部落格"' }, 'https://blog.observe.tw');
    expect(xml).toContain('<title>誰提到了「B &quot;部落格&quot;」 · 部落格觀察</title>');
    expect(xml).toContain('<link>https://blog.observe.tw/blogs/b/mentions/</link>');
    expect(xml).toContain('href="https://blog.observe.tw/api/blogs/b/mentions.xml" rel="self"');
    expect(xml).toContain(
      '<item><title>A 站：A &amp; &lt;B&gt;</title><link>https://a.example/post/</link><guid isPermaLink="false">blog.observe.tw:mention:10</guid><pubDate>Wed, 14 Oct 2026 01:00:00 GMT</pubDate><description>我讀了 B 的文章。</description></item>',
    );
    expect(xml).toContain('<title>C：未命名文章</title><link>https://blog.observe.tw/blogs/c%20d/</link>');
    expect(xml.match(/<item>/g)).toHaveLength(2);
  });
});
