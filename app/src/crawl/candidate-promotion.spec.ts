import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { recordCandidateCheck } from './candidate-promotion.ts';
import { CANDIDATE_POLICY, type CandidateCheck } from './candidate-validation.ts';

const checked = (): CandidateCheck => ({
  policy: CANDIDATE_POLICY,
  id: 1,
  inputUrl: 'https://writer.test/',
  checkedAt: new Date().toISOString(),
  eligible: false,
  reason: 'no_verified_feed_or_sitemap',
});
describe('candidate writer entry guards', () => {
  it('dry-run cannot acquire a SQL connection or persist a weekly review gate', async () => {
    const pool = { getConnection: vi.fn() } as unknown as Pool;
    expect(await recordCandidateCheck(pool, checked(), false)).toMatchObject({ status: 'dry-run' });
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
  it('rejects stale evidence before acquiring a writer connection', async () => {
    const pool = { getConnection: vi.fn() } as unknown as Pool;
    await expect(recordCandidateCheck(pool, { ...checked(), checkedAt: '2001-01-01T00:00:00Z' }, true)).rejects.toThrow('fresh');
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
  it('rejects oversized evidence before taking a SQL lock', async () => {
    const pool = { getConnection: vi.fn() } as unknown as Pool;
    await expect(recordCandidateCheck(pool, { ...checked(), reason: 'x'.repeat(130 * 1024) }, true)).rejects.toThrow('limit');
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
  it('invalid depth and missing personal proof become audited declines, never endless throws', async () => {
    for (const evidence of [{ discoveryDepth: 9 }, { discoveryDepth: 1 }]) {
      const c = {
        query: vi.fn(async (sql: string) =>
          sql.includes('GET_LOCK')
            ? [[{ held: 1 }]]
            : sql.includes('RELEASE_LOCK')
              ? [[{ released: 1 }]]
              : sql.includes('FROM discovery_candidates')
                ? [
                    [
                      {
                        id: 1,
                        url: 'https://writer.test/',
                        name: 'Writer',
                        status: 'candidate',
                        source_type: 'blogroll',
                        source_evidence: evidence,
                      },
                    ],
                  ]
                : [[]],
        ),
        execute: vi.fn(async (_sql: string) => [{ affectedRows: 1 }]),
        beginTransaction: vi.fn(),
        commit: vi.fn(),
        rollback: vi.fn(),
        release: vi.fn(),
        destroy: vi.fn(),
      };
      const pool = { getConnection: vi.fn(async () => c) } as unknown as Pool;
      const result = await recordCandidateCheck(pool, { ...checked(), eligible: true }, true);
      expect(result.status).toBe('candidate');
      expect(['discovery_depth_invalid', 'personal_publication_unverified']).toContain(result.reason);
      expect(c.commit).toHaveBeenCalledOnce();
      expect(c.execute.mock.calls.some(([sql]) => sql.includes('discovery_candidate_audits'))).toBe(true);
    }
  });
  it('admits a listed feedless home with its validated generated scraper instead of a feed', async () => {
    const home = 'https://writer.test/';
    const check: CandidateCheck = {
      ...checked(),
      eligible: true,
      reason: 'verified_homepage_and_generated_scraper_directory_listed',
      directoryListing: 'https://blogblog.club/blogroll',
      verification: {
        id: 1,
        inputUrl: home,
        finalUrl: home,
        validated: false,
        reason: 'no_verified_feed_or_sitemap',
        title: 'Writer Notes',
        siteName: 'Writer Notes',
        author: '',
        feedSources: [],
        evidence: {
          checkedAt: '',
          homepageStatus: 200,
          homepageSha256: null,
          identityMatches: ['writer'],
          sourceChecks: [],
          researchEvidence: [],
        },
      },
      feed: { url: home, type: 'scraper', title: 'Writer Notes', identityUrl: home, entries: 3, sample: [`${home}a/`, `${home}b/`] },
      scraper: { id: 9, codeSha256: 'f'.repeat(64) },
    };
    const scraperRow = vi.fn(() => [[{ id: 9, status: 'validated', code_sha256: 'f'.repeat(64) }]]);
    const c = {
      query: vi.fn(async (sql: string) =>
        sql.includes('GET_LOCK')
          ? [[{ held: 1 }]]
          : sql.includes('RELEASE_LOCK')
            ? [[{ released: 1 }]]
            : sql.includes('FROM discovery_candidates WHERE id')
              ? [
                  [
                    {
                      id: 1,
                      url: home,
                      name: 'Writer Notes',
                      status: 'candidate',
                      source_type: 'blogblog-club',
                      source_evidence: { directoryListing: { page: 'https://blogblog.club/blogroll' } },
                    },
                  ],
                ]
              : sql.includes('FROM blog_scrapers')
                ? scraperRow()
                : [[]],
      ),
      execute: vi.fn(async (sql: string, _params?: unknown[]) =>
        sql.startsWith('INSERT INTO blogs') ? [{ insertId: 42, affectedRows: 1 }] : [{ affectedRows: 1 }],
      ),
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      release: vi.fn(),
      destroy: vi.fn(),
    };
    const pool = { getConnection: vi.fn(async () => c) } as unknown as Pool;
    expect(await recordCandidateCheck(pool, check, true)).toMatchObject({
      status: 'approved',
      blogId: 42,
      reason: 'auto-approved-new-blog',
    });
    const writes = c.execute.mock.calls.map(([sql]) => sql as string);
    expect(writes.some((sql) => sql.startsWith('INSERT INTO feed_sources'))).toBe(false);
    expect(writes).toContain("UPDATE blog_scrapers SET status='active',blog_id=?,activated_at=? WHERE id=?");
    expect(c.execute.mock.calls.find(([sql]) => String(sql).includes('discovery_candidate_audits'))?.[1]).toContain(
      'automatic-scraper-review',
    );
    expect(c.commit).toHaveBeenCalledOnce();

    // The scraper row must still be the validated one, or nothing is admitted.
    scraperRow.mockReturnValue([[]]);
    c.commit.mockClear();
    expect(await recordCandidateCheck(pool, check, true)).toMatchObject({ status: 'candidate', reason: 'generated_scraper_missing' });
  });
});
