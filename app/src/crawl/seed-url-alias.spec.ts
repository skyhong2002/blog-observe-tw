import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { applyVerifiedSeedAlias } from './seed-url-alias.ts';
import type { SeedUrlValidation } from './seed-url-validation.ts';

function verification(id: number, inputUrl: string, finalUrl: string): SeedUrlValidation {
  const feed = `${finalUrl}feed/`;
  return {
    id,
    inputUrl,
    finalUrl,
    validated: true,
    reason: 'verified_identity_and_source',
    title: '已核對名稱',
    siteName: '',
    author: '',
    feedSources: [{ url: feed, type: 'rss' }],
    evidence: {
      checkedAt: new Date().toISOString(),
      homepageStatus: 200,
      homepageSha256: 'a'.repeat(64),
      identityMatches: ['已核對名稱'],
      researchEvidence: [],
      sourceChecks: [{ url: feed, finalUrl: feed, status: 200, type: 'rss', reason: 'valid_xml_source' }],
    },
  };
}
function fixture(
  girls = false,
  options: {
    blocked?: string;
    targetState?: string;
    originalRedirect?: boolean;
    affectedRows?: number;
    sourceState?: string;
    feedOwner?: number;
  } = {},
) {
  const sourceId = girls ? 134 : 89;
  const targetId = girls ? 94 : 28;
  const home = girls ? 'https://girlsplan.com/' : 'https://vivianexplore.tw/';
  const old = girls ? 'https://www.girlslifeplan.com/' : 'https://vivianjourney.tw/';
  const source = verification(sourceId, girls ? home : old, home);
  const target = verification(targetId, home, home);
  const original = verification(targetId, girls && options.originalRedirect !== false ? old : home, home);
  const rows = new Map([
    [sourceId, { id: sourceId, slug: 'alias', name: 'source', url: null, status: options.sourceState || 'seed' }],
    [targetId, { id: targetId, slug: 'canonical', name: 'target', url: home, status: options.targetState || 'verified' }],
  ]);
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.startsWith('SELECT id,slug,name,url,status FROM blogs')) return [[rows.get(Number(params[0]))], []];
    const blocked = sql.match(/^SELECT blog_id FROM (\w+)/)?.[1];
    if (blocked) return [blocked === options.blocked ? [{ blog_id: sourceId }] : [], []];
    if (sql.includes('FROM seed_records'))
      return [
        [
          { blog_id: sourceId, source_sha256: 's', source_row: 1, original_name: 'source' },
          { blog_id: targetId, source_sha256: 's', source_row: 2, original_name: 'target' },
        ],
        [],
      ];
    if (sql.includes('FROM blog_urls')) return [[{ blog_id: targetId, url: home, is_primary: 1 }], []];
    if (sql.includes('FROM feed_sources')) return [[{ blog_id: options.feedOwner ?? targetId, type: 'rss' }], []];
    if (sql.includes('FROM discovery_candidate_audits'))
      return [
        [
          {
            id: 50,
            candidate_id: 60,
            status: 'approved',
            source_evidence: JSON.stringify({ seedBlogId: targetId, verification: original }),
          },
        ],
        [],
      ];
    throw new Error(`unexpected query ${sql}`);
  });
  const connection = {
    query,
    execute: vi.fn(async () => [{ affectedRows: options.affectedRows ?? 1 }, []]),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
  const getConnection = vi.fn(async () => connection);
  return { source, target, connection, getConnection, pool: { getConnection } as unknown as Pool };
}

