import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { deriveDirectoryHomes, directoryListing } from './directory-listing.ts';

describe('BlogBlog.Club directory listings', () => {
  it('counts only a direct link from a blogblog.club page', () => {
    expect(directoryListing({ blogrollRelationship: { from: 'https://blogblog.club/blogrollroll' } })).toBe(
      'https://blogblog.club/blogrollroll',
    );
    expect(
      directoryListing(JSON.stringify({ crawlerObservation: { blogrollRelationship: { from: 'https://blogblog.club/party' } } })),
    ).toBe('https://blogblog.club/party');
    expect(directoryListing({ directoryListing: { page: 'https://blogblog.club/party' } })).toBe('https://blogblog.club/party');
    // One step further (a member's blogroll) or a look-alike host is not the directory.
    expect(directoryListing({ blogrollRelationship: { from: 'https://igouist.github.io/blogroll' } })).toBeNull();
    expect(directoryListing({ blogrollRelationship: { from: 'https://blogblog.club.evil.test/' } })).toBeNull();
    expect(directoryListing({ blogrollRelationship: { from: 'http://blogblog.club/party' } })).toBeNull();
    expect(directoryListing(null)).toBeNull();
  });
  it('queues the publication home of a listed blogroll page or post and marks every inspected row', async () => {
    const rows = [
      {
        id: 1,
        url: 'https://wiwi.blog/blogroll',
        source_evidence: { blogrollRelationship: { from: 'https://blogblog.club/blogrollroll' } },
      },
      { id: 2, url: 'https://friend.test/blogroll', source_evidence: { blogrollRelationship: { from: 'https://wiwi.blog/blogroll' } } },
    ];
    const query = vi.fn(async (sql: string, _params?: unknown[]) => (sql.startsWith('SELECT') ? [rows] : [{}]));
    const result = await deriveDirectoryHomes({ query } as unknown as Pool, 50, new Date('2026-10-16T00:00:00Z'));
    expect(result).toEqual({ inspected: 2, homes: 1 });
    const insert = query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT'));
    expect(insert?.[1]).toEqual([
      'https://wiwi.blog/',
      'https://blogblog.club/blogrollroll',
      JSON.stringify({ page: 'https://blogblog.club/blogrollroll', candidateId: 1, linkedUrl: 'https://wiwi.blog/blogroll' }),
      new Date('2026-10-16T00:00:00Z'),
      JSON.stringify({ page: 'https://blogblog.club/blogrollroll', candidateId: 1, linkedUrl: 'https://wiwi.blog/blogroll' }),
    ]);
    const marks = query.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE')).map(([, params]) => params);
    expect(marks).toEqual([
      ['https://wiwi.blog/', 1],
      ['', 2],
    ]);
  });
});
