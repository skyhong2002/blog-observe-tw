import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHARED_LABEL_CONTRACT } from './shared-label-contract.ts';
import { enrichTopicSharedLabels } from './shared-label-enrichment.ts';

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./shared-label-store.ts', () => ({ loadSharedLabelSnapshot: read }));
const pool = {} as Pool;
const detail = () => ({
  topic: { id: `tag:${'a'.repeat(64)}`, label: '美食', source: 'tag-vocabulary', excludedReason: null as string | null },
  articles: [{ id: 17, title: 'Synthetic public article' }],
  blogs: [{ id: 9 }],
  truncated: false,
});
const missing = {
  status: 'missing',
  fetchedAt: '2026-10-13T00:00:00.000Z',
  expiresAt: '2026-10-14T00:00:00.000Z',
  sourceContractSha: SHARED_LABEL_CONTRACT.sourceSHA,
  payloadVersion: null,
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  read.mockReset();
});

describe('optional shared labels on evidence-backed topic detail', () => {
  it('is off by default and accepts only exact true; disabled never reads local storage', async () => {
    for (const flag of [undefined, '', 'false', 'TRUE', '1']) {
      vi.stubEnv('BLOG_SHARED_LABELS_PUBLIC_ENABLED', flag);
      const original = detail();
      expect(await enrichTopicSharedLabels(pool, original)).toEqual({ ...original, sharedLabels: { status: 'not-enabled' } });
    }
    expect(read).not.toHaveBeenCalled();
  });
  it('does not enrich RSS, excluded topics or tags without blog evidence', async () => {
    for (const d of [
      { ...detail(), topic: null },
      { ...detail(), topic: { ...detail().topic, source: 'rss-category' } },
      { ...detail(), topic: { ...detail().topic, excludedReason: 'tag-noise' } },
      { ...detail(), articles: [], history: { total: 0 } },
    ])
      expect((await enrichTopicSharedLabels(pool, d, { enabled: true })).sharedLabels.status).toBe('not-enabled');
    expect(read).not.toHaveBeenCalled();
  });
  it('reads the exact label from local storage and preserves historical fallback with no recent articles', async () => {
    read.mockResolvedValue(missing);
    const now = new Date('2026-10-13T01:00:00Z');
    const original = { ...detail(), articles: [], history: { total: 3, articles: [{ id: 15 }] } };
    const result = await enrichTopicSharedLabels(pool, original, { enabled: true, now });
    expect(result.history).toBe(original.history);
    expect(result.blogs).toBe(original.blogs);
    expect(result.sharedLabels).toEqual({ status: 'enabled', source: 'https://tag.observe.tw', relations: missing, visual: missing });
    expect(read.mock.calls).toEqual([
      [pool, '美食', 'relations', now],
      [pool, '美食', 'visual', now],
    ]);
  });
  it('isolates each kind failure and does not leak storage error text', async () => {
    read.mockImplementation(async (_pool, _label, kind) => {
      if (kind === 'relations') throw Error('SQL private diagnostic');
      return missing;
    });
    const original = detail();
    const result = await enrichTopicSharedLabels(pool, original, { enabled: true });
    expect(result.articles).toBe(original.articles);
    expect(result.sharedLabels).toMatchObject({ status: 'enabled', relations: { status: 'unavailable' }, visual: missing });
    expect(JSON.stringify(result)).not.toContain('SQL private');
  });
  it('each request reads afresh and revoked evidence performs no metadata read', async () => {
    read.mockResolvedValue(missing);
    await Promise.all([
      enrichTopicSharedLabels(pool, detail(), { enabled: true }),
      enrichTopicSharedLabels(pool, detail(), { enabled: true }),
    ]);
    expect(read).toHaveBeenCalledTimes(4);
    const revoked = await enrichTopicSharedLabels(pool, { ...detail(), articles: [], history: { total: 0 } }, { enabled: true });
    expect(revoked.sharedLabels.status).toBe('not-enabled');
    expect(read).toHaveBeenCalledTimes(4);
  });
});