describe('reviewed duplicate seed aliases', () => {
  it.each([false, true])('locks IDs in order and preserves all original ownership for girls=%s', async (girls) => {
    const f = fixture(girls);
    const result = await applyVerifiedSeedAlias(f.pool, f.source, f.target);
    expect(result.status).toBe('moved');
    const locks = f.connection.query.mock.calls.filter(([sql]) => sql.startsWith('SELECT id,slug'));
    expect(locks.map(([, params]) => params[0])).toEqual([f.target.id, f.source.id]);
    const writes = f.connection.execute.mock.calls as unknown as Array<[string, unknown[]]>;
    expect(writes).toHaveLength(2);
    expect(writes[0][0]).toMatch(/^UPDATE blogs SET url=/);
    expect(writes[0][1][2]).toBe(f.source.id);
    expect(writes[1][0]).toMatch(/INSERT INTO discovery_candidate_audits/);
    const audit = JSON.parse(String(writes[1][1][2]));
    expect(audit.sourceId).toBe(f.source.id);
    expect(audit.targetId).toBe(f.target.id);
    expect(audit.after.source.status).toBe('moved');
    expect(audit.after.target.status).toBe('verified');
    expect(audit.targetOriginalAudit.evidence.verification.id).toBe(f.target.id);
    expect(audit.zeroDataChecks).toEqual({
      posts: 0,
      user_follows: 0,
      blog_authors: 0,
      blog_urls: 0,
      feed_sources: 0,
      manualCommunityTags: 0,
    });
    expect(f.connection.commit).toHaveBeenCalledOnce();
    expect(f.connection.rollback).not.toHaveBeenCalled();
    expect(f.connection.release).toHaveBeenCalledOnce();
  });

  it.each(['posts', 'user_follows', 'blog_authors', 'blog_urls', 'feed_sources', 'blog_tags'])(
    'rejects any existing source %s row',
    async (blocked) => {
      const f = fixture(false, { blocked });
      await expect(applyVerifiedSeedAlias(f.pool, f.source, f.target)).rejects.toThrow(/source has/);
      expect(f.connection.execute).not.toHaveBeenCalled();
      expect(f.connection.rollback).toHaveBeenCalledOnce();
      expect(f.connection.release).toHaveBeenCalledOnce();
    },
  );

  it('requires target original girlslifeplan redirect evidence even when both fresh inputs use girlsplan', async () => {
    const f = fixture(true, { originalRedirect: false });
    await expect(applyVerifiedSeedAlias(f.pool, f.source, f.target)).rejects.toThrow('target original redirect evidence missing');
    expect(f.connection.execute).not.toHaveBeenCalled();
  });

  it('rejects unreviewed pairs and stale verification before opening a transaction', async () => {
    const unreviewed = fixture();
    unreviewed.source.id = 95;
    await expect(applyVerifiedSeedAlias(unreviewed.pool, unreviewed.source, unreviewed.target)).rejects.toThrow('reviewed pair');
    expect(unreviewed.getConnection).not.toHaveBeenCalled();
    const stale = fixture();
    stale.target.evidence.checkedAt = new Date(Date.now() - 25 * 3600_000).toISOString();
    await expect(applyVerifiedSeedAlias(stale.pool, stale.source, stale.target)).rejects.toThrow('fresh verifier');
    expect(stale.getConnection).not.toHaveBeenCalled();
  });

  it('rejects different publication paths and mismatched verified feeds', async () => {
    const path = fixture();
    path.source.finalUrl += 'someone-else/';
    await expect(applyVerifiedSeedAlias(path.pool, path.source, path.target)).rejects.toThrow('publication identities differ');
    const feed = fixture();
    feed.source.feedSources[0].url += 'different';
    feed.source.evidence.sourceChecks[0].finalUrl = feed.source.feedSources[0].url;
    await expect(applyVerifiedSeedAlias(feed.pool, feed.source, feed.target)).rejects.toThrow('no matching verified feed');
  });

  it('rejects target state changes, source state changes, and foreign feed ownership', async () => {
    for (const options of [{ targetState: 'moved' }, { sourceState: 'verified' }, { feedOwner: 999 }]) {
      const f = fixture(false, options);
      await expect(applyVerifiedSeedAlias(f.pool, f.source, f.target)).rejects.toThrow(/state changed|exclusively own/);
      expect(f.connection.commit).not.toHaveBeenCalled();
      expect(f.connection.rollback).toHaveBeenCalledOnce();
    }
  });

  it('rolls back if guarded source update changes no rows', async () => {
    const f = fixture(false, { affectedRows: 0 });
    await expect(applyVerifiedSeedAlias(f.pool, f.source, f.target)).rejects.toThrow('source changed');
    expect(f.connection.execute).toHaveBeenCalledOnce();
    expect(f.connection.commit).not.toHaveBeenCalled();
    expect(f.connection.rollback).toHaveBeenCalledOnce();
  });
});
