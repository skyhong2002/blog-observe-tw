import { describe, expect, it, vi } from 'vitest';
import { PARSER_VERSION } from '../relations/parser.ts';
import type { ContentSql } from './contracts.ts';
import { storedRelationContent } from './store.ts';

const aliases = [
  { blogId: 1, url: 'https://source.example/' },
  { blogId: 2, url: 'https://target.example/' },
];
const link = (location = 'body', parserVersion?: string) => ({
  targetUrl: 'https://target.example/obsolete',
  targetBlogId: 99,
  anchorText: '舊分類',
  context: '舊上下文',
  location,
  ordinal: 0,
  ...(parserVersion ? { parserVersion } : {}),
});
function fixture(pageLinks: unknown) {
  const row = {
    body_html: '<p>目前正文<a href="https://target.example/current">當前連結</a></p>',
    article_url: 'https://source.example/post',
    source_url: 'https://source.example/feed',
    source_kind: 'rss-content',
    content_hash: 'current-body-hash',
    obtained_at: '2026-10-12T00:00:00Z',
    page_links: pageLinks,
    truncated: false,
  };
  const execute = vi.fn(async () => [[row]]);
  return { row, execute, db: { execute } as unknown as ContentSql };
}
describe('normalized body reparse and non-body snapshot provenance', () => {
  it.each([undefined, 'semantic-links-v2', PARSER_VERSION])(
    'old body snapshots never replace current body evidence (%j)',
    async (version) => {
      const f = fixture(JSON.stringify([link('body', version)]));
      const original = f.row.page_links;
      const result = await storedRelationContent(f.db, 7, 1, aliases);
      expect(result?.parsed.links).toHaveLength(1);
      expect(result?.parsed.links[0]).toMatchObject({ targetUrl: 'https://target.example/current', targetBlogId: 2, location: 'body' });
      expect(f.row.page_links).toBe(original);
      expect(f.execute).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps current-parser blogroll separate from reparsed body and re-resolves publication identity', async () => {
    const snapshot = [link('body', PARSER_VERSION), link('blogroll', PARSER_VERSION)];
    // Existing rollback readers still accept the array and ignore the extra version field.
    expect(
      JSON.parse(JSON.stringify(snapshot)).every((l: { location: string }) =>
        ['body', 'sidebar', 'blogroll', 'comment'].includes(l.location),
      ),
    ).toBe(true);
    const f = fixture(snapshot);
    const result = await storedRelationContent(f.db, 7, 1, aliases);
    expect(result?.parsed.links.map((l) => [l.location, l.targetUrl, l.targetBlogId])).toEqual([
      ['body', 'https://target.example/current', 2],
      ['blogroll', 'https://target.example/obsolete', 2],
    ]);
    expect(result?.parsed.nonBodySnapshotState).toBe('current-parser');
  });
  it.each([JSON.stringify([link('blogroll')]), JSON.stringify([link('comment', 'semantic-links-v2')]), '{malformed'])(
    'marks unversioned/stale/malformed non-body observations unverified without deleting raw (%j)',
    async (snapshot) => {
      const f = fixture(snapshot);
      const original = f.row.page_links;
      const result = await storedRelationContent(f.db, 7, 1, aliases);
      expect(result?.parsed.links).toHaveLength(1);
      expect(result?.parsed.nonBodySnapshotState).toBe('unverified');
      expect(result?.parsed.truncated).toBe(true);
      expect(f.row.page_links).toBe(original);
      expect(f.execute).toHaveBeenCalledTimes(1);
    },
  );
  it('falls back to body_html when no page snapshot exists', async () => {
    const result = await storedRelationContent(fixture(null).db, 7, 1, aliases);
    expect(result?.parsed.links[0].targetUrl).toBe('https://target.example/current');
    expect(result?.parsed.nonBodySnapshotState).toBe('none');
  });
});
