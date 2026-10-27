import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validateGenreSeed } from '../../../tools/lib/genre-seed.ts';
import { fakeTagClient, tag } from '../../test/tag-client.ts';
import { genreItems } from './resolve.ts';
import { loadBlogGenres, loadShownGenres, readBlogGenres } from './store.ts';
import { setTagClient, TagServiceError, tagDomain, trafficTagClient, trafficTagsUrl } from './traffic.ts';

const blogRows = (rows: Record<string, unknown>[]) => ({
  calls: [] as { sql: string; args: unknown }[],
  async query(sql: string, args: unknown) {
    this.calls.push({ sql, args });
    return [rows];
  },
});

describe('blog tags from site.observe.tw', () => {
  it('keys traffic tags for URLs and keeps their spelling, editors first as traffic sends them', () => {
    expect(
      genreItems([
        tag('個人', { source: 'editor' }),
        tag('美食', { source: 'sheet' }),
        tag('3C', { agrees: 2 }),
        tag('Single Origin', { source: 'community', agrees: 1 }),
        tag('food', { source: 'community' }),
        tag('a/b', { source: 'community' }),
        tag('咖啡', { source: 'admin', visible: false, adminOverride: 'hide' }),
      ]),
    ).toEqual([
      { genre: '個人', label: '個人', source: 'editor', visible: true, agrees: 0, disagrees: 0, adminOverride: null },
      { genre: 'food', label: '美食', source: 'editor', visible: true, agrees: 0, disagrees: 0, adminOverride: null },
      { genre: 'gadgets', label: '3C', source: 'ai', visible: true, agrees: 2, disagrees: 0, adminOverride: null },
      { genre: 'single origin', label: 'Single Origin', source: 'community', visible: true, agrees: 1, disagrees: 0, adminOverride: null },
      { genre: '咖啡', label: '咖啡', source: 'admin', visible: false, agrees: 0, disagrees: 0, adminOverride: 'hide' },
    ]);
  });
  it('maps blogs to the domain traffic uses and links its tag block there', () => {
    expect(trafficTagsUrl('wiwi.blog')).toBe('https://site.observe.tw/site/wiwi.blog/#tags');
    expect(tagDomain('www.KOCPC.com.tw')).toBe('kocpc.com.tw');
    expect(tagDomain('blog.example.com')).toBe('blog.example.com');
    expect(tagDomain('localhost')).toBeNull();
    expect(tagDomain(null)).toBeNull();
  });
  it('reports traffic being down as unavailable instead of an empty classification', async () => {
    let failures = 0;
    const result = await readBlogGenres(blogRows([{ id: 1, slug: 'a', host: 'a.blog.tw' }]) as never, ['a'], (error) => {
      expect(error).toBeInstanceOf(TagServiceError);
      failures++;
    });
    expect(result.status).toBe('unavailable');
    expect(result.blogs.size).toBe(0);
    expect(failures).toBe(1);
  });
  it('answers requested slugs from the snapshot of every verified blog; a domain traffic does not know has no tags', async () => {
    const traffic = fakeTagClient({ 'a.blog.tw': [tag('美食', { source: 'admin', visible: false, adminOverride: 'hide', agrees: 20 })] });
    setTagClient(traffic.client);
    const pool = blogRows([
      { id: 1, slug: 'a', host: 'www.a.blog.tw' },
      { id: 2, slug: 'b', host: 'b.blog.tw' },
    ]);
    const result = await loadBlogGenres(pool as never, ['a', 'a', 'b', 'c']);
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0].sql).toContain("status='verified'");
    expect(traffic.reads).toEqual([{ domains: ['a.blog.tw', 'b.blog.tw'] }]);
    // A second blog page reads the same snapshot, not traffic.
    await loadBlogGenres(pool as never, ['b']);
    expect(traffic.reads).toHaveLength(1);
    expect(result.get('a')?.items).toEqual([
      { genre: 'food', label: '美食', source: 'admin', visible: false, agrees: 20, disagrees: 0, adminOverride: 'hide' },
    ]);
    expect(result.get('b')).toEqual({ status: 'ready', items: [] });
    expect(result.get('c')).toEqual({ status: 'ready', items: [] });
    await expect(
      loadBlogGenres(
        pool as never,
        Array.from({ length: 201 }, (_, i) => String(i)),
      ),
    ).rejects.toThrow('genre-read-bound');
  });
  it('reads traffic once a minute, never makes a reader wait once it has answered, and keeps the last answer while it is down', async () => {
    const traffic = fakeTagClient({ 'a.blog.tw': [tag('旅遊'), tag('露營', { source: 'community', visible: false })] });
    setTagClient(traffic.client);
    const pool = blogRows([
      { id: 1, slug: 'a', host: 'a.blog.tw' },
      { id: 2, slug: 'b', host: 'b.blog.tw' },
    ]);
    const shown = await loadShownGenres(pool as never);
    expect([...shown]).toEqual([[1, [expect.objectContaining({ genre: 'travel', label: '旅遊' })]]]);
    await loadShownGenres(pool as never);
    expect(traffic.reads).toHaveLength(1);
    setTagClient({
      ...traffic.client,
      read: async () => {
        throw new TagServiceError('down');
      },
    });
    const now = Date.now();
    const clock = Date.now;
    try {
      Date.now = () => now + 2 * 60_000;
      expect((await loadShownGenres(pool as never)).get(1)?.[0].genre).toBe('travel');
      Date.now = () => now + 60 * 60_000;
      expect((await loadShownGenres(pool as never)).get(1)?.[0].genre).toBe('travel');
      // A slow traffic is read behind the answer: the request does not wait for it.
      let release = () => {};
      const slow = fakeTagClient({ 'a.blog.tw': [tag('露營')] });
      setTagClient({ ...slow.client, read: (list) => new Promise((r) => (release = () => r(slow.client.read(list)))) });
      expect((await loadShownGenres(pool as never)).get(1)?.[0].genre).toBe('travel');
      release();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect((await loadShownGenres(pool as never)).get(1)?.[0].label).toBe('露營');
    } finally {
      Date.now = clock;
    }
  });
  it('sends the token only to the loopback service and treats a refusal or a bad answer as unavailable', async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    let next = answer(404, { error: 'not found' });
    const client = trafficTagClient({
      readToken: async () => 't'.repeat(40),
      fetcher: async (url, init) => {
        sent.push({ url, init });
        return next;
      },
    });
    await expect(client.read(['a.blog.tw'])).rejects.toThrow(TagServiceError);
    expect(sent[0].url).toBe('http://127.0.0.1:18150/internal/v1/tags');
    expect((sent[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${'t'.repeat(40)}`);
    expect(JSON.parse(String(sent[0].init.body))).toEqual({ domains: ['a.blog.tw'] });
    next = answer(200, { domains: { 'a.blog.tw': [{ tag: 'x', source: 'nope' }] } });
    await expect(client.read(['a.blog.tw'])).rejects.toThrow('tag-service-shape');
    await expect(trafficTagClient({ readToken: async () => null }).read([])).rejects.toThrow('tag-service-token');
  });
  it('validates complete, unique AI labels and rejects malformed seeds', async () => {
    const seed = validateGenreSeed(JSON.parse(await readFile(new URL('../../../data/blog-genre-seed.json', import.meta.url), 'utf8')));
    expect(seed.entries).toHaveLength(473);
    expect(seed.entries.find((b) => b.slug === 'saydigi')?.genres.map((g) => g.genre)).toContain('gadgets');
    // The 2026-10-17 split: software-introduction sites are 軟體介紹, no longer 3C.
    expect(seed.entries.find((b) => b.slug === 'azo-307')?.genres.map((g) => g.genre)).toEqual(['software']);
    expect(() => validateGenreSeed({ ...seed, entries: [seed.entries[0], seed.entries[0]], totalBlogs: 2 })).toThrow();
    expect(() => validateGenreSeed({ ...seed, entries: [{ ...seed.entries[0], genres: [] }], totalBlogs: 1 })).toThrow();
    const five = ['food', 'travel', 'life', 'diary', 'culture'].map((genre) => ({ genre, reason: 'fixture' }));
    expect(() => validateGenreSeed({ ...seed, entries: [{ ...seed.entries[0], genres: five }], totalBlogs: 1 })).toThrow();
    expect(() =>
      validateGenreSeed({
        ...seed,
        entries: [{ ...seed.entries[0], genres: [{ genre: 'creative', reason: 'retired key' }] }],
        totalBlogs: 1,
      }),
    ).toThrow();
  });
});
