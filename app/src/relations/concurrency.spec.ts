import type { Pool } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { invalidateRelationCache, readBlogRelations, readPublicRelations } from './routes.ts';

/** No DB or network: pause after a public SQL result is already read. */
function fixture(hold: 'last-query-once' | 'all-edge-reads' = 'last-query-once') {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let visible = true;
  let held = false;
  let failures = 0;
  let revision = 0;
  let reads = 0;
  const pool = {
    query: async (sql: string) => {
      reads++;
      if (failures) {
        failures--;
        throw Error('synthetic_query_failure');
      }
      if (sql.startsWith('SELECT revision')) return [[{ revision }]];
      if (sql.startsWith('SELECT e.*') || sql.startsWith('SELECT l.source_blog_id')) {
        if (hold === 'all-edge-reads') {
          entered.resolve();
          await release.promise;
        }
        return [[]];
      }
      if (sql.startsWith('SELECT id,slug,name')) return [visible ? [{ id: 1, slug: 'synthetic', name: 'public fixture' }] : []];
      if (sql.includes('SELECT p.id postId')) return [visible ? [{ postId: 1, postTitle: 'public fixture', publishedAt: null }] : []];
      if (sql.includes('SELECT COUNT(*) totalPosts'))
        return [
          [
            {
              totalPosts: visible ? 1 : 0,
              observedPosts: 0,
              failedPosts: 0,
              noBodyPosts: 0,
              unknownDatePosts: 0,
              truncatedPosts: 0,
              sampledAt: null,
            },
          ],
        ];
      if (sql.includes('SELECT l.location')) return [[]];
      if (sql.includes('FROM relation_home_links')) {
        if (hold === 'last-query-once' && !held) {
          held = true;
          entered.resolve();
          await release.promise;
        }
        return [[{ count: 0 }]];
      }
      throw Error('unexpected_synthetic_query');
    },
    getConnection: async () => ({
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {},
      query: async (sql: string) => {
        if (sql.includes('revision=revision+1')) revision++;
        return [[]];
      },
    }),
  } as unknown as Pool;
  return {
    pool,
    entered,
    release,
    hide: () => {
      visible = false;
    },
    fail: () => {
      failures++;
    },
    reads: () => reads,
  };
}

describe('public relation reads never share an older in-flight result', () => {
  for (const kind of ['profile', 'global'] as const)
    it(`${kind}: post-commit request reads independently while A is unresolved`, async () => {
      const f = fixture();
      const read = () => (kind === 'profile' ? readBlogRelations(f.pool, { id: 1 }, 90) : readPublicRelations(f.pool, 90));
      const a = read();
      await f.entered.promise;
      f.hide(); // Simulates visibility commit without an in-process invalidation event.
      try {
        const before = f.reads();
        const b = await read();
        expect(f.reads()).toBeGreaterThan(before);
        expect(b.coverage.totalPosts).toBe(0);
        expect(b.nodes).toEqual([]);
        if ('evidence' in b) expect(b.evidence).toEqual([]);
      } finally {
        f.release.resolve();
      }
      const old = await a;
      expect(old.coverage.totalPosts).toBe(1);
      expect((await read()).coverage.totalPosts).toBe(0);
    });
  it('counts same-key and unrelated requests, survives invalidation, and drains all slots', async () => {
    const f = fixture('all-edge-reads');
    const active = Array.from({ length: 4 }, () => readBlogRelations(f.pool, { id: 1 }, 90));
    await f.entered.promise;
    try {
      await expect(readBlogRelations(f.pool, { id: 1 }, 90)).rejects.toMatchObject({ statusCode: 503 });
      await expect(readPublicRelations(f.pool, 30)).rejects.toMatchObject({ statusCode: 503 });
      await invalidateRelationCache(f.pool);
      await expect(readBlogRelations(f.pool, { id: 2 }, 7)).rejects.toMatchObject({ statusCode: 503 });
    } finally {
      f.release.resolve();
    }
    await Promise.all(active);
    expect((await readBlogRelations(f.pool, { id: 1 }, 90)).coverage.totalPosts).toBe(1);
  });
  it('releases failed query slots instead of retaining rejected promises or stale results', async () => {
    const f = fixture('all-edge-reads');
    f.release.resolve();
    for (let i = 0; i < 6; i++) {
      f.fail();
      await expect(readBlogRelations(f.pool, { id: 1 }, 90)).rejects.toThrow('synthetic_query_failure');
    }
    f.hide();
    expect((await readBlogRelations(f.pool, { id: 1 }, 90)).coverage.totalPosts).toBe(0);
  });
});
