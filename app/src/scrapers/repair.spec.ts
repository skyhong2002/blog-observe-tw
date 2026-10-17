import type { Pool } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateCheck } from '../crawl/candidate-validation.ts';

const validateCandidate = vi.fn();
const generateScraper = vi.fn();
vi.mock('../crawl/candidate-validation.ts', async (original) => ({
  ...(await original<typeof import('../crawl/candidate-validation.ts')>()),
  validateCandidate: (...args: unknown[]) => validateCandidate(...args),
}));
vi.mock('./generate.ts', () => ({ generateScraper: (...args: unknown[]) => generateScraper(...args) }));
const { runScraperRepairBatch } = await import('./repair.ts');

const home = 'https://writer.test/';
const candidate = {
  id: 5,
  url: home,
  name: null,
  status: 'candidate',
  source_type: 'blogblog-club',
  source_evidence: { directoryListing: { page: 'https://blogblog.club/blogroll' } },
};
const noFeed = (extra: Partial<CandidateCheck> = {}): CandidateCheck => ({
  policy: 'x',
  id: 5,
  inputUrl: home,
  checkedAt: new Date().toISOString(),
  eligible: false,
  reason: 'no_verified_feed_or_sitemap',
  enrichedName: 'Writer Notes',
  directoryListing: 'https://blogblog.club/blogroll',
  verification: {
    id: 5,
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
  ...extra,
});
function pool() {
  const lease = {
    query: vi.fn(async (sql: string) => (sql.includes('RELEASE_LOCK') ? [[{ released: 1 }]] : [[{ held: 1 }]])),
    release: vi.fn(),
    destroy: vi.fn(),
  };
  return {
    getConnection: vi.fn(async () => lease),
    query: vi.fn(async (sql: string) => (sql.includes('FROM discovery_candidates') ? [[candidate]] : [[]])),
    execute: vi.fn(async () => [{ affectedRows: 1 }]),
  } as unknown as Pool & { execute: ReturnType<typeof vi.fn> };
}

describe('scraper repair of a feedless candidate', () => {
  beforeEach(() => {
    validateCandidate.mockReset();
    generateScraper.mockReset();
  });
  it('takes the homepage name of a nameless listed home and generates from the verified home (dry run writes nothing)', async () => {
    validateCandidate.mockResolvedValue(noFeed());
    generateScraper.mockResolvedValue({ ok: true, scraper: {}, actualModel: 'm', rounds: 1, report: {}, notes: [] });
    const db = pool();
    const outcome = await runScraperRepairBatch(db, { candidateId: 5 });
    expect(outcome).toMatchObject({ status: 'dry-run', target: { type: 'candidate', id: 5 } });
    expect(generateScraper.mock.calls[0][0]).toEqual({ home, trigger: 'new_candidate' });
    expect(db.execute).not.toHaveBeenCalled();
  });
  it('does not spend the model on an unproven, unlisted home', async () => {
    validateCandidate.mockResolvedValue(
      noFeed({
        directoryListing: undefined,
        personalEvidence: { personal: false, reason: 'organization' } as CandidateCheck['personalEvidence'],
      }),
    );
    const outcome = await runScraperRepairBatch(pool(), { candidateId: 5 });
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'organization' });
    expect(generateScraper).not.toHaveBeenCalled();
  });
  it('reports the real preflight reason', async () => {
    validateCandidate.mockResolvedValue(noFeed({ enrichedName: undefined }));
    expect(await runScraperRepairBatch(pool(), { candidateId: 5 })).toMatchObject({ status: 'skipped', reason: 'missing_identity_name' });
  });
});
