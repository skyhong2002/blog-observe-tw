import { createHash } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import {
  BODY_INDEX_BYTES,
  BODY_INDEX_CHARACTERS,
  BODY_INDEX_VERSION,
  bodySearchOwner,
  buildBodySearchIndex,
  loadIndexedBodySearch,
} from './search-body-index.ts';

const phrase = '蛤蜊絲瓜';
const row = (text = `前文${phrase}很鮮甜`) => ({
  id: 20875,
  title: '一般標題',
  url: 'https://anise.tw/290726',
  blogUrl: 'https://anise.tw/',
  articleUrl: 'https://anise.tw/290726',
  sourceUrl: 'https://anise.tw/290726',
  bodyBytes: Buffer.from(text),
  bodyTextHash: createHash('sha256').update(text).digest('hex'),
});
function mock(rows: unknown[], number = 1) {
  const query = vi
    .fn()
    .mockResolvedValueOnce([Array.from({ length: number }, (_, i) => ({ post_id: 20875 + i }))])
    .mockResolvedValueOnce([rows]);
  return { pool: { query } as unknown as Pool, query };
}
describe('bounded body prefix candidate index', () => {
  it('normalizes producer and verifier identically for fullwidth/case/combining text', async () => {
    const raw = '前文ＡＢＣ e\u0301 後文';
    const built = buildBodySearchIndex(raw);
    expect(built.status === 'ready' && built.normalizedPrefix).toContain('abc é');
    const f = mock([row(raw)]);
    expect((await loadIndexedBodySearch(f.pool, 'ABC')).items[0]).toMatchObject({
      articleId: 20875,
      matchSource: 'body',
      contextSource: 'body',
      matchVersion: BODY_INDEX_VERSION,
    });
  });
  it('limits bytes before normalization and rejects malformed surrogate input', () => {
    expect(buildBodySearchIndex('a'.repeat(BODY_INDEX_BYTES + 1)).status).toBe('overcap');
    expect(buildBodySearchIndex('\ud800').status).toBe('overcap');
    expect(buildBodySearchIndex('蛤'.repeat(Math.floor(BODY_INDEX_BYTES / 3) + 1)).status).toBe('overcap');
  });
  it('caps normalized codepoints and never indexes beyond the prefix', () => {
    const x = buildBodySearchIndex('甲'.repeat(BODY_INDEX_CHARACTERS) + phrase);
    expect(x.status).toBe('ready');
    if (x.status === 'ready') {
      expect(x.truncated).toBe(true);
      expect(x.prefixCharacters).toBe(BODY_INDEX_CHARACTERS);
      expect(x.grams).toHaveLength(1);
    }
  });
  it('matches the full literal needle, not a posting gram false positive', async () => {
    const f = mock([row('蛤蜊絲和不同的瓜')]);
    expect((await loadIndexedBodySearch(f.pool, phrase)).items).toEqual([]);
  });
  it('keeps older ID20875 independent of metadata cohort and projects no private body/hash', async () => {
    const f = mock([row()]);
    const result = await loadIndexedBodySearch(f.pool, phrase);
    expect(result.items[0].articleId).toBe(20875);
    expect(result.items[0].snippet).toContain(phrase);
    for (const secret of ['bodyBytes', 'bodyTextHash', 'blogUrl', 'articleUrl', 'sourceUrl'])
      expect(JSON.stringify(result)).not.toContain(secret);
    expect(f.query.mock.calls[0][0]).not.toContain('LIKE');
    expect(f.query.mock.calls[1][1][2]).toEqual([20875]);
  });
  it('refuses current raw text with a stale hash even if content revision was not updated', async () => {
    const r = row();
    r.bodyTextHash = '0'.repeat(64);
    const f = mock([r]);
    const result = await loadIndexedBodySearch(f.pool, phrase);
    expect(result.items).toEqual([]);
    expect(result.coverage.staleOrIneligible).toBe(1);
  });
  it('reports SQL-filtered withdrawn/deleted/future/owner/revision rows as ineligible rather than exhaustive no-match', async () => {
    const f = mock([]);
    const result = await loadIndexedBodySearch(f.pool, phrase);
    expect(result.coverage).toMatchObject({ status: 'partial', exhaustive: false, staleOrIneligible: 1, unindexed: 'unknown' });
  });
  it('rechecks original source URLs before exposing a hit', async () => {
    const r = row();
    r.sourceUrl = 'https://private.example/article';
    const f = mock([r]);
    expect((await loadIndexedBodySearch(f.pool, phrase)).items).toEqual([]);
    expect(bodySearchOwner('https://anise.tw/blogger/x', 'https://anise.tw/blog/')).toBe(false);
  });
  it('never verifies more than200 rows after a201 sentinel and reports cap', async () => {
    const f = mock([], 201);
    const result = await loadIndexedBodySearch(f.pool, phrase);
    expect(result.coverage).toMatchObject({ candidates: 200, candidateTruncated: true });
    expect(f.query.mock.calls[1][1][2]).toHaveLength(200);
  });
  it('short queries issue zero SQL and explicitly do not support body search', async () => {
    const f = mock([]);
    expect((await loadIndexedBodySearch(f.pool, '湯')).coverage.status).toBe('short-query');
    expect(f.query).not.toHaveBeenCalled();
  });
  it('absent schema returns explicit unavailable, never globalLIKE fallback', async () => {
    const query = vi.fn().mockRejectedValue({ code: 'ER_NO_SUCH_TABLE' });
    expect((await loadIndexedBodySearch({ query } as unknown as Pool, phrase)).coverage.status).toBe('unavailable');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('timeout propagates instead of returning fake empty', async () => {
    const query = vi.fn().mockRejectedValue({ code: 'ER_STATEMENT_TIMEOUT' });
    await expect(loadIndexedBodySearch({ query } as unknown as Pool, phrase)).rejects.toMatchObject({ code: 'ER_STATEMENT_TIMEOUT' });
  });
  it('large mutated body is overcap even if old posting exists', async () => {
    const f = mock([row('a'.repeat(BODY_INDEX_BYTES + 1))]);
    const r = await loadIndexedBodySearch(f.pool, phrase);
    expect(r.items).toEqual([]);
    expect(r.coverage.overcap).toBe(1);
  });
  it('one invalid UTF8 candidate is skipped without losing the other valid hit', async () => {
    const invalid = { ...row(), id: 20876, bodyBytes: Buffer.from([0xc3, 0x28]) };
    const f = mock([invalid, row()], 2);
    const result = await loadIndexedBodySearch(f.pool, phrase);
    expect(result.items.map((item) => item.articleId)).toEqual([20875]);
    expect(result.coverage.invalidUtf8).toBe(1);
  });
});
