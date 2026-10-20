import { describe, expect, it, vi } from 'vitest';
import { planAuthorCleanup } from './author-cleanup.ts';
import { siteAuthorName, writeSiteObservation } from './site-observation.ts';

const page = (head: string, body = '') => `<html><head>${head}</head><body>${body}</body></html>`;

describe('siteAuthorName', () => {
  it('reads the JSON-LD author, then meta author, then an h-card', () => {
    const ld = { '@context': 'https://schema.org', '@type': 'Blog', name: '某站', author: { '@type': 'Person', name: '蘿蔔' } };
    expect(siteAuthorName(page(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`))).toBe('蘿蔔');
    expect(siteAuthorName(page('<title>站</title><meta name="author" content="Lea Verou">'))).toBe('Lea Verou');
    expect(siteAuthorName(page('<title>站</title>', '<div class="h-card"><span class="p-name">Ann</span></div>'))).toBe('Ann');
  });
  it('never takes the site name, an Organization, an address or a placeholder', () => {
    const org = { '@type': 'Organization', name: 'Carrot Blog' };
    expect(siteAuthorName(page(`<title>Carrot Blog</title><script type="application/ld+json">${JSON.stringify(org)}</script>`))).toBeNull();
    expect(siteAuthorName(page('<title>Carrot Blog | 首頁</title><meta name="author" content="Carrot Blog">'))).toBeNull();
    expect(siteAuthorName(page('<title>站</title><meta name="author" content="admin">'))).toBeNull();
    expect(siteAuthorName(page('<title>站</title><meta name="author" content="me@example.com">'))).toBeNull();
    // A person's name inside the site title is still a person.
    expect(siteAuthorName(page('<title>蘿蔔的部落格</title><meta name="author" content="蘿蔔">'))).toBe('蘿蔔');
  });
});

describe('writeSiteObservation', () => {
  const observation = {
    homepageUrl: 'https://example.com/',
    httpStatus: 200,
    authorName: '蘿蔔',
    personal: true,
    organization: false,
    reason: 'first_person_site_introduction',
    identitySnippet: '我是蘿蔔',
  };
  it('names the author only for a blog that has none', async () => {
    const execute = vi.fn(async (_sql: string, _parameters?: unknown[]) => [{ insertId: 9 }]);
    const named = { execute, query: vi.fn(async () => [[{ 1: 1 }]]) };
    expect(await writeSiteObservation(named as never, 1, observation)).toBe(false);
    expect(execute).toHaveBeenCalledOnce();
    const empty = { execute, query: vi.fn(async () => [[]]) };
    expect(await writeSiteObservation(empty as never, 1, observation)).toBe(true);
    const sql = execute.mock.calls.map(([statement]) => statement);
    expect(sql.some((statement) => statement.startsWith('INSERT INTO authors'))).toBe(true);
    expect(sql.at(-1)).toContain("'homepage'");
  });
});

describe('planAuthorCleanup', () => {
  it('renames, merges into a clean twin, rejects placeholders and repairs posts.author', async () => {
    const query = vi.fn(async (sql: string, _parameters?: unknown[]) => {
      if (sql.includes('GROUP_CONCAT'))
        return [
          [
            { id: 1, displayName: 'noreply@blogger.com (carol)', blogIds: '5' },
            { id: 2, displayName: 'noreply@blogger.com (Unknown)', blogIds: '6' },
            { id: 3, displayName: 'x@example.com (Ken)', blogIds: '7' },
            { id: 4, displayName: 'y@example.com (Ken)', blogIds: '7' },
          ],
        ];
      if (sql.includes('a.normalized_name=?')) return [(_parameters?.[1] === 'carol' ? [{ id: 10 }] : []) as unknown[]];
      return [
        [
          { id: 100, author: 'noreply@blogger.com (carol)' },
          { id: 101, author: 'noreply@blogger.com (carol)' },
          { id: 102, author: 'Unknown' },
        ],
      ];
    });
    const plan = await planAuthorCleanup({ query } as never);
    expect(plan.merged).toEqual([
      { id: 1, into: 10 },
      { id: 4, into: 3 },
    ]);
    expect(plan.renamed).toEqual([{ id: 3, to: 'Ken' }]);
    expect(plan.rejected).toEqual([{ id: 2 }]);
    expect(plan.posts).toEqual([
      { to: 'carol', ids: [100, 101] },
      { to: null, ids: [102] },
    ]);
  });
});
