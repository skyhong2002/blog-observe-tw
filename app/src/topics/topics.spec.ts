import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { blogContribution, digest, normalizeTerm, TopicMatcher, withinWindow } from './matcher.ts';
import { type ExportManifest, type ExportTerm, HttpSnapshotSource, SOURCE, validateManifest, validatePage } from './snapshot-client.ts';
import { importSnapshot, syncVocabulary } from './sync.ts';
import { TagArticleSource } from './tag-source.ts';
import { validateWindow } from './window-contract.ts';

const timestamp = '2026-10-12T00:00:00.000Z';
const makeTerm = (label: string): ExportTerm => ({
  id: digest(label),
  label,
  articleCount: 3,
  firstPublishedAt: timestamp,
  lastPublishedAt: timestamp,
  origin: 'article-tags-mixed',
  journalistAssigned: null,
});
function fixture(terms = [makeTerm('部落格')]) {
  const manifest: ExportManifest = {
    schemaVersion: 1,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    previousId: null,
    generatedAt: timestamp,
    source: SOURCE,
    attribution: '新文易數 tag.observe.tw',
    coverage: 'all-current-indexed-article-tags',
    provenance: 'mixed-native-edited-and-rule-derived; per-term assignment unknown',
    identity: 'sha256-exact-utf8-label',
    total: terms.length,
    pageSize: 500,
    pages: terms.length ? [digest(JSON.stringify(terms) + '\n')] : [],
    sha256: digest(terms.map((t) => JSON.stringify(t) + '\n').join('')),
    changeCount: 0,
    changePages: [],
  };
  return { manifest, page: { snapshot: manifest, entries: terms, cursor: '0', nextCursor: null, sha256: manifest.pages[0] } };
}
describe('literal bounded blog keyword matching', () => {
  it('normalizes width/Unicode and respects Latin word boundaries without excluding Chinese context', () => {
    const matcher = new TopicMatcher([
      { id: '1', label: 'ＡＩ' },
      { id: '2', label: '散步' },
      { id: '3', label: 'café' },
    ]);
    expect(matcher.match('台灣 AI 散步 café').ids.sort()).toEqual(['1', '2', '3']);
    expect(matcher.match('chair AIx xcafé').ids).toEqual([]);
    expect(matcher.match('ＡＩ散步').ids.sort()).toEqual(['1', '2']);
    expect(normalizeTerm('  ＡＩ\n 技術 ')).toBe('ai 技術');
  });
  it('follows failure outputs and never multiplies repeated mentions', () => {
    const matcher = new TopicMatcher([
      { id: 'a', label: '部落格' },
      { id: 'b', label: '格' },
      { id: 'c', label: '落格觀察' },
    ]);
    expect(matcher.match('部落格觀察 部落格').ids.sort()).toEqual(['a', 'b', 'c']);
  });
  it('bounds text and output to report partial extraction', () => {
    expect(
      new TopicMatcher([
        { id: 'x', label: '貓' },
        { id: 'y', label: '狗' },
      ]).match('貓狗', 1).truncated,
    ).toBe(true);
    expect(new TopicMatcher([]).match('x'.repeat(60001)).truncated).toBe(true);
  });
  it('uses distinct-post count per blog: incremental 1, .5, .25', () => {
    expect([1, 2, 3].map((n) => blogContribution(n))).toEqual([1, 1.5, 1.75]);
    expect(blogContribution(100)).toBeLessThanOrEqual(2);
  });
  it('uses publication time, excludes null/invalid/future, supports 7/30/90 days', () => {
    const now = new Date(timestamp);
    expect(withinWindow(null, 90, now)).toBe(false);
    expect(withinWindow('bad', 90, now)).toBe(false);
    expect(withinWindow(new Date(now.getTime() + 1), 90, now)).toBe(false);
    expect(withinWindow('2026-10-01T00:00:00Z', 7, now)).toBe(false);
    expect(withinWindow('2026-10-01T00:00:00Z', 30, now)).toBe(true);
  });
});
describe('published immutable export contract', () => {
  it('pins source, complete indexed tag coverage, term identity and page digest', () => {
    const { manifest, page } = fixture();
    expect(validateManifest(manifest)).toEqual(manifest);
    expect(validatePage(page, manifest, 0)).toEqual(page);
    expect(() => validateManifest({ ...manifest, coverage: 'editorial-dictionary' })).toThrow();
    expect(() => validateManifest({ ...manifest, source: 'https://evil.test' })).toThrow();
    expect(() => validatePage({ ...page, entries: [makeTerm('不同')] }, manifest, 0)).toThrow();
    expect(() => validatePage({ ...page, nextCursor: '1' }, manifest, 0)).toThrow();
  });
  it('rejects changed version/checksum, duplicate ordering and partial imports before any publication', async () => {
    const { manifest, page } = fixture();
    const pool = { getConnection: vi.fn() } as unknown as Pool;
    await expect(
      importSnapshot(
        pool,
        {
          current: async () => manifest,
          page: async () => ({ ...page, snapshot: { ...manifest, generatedAt: '2026-10-13T00:00:00.000Z' } }),
        },
        new Date(timestamp),
        async () => {},
      ),
    ).rejects.toThrow();
    expect(pool.getConnection).not.toHaveBeenCalled();
    const duplicate = fixture([makeTerm('貓'), makeTerm('貓')]);
    await expect(
      importSnapshot(
        pool,
        { current: async () => duplicate.manifest, page: async () => duplicate.page },
        new Date(timestamp),
        async () => {},
      ),
    ).rejects.toThrow('order or duplicate');
    await expect(
      importSnapshot(
        pool,
        {
          current: async () => ({ ...manifest, sha256: '0'.repeat(64) }),
          page: async () => ({ ...page, snapshot: { ...manifest, sha256: '0'.repeat(64) } }),
        },
        new Date(timestamp),
        async () => {},
      ),
    ).rejects.toThrow('full checksum');
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
  it('uses fixed public origin without credentials, rejects HTTP/oversize and redirects', async () => {
    const request = vi.fn<typeof fetch>(async () => new Response('missing', { status: 404 }));
    await expect(new HttpSnapshotSource(request).current()).rejects.toThrow('HTTP 404');
    expect(String(request.mock.calls[0][0])).toBe('http://127.0.0.1:18130/api/v1/vocabulary/snapshots/current');
    const options = request.mock.calls[0][1] as RequestInit;
    expect(options.redirect).toBe('error');
    expect(options.headers).not.toHaveProperty('Authorization');
    await expect(new HttpSnapshotSource(async () => new Response('x'.repeat(2_000_001))).current()).rejects.toThrow('byte cap');
  });
});
describe('window vocabulary public article API', () => {
  const window = { since: '2026-10-05T00:00:00.000Z', until: timestamp };
  const article = { id: 25, media: 'blog-source', publishedAt: '2026-10-11T00:00:00.000Z', tags: ['旅行', 'AI'] };
  const page = { query: window, articles: [article], nextCursor: null };
  it('validates pinned 31-day max window and timezone', () => {
    expect(() => validateWindow(window)).not.toThrow();
    expect(() => validateWindow({ since: '2026-01-01T00:00:00Z', until: timestamp })).toThrow();
    expect(() => validateWindow({ since: '2026-10-01', until: timestamp })).toThrow();
  });
  it('fetches only official public contract, validates tags and cursor order', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json(page));
    const source = new TagArticleSource(request);
    expect(await source.page(window, null)).toMatchObject({ articles: [{ ...article, id: '25' }], nextCursor: null });
    const url = request.mock.calls[0][0] as URL;
    expect(url.origin).toBe('http://127.0.0.1:18130');
    expect(url.pathname).toBe('/api/v1/articles');
    expect(url.searchParams.get('limit')).toBe('200');
    expect((request.mock.calls[0][1] as RequestInit).redirect).toBe('error');
    await expect(new TagArticleSource(async () => Response.json({ ...page, nextCursor: '1_25' })).page(window, null)).rejects.toThrow(
      'continuation',
    );
    await expect(
      new TagArticleSource(async () => Response.json({ ...page, query: { ...window, until: '2026-10-13T00:00:00Z' } })).page(window, null),
    ).rejects.toThrow('window');
    await expect(
      new TagArticleSource(async () => Response.json({ ...page, articles: [{ ...article, publishedAt: timestamp }] })).page(window, null),
    ).rejects.toThrow('outside');
    expect(
      (
        await new TagArticleSource(async () => Response.json({ ...page, articles: [{ ...article, tags: ['旅行', 'bad\u0000tag'] }] })).page(
          window,
          null,
        )
      ).articles[0],
    ).toMatchObject({ tags: ['旅行'], invalidTagCount: 1 });
  });
  it('accepts real-world boundary zero-width spacing while retaining source labels and rejecting embedded controls', async () => {
    const rawTags = ['\u200B洛杉磯道奇', ' 旅行\uFEFF', '公益代言人\u2060'];
    const source = new TagArticleSource(async () => Response.json({ ...page, articles: [{ ...article, tags: rawTags }] }));
    expect((await source.page(window, null)).articles[0]).toMatchObject({
      tags: ['洛杉磯道奇', '旅行', '公益代言人'],
      rawTags,
      tagNormalization: 'boundary-whitespace-format-skip-invalid-v2',
    });
    for (const tags of [['洛\u200B杉磯'], ['\u200B'], [42], ['bad\u0000tag']]) {
      expect(
        (await new TagArticleSource(async () => Response.json({ ...page, articles: [{ ...article, tags }] })).page(window, null))
          .articles[0],
      ).toMatchObject({ tags: [], invalidTagCount: 1 });
    }
  });
  it('default disabled sync makes zero network or database writes', async () => {
    const pool = { getConnection: vi.fn(), query: vi.fn() } as unknown as Pool;
    expect(await syncVocabulary(pool, { enabled: false })).toEqual({ status: 'disabled' });
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
});

describe('bounded synchronization recovery', () => {
  it('does not fetch or publish a snapshot after an abort or expired deadline', async () => {
    const { manifest, page } = fixture();
    const current = vi.fn(async () => manifest);
    const source = { current, page: async () => page };
    const pool = { getConnection: vi.fn() } as unknown as Pool;
    await expect(importSnapshot(pool, source, new Date(timestamp), async () => {}, 500, { deadline: Date.now() - 1 })).rejects.toThrow(
      'deadline',
    );
    const controller = new AbortController();
    controller.abort();
    await expect(importSnapshot(pool, source, new Date(timestamp), async () => {}, 500, { signal: controller.signal })).rejects.toThrow();
    expect(current).not.toHaveBeenCalled();
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
  it('marks a permanently capped run terminal instead of retrying it forever', async () => {
    const now = new Date(timestamp);
    const execute = vi.fn(async () => [{}]);
    const connection = {
      query: async (sql: string) => (sql.includes('RELEASE_LOCK') ? [[{ released: 1 }]] : [[{ held: 1 }]]),
      release: () => {},
      destroy: () => {},
    };
    const pool = {
      getConnection: async () => connection,
      execute,
      query: async () => [
        [{ id: 'capped-run', since_at: '2026-10-11T00:00:00.000Z', until_at: timestamp, cursor: '100_1', pages: 1000, status: 'scanning' }],
      ],
    } as unknown as Pool;
    const result = await syncVocabulary(pool, { enabled: true, now: () => now });
    expect(result).toMatchObject({ status: 'capped', reason: 'cap-pages', version: 'capped-run' });
    expect(execute.mock.calls[0]).toEqual([
      'UPDATE topic_window_runs SET status=?,updated_at=? WHERE id=?',
      ['cap-pages', now, 'capped-run'],
    ]);
  });
});
