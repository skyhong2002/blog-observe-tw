import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { HOME_MENTIONS_SQL, loadHomeMentions, mentionPublicUrl, mentionQuote } from './home-feed.ts';
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
    }));
    const data = await loadHomeMentions({ query: async () => [rows] } as unknown as Pool);
    expect(data.items).toHaveLength(8);
    expect(data.truncated).toBe(true);
    expect(data.items[0].postUrl).toBeNull();
    expect(data.items[0].targetHomeUrl).toBeNull();
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
