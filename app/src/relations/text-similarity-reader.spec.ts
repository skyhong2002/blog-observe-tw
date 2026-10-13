import { createHash } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTextSimilarity } from './text-similarity-reader.ts';

const body = '先把蛤蜊洗淨，再將絲瓜削皮切塊，放入鍋中煮熟。一家人分享這道家常菜，湯汁鮮甜，餐桌旁談起旅行與日常生活。'.repeat(3);
const row = (id: number) => ({
  id,
  blogId: id === 1 ? 5 : 6,
  url: `https://site${id}.example/post`,
  title: '文章',
  summary: '<p>公開 RSS 摘要：蛤蜊絲瓜</p><script>PRIVATE_SCRIPT</script>',
  publishedAt: new Date('2026-01-01'),
  blogUrl: `https://site${id}.example/`,
  sourceUrl: `https://site${id}.example/feed`,
  articleUrl: `https://site${id}.example/post`,
  contentHash: 'c'.repeat(64),
  observedAt: new Date('2026-01-02'),
  bodyBytes: Buffer.from(body),
});
const current = (r: ReturnType<typeof row>) => ({ ...r, bodyTextHash: createHash('sha256').update(r.bodyBytes).digest('hex') });
const selection = { pairs: [{ sourceArticleId: 1, targetArticleId: 2 }] };
function fixture() {
  const rows = [row(1), row(2)];
  const connection = {
    query: vi
      .fn()
      .mockResolvedValueOnce([rows])
      .mockResolvedValueOnce([rows.map(current)]),
    destroy: vi.fn(),
    release: vi.fn(),
  };
  const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;
  return { rows, connection, pool };
}
afterEach(() => vi.useRealTimers());
describe('read-only fresh public evidence forexplicitpairs', () => {
  it('defaults off and readsnothing regardless pairvalue', async () => {
    const f = fixture();
    expect(await loadTextSimilarity(f.pool, selection)).toEqual({ status: 'not-enabled' });
    expect(f.pool.getConnection).not.toHaveBeenCalled();
  });
  it('returns body-prefix context and actual provenance, without any private hash/body', async () => {
    const f = fixture();
    const r = await loadTextSimilarity(f.pool, selection, { enabled: true });
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.items[0]).toMatchObject({
      status: 'ready',
      lexicalSimilarity: 1,
      source: {
        articleId: 1,
        contextSource: 'post-summary',
        previewSource: 'post-summary',
        comparedContextSource: 'body-prefix',
        observedAt: '2026-01-02T00:00:00.000Z',
      },
      target: { articleId: 2 },
    });
    for (const secret of ['contentHash', 'textHash', 'bodyTextHash', 'bodyBytes', 'normalizedPrefix', 'sourceUrl', 'blogUrl'])
      expect(JSON.stringify(r)).not.toContain(secret);
    expect(f.connection.query).toHaveBeenCalledTimes(2);
    expect(f.connection.release).toHaveBeenCalledTimes(1);
    for (const [spec] of f.connection.query.mock.calls) {
      expect(spec.sql.startsWith('SET STATEMENT max_statement_time=0.25 FOR SELECT')).toBe(true);
      expect(spec.values).toEqual([[1, 2]]);
      expect(spec.sql).not.toContain('LIKE');
    }
  });
  it.each(['hidden', 'rejected', 'moved', 'future', 'deleted', 'non-ok', 'owner-changed'])(
    'missing fresh row after %s isunavailable not0percent',
    async () => {
      const f = fixture();
      f.connection.query
        .mockReset()
        .mockResolvedValueOnce([f.rows])
        .mockResolvedValueOnce([[current(f.rows[0])]]);
      const r = await loadTextSimilarity(f.pool, selection, { enabled: true });
      expect(r.status === 'ready' && r.items[0]).toMatchObject({ status: 'unavailable', lexicalSimilarity: null });
    },
  );
  it.each(['summary', 'title', 'contentHash', 'bodyTextHash', 'url', 'sourceUrl', 'articleUrl', 'blogUrl', 'blogId'])(
    'fresh %s change invalidates pair without leakinghash',
    async (field) => {
      const f = fixture();
      const next = f.rows.map(current);
      (next[1] as Record<string, unknown>)[field] = field === 'blogId' ? 99 : 'changed';
      f.connection.query.mockReset().mockResolvedValueOnce([f.rows]).mockResolvedValueOnce([next]);
      const r = await loadTextSimilarity(f.pool, selection, { enabled: true });
      expect(r.status === 'ready' && r.items[0]).toMatchObject({ status: 'unavailable', lexicalSimilarity: null });
    },
  );
  it('initial wrong URLowner, invalidUTF8 andovercap each yieldunavailable but neverabort others', async () => {
    for (const patch of [
      { sourceUrl: 'https://private.example/post' },
      { bodyBytes: Buffer.from([0xc3, 0x28]) },
      { bodyBytes: Buffer.alloc(65537) },
    ]) {
      const f = fixture();
      Object.assign(f.rows[1], patch);
      f.connection.query
        .mockReset()
        .mockResolvedValueOnce([f.rows])
        .mockResolvedValueOnce([f.rows.map(current)]);
      const r = await loadTextSimilarity(f.pool, selection, { enabled: true });
      expect(r.status === 'ready' && r.items[0]).toMatchObject({ status: 'unavailable', lexicalSimilarity: null });
    }
  });
  it('enforces caller sourceblog scope without pretending a foreignsourcepair wascompared', async () => {
    const f = fixture();
    const r = await loadTextSimilarity(f.pool, { ...selection, sourceBlogId: 99 }, { enabled: true });
    expect(r.status === 'ready' && r.items[0]).toMatchObject({ status: 'unavailable', lexicalSimilarity: null });
  });
  it('each request rereads; SQL errors reject rather than return emptyor0', async () => {
    const f = fixture();
    f.connection.query.mockReset().mockRejectedValueOnce({ code: 'ER_STATEMENT_TIMEOUT' });
    await expect(loadTextSimilarity(f.pool, selection, { enabled: true })).rejects.toThrow('text_similarity_unavailable');
    expect(f.connection.destroy).toHaveBeenCalledTimes(1);
    expect(f.connection.release).not.toHaveBeenCalled();
  });
  it('retains two pending acquisition admissions aftertimeout and destroys lateconnections', async () => {
    vi.useFakeTimers();
    const resolves: Array<(connection: unknown) => void> = [];
    const f = fixture();
    f.pool.getConnection = vi.fn(() => new Promise((r) => resolves.push(r))) as never;
    const a = loadTextSimilarity(f.pool, selection, { enabled: true }),
      b = loadTextSimilarity(f.pool, selection, { enabled: true });
    const ea = expect(a).rejects.toThrow(),
      eb = expect(b).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1501);
    await Promise.all([ea, eb]);
    await expect(loadTextSimilarity(f.pool, selection, { enabled: true })).rejects.toThrow('text_similarity_unavailable');
    expect(f.pool.getConnection).toHaveBeenCalledTimes(2);
    const second = fixture();
    resolves[0](f.connection);
    resolves[1](second.connection);
    await Promise.resolve();
    await Promise.resolve();
    expect(f.connection.destroy).toHaveBeenCalledTimes(1);
    expect(second.connection.destroy).toHaveBeenCalledTimes(1);
    expect(f.connection.query).not.toHaveBeenCalled();
  });
  it('same-publication evidence is unavailable rather than a cross-blog relationship score', async () => {
    const f = fixture();
    Object.assign(f.rows[1], {
      blogId: 5,
      blogUrl: 'https://site1.example/',
      url: 'https://site1.example/post2',
      sourceUrl: 'https://site1.example/feed',
      articleUrl: 'https://site1.example/post2',
    });
    f.connection.query
      .mockReset()
      .mockResolvedValueOnce([f.rows])
      .mockResolvedValueOnce([f.rows.map(current)]);
    const r = await loadTextSimilarity(f.pool, selection, { enabled: true });
    expect(r.status === 'ready' && r.items[0]).toMatchObject({
      status: 'unavailable',
      reason: 'same-publication',
      lexicalSimilarity: null,
    });
  });
  it('private body prefix is never public even for insufficient-text; only sanitized RSS summary is previewed', async () => {
    for (const text of ['PRIVATE_PREFIX_MARKER ' + body, 'PRIVATE_PREFIX_MARKER']) {
      const f = fixture();
      f.rows.forEach((r) => {
        r.bodyBytes = Buffer.from(text);
      });
      f.connection.query
        .mockReset()
        .mockResolvedValueOnce([f.rows])
        .mockResolvedValueOnce([f.rows.map(current)]);
      const result = await loadTextSimilarity(f.pool, selection, { enabled: true });
      expect(JSON.stringify(result)).not.toContain('PRIVATE_PREFIX_MARKER');
      expect(JSON.stringify(result)).not.toContain('PRIVATE_SCRIPT');
      expect(result.status === 'ready' && result.items[0]).toMatchObject({
        source: { excerpt: '公開 RSS 摘要：蛤蜊絲瓜', previewSource: 'post-summary', comparedContextSource: 'body-prefix' },
      });
    }
  });
  it('BOM bytes are included in internal integrity hash even though TextDecoder removes it from comparison text', async () => {
    const f = fixture();
    f.rows.forEach((r) => {
      r.bodyBytes = Buffer.from('\ufeff' + body);
    });
    f.connection.query
      .mockReset()
      .mockResolvedValueOnce([f.rows])
      .mockResolvedValueOnce([f.rows.map(current)]);
    const result = await loadTextSimilarity(f.pool, selection, { enabled: true });
    expect(result.status === 'ready' && result.items[0]).toMatchObject({ status: 'ready', lexicalSimilarity: 1 });
  });
  it('null summary is empty preview, never replaced by private body prefix', async () => {
    const f = fixture();
    f.rows.forEach((r) => {
      Object.assign(r, { summary: null });
    });
    f.connection.query
      .mockReset()
      .mockResolvedValueOnce([f.rows])
      .mockResolvedValueOnce([f.rows.map(current)]);
    const result = await loadTextSimilarity(f.pool, selection, { enabled: true });
    expect(result.status === 'ready' && result.items[0]).toMatchObject({
      source: { excerpt: '', previewSource: 'post-summary' },
      target: { excerpt: '' },
    });
  });
  it('unavailable and same-publication projections never copy extra pair fields', async () => {
    for (const samePublication of [false, true]) {
      const f = fixture();
      if (samePublication) {
        Object.assign(f.rows[1], {
          blogId: 5,
          blogUrl: 'https://site1.example/',
          url: 'https://site1.example/post2',
          sourceUrl: 'https://site1.example/feed',
          articleUrl: 'https://site1.example/post2',
        });
      }
      f.connection.query
        .mockReset()
        .mockResolvedValueOnce([f.rows])
        .mockResolvedValueOnce([samePublication ? f.rows.map(current) : []]);
      const result = await loadTextSimilarity(
        f.pool,
        { pairs: [{ sourceArticleId: 1, targetArticleId: 2, extraSecret: 'PRIVATE_EXTRA_SECRET' }] } as unknown as typeof selection,
        { enabled: true },
      );
      expect(JSON.stringify(result)).not.toContain('PRIVATE_EXTRA_SECRET');
      expect(JSON.stringify(result)).not.toContain('extraSecret');
      expect(result.status === 'ready' && result.items[0]).toMatchObject({
        sourceArticleId: 1,
        targetArticleId: 2,
        status: 'unavailable',
        lexicalSimilarity: null,
      });
    }
  });
});
