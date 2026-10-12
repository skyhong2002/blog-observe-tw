import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import type { BlogrollObservation, DiscoveryPage } from './blogroll-contract.ts';
import { createBlogrollStore } from './blogroll-store.ts';

const NOW = '2026-10-12T07:00:00.000Z';
const observation = (sourceUrl = 'https://writer.test/blogroll'): BlogrollObservation => ({
  rootUrl: 'https://blogblog.club/blogrollroll',
  sourceUrl,
  targetUrl: 'https://new-writer.test/',
  anchorText: '新作者',
  relation: 'blogroll',
  path: ['https://blogblog.club/blogrollroll', sourceUrl, 'https://new-writer.test/'],
  bodySha256: 'a'.repeat(64),
  observedAt: NOW,
});
const page = (): DiscoveryPage => ({
  url: 'https://writer.test/links',
  finalUrl: 'https://writer.test/blogroll',
  parserVersion: 1,
  kind: 'blogroll',
  etag: 'page-v1',
  lastModified: 'Mon, 12 Oct 2026 07:00:00 GMT',
  bodySha256: 'a'.repeat(64),
  links: [{ url: 'https://new-writer.test/', text: '新作者', follow: false }],
  fetchedAt: NOW,
});
type Row = Record<string, unknown>;
function harness(
  options: {
    status?: string;
    prior?: Row;
    failEdge?: boolean;
    candidateError?: string;
    acquire?: number;
    failRelease?: boolean;
    leaseHeld?: number;
    failLeaseCheck?: boolean;
  } = {},
) {
  let candidates = new Map<string, Row>();
  let edges = new Map<string, Row>();
  const pages = new Map<string, Row>();
  const key = (url: unknown) => `${url}|blogblog-club`;
  if (options.status)
    candidates.set(key(observation().targetUrl), {
      id: 5,
      status: options.status,
      source_type: 'blogblog-club',
      source_evidence: options.prior || {},
    });
  const merge = (left: Row, right: Row): Row => {
    const merged = { ...left };
    for (const [field, value] of Object.entries(right)) {
      merged[field] =
        value && typeof value === 'object' && !Array.isArray(value) && merged[field] && typeof merged[field] === 'object'
          ? merge(merged[field] as Row, value as Row)
          : value;
    }
    return merged;
  };
  const connections: Array<ReturnType<typeof connection>> = [];
  function connection() {
    let before: { candidates: Map<string, Row>; edges: Map<string, Row> } | null = null;
    return {
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes('GET_LOCK')) return [[{ acquired: options.acquire ?? 1 }], []];
        if (sql.includes('IS_USED_LOCK')) {
          if (options.failLeaseCheck) throw new Error('lease connection lost');
          return [[{ held: options.leaseHeld ?? 1 }], []];
        }
        if (sql.includes('RELEASE_LOCK')) {
          if (options.failRelease) throw new Error('release network failure');
          return [[{ released: 1 }], []];
        }
        if (sql.includes('FROM discovery_candidates')) return [[candidates.get(key(values[0]))].filter(Boolean), []];
        throw new Error(`unexpected connection query ${sql}`);
      }),
      execute: vi.fn(async (sql: string, values: unknown[]) => {
        if (sql.startsWith('INSERT INTO discovery_candidates')) {
          if (options.candidateError) throw Object.assign(new Error('candidate insert failed'), { code: options.candidateError });
          const k = key(values[0]);
          if (candidates.has(k)) throw Object.assign(new Error('candidate already exists'), { code: 'ER_DUP_ENTRY' });
          candidates.set(k, {
            id: 10,
            url: values[0],
            name: values[1],
            status: 'candidate',
            source_type: 'blogblog-club',
            source_url: values[2],
            source_evidence: JSON.parse(String(values[3])),
          });
          return [{ affectedRows: 1 }, []];
        }
        if (sql.startsWith('UPDATE discovery_candidates')) {
          const row = [...candidates.values()].find((c) => c.id === values[1]);
          if (row?.status === 'candidate' && row.source_type === 'blogblog-club')
            row.source_evidence = merge(row.source_evidence as Row, JSON.parse(String(values[0])));
          return [{ affectedRows: 1 }, []];
        }
        if (sql.includes('INSERT INTO discovery_edges')) {
          if (options.failEdge) throw new Error('simulated edge insert failure');
          const old = edges.get(String(values[0]));
          edges.set(String(values[0]), {
            edge_sha256: values[0],
            root_url: values[1],
            source_url: values[2],
            target_url: values[3],
            path: values[4],
            anchor_text: values[5],
            relation: values[6],
            body_sha256: values[7],
            first_seen_at: old?.first_seen_at || values[8],
            last_seen_at: values[9],
          });
          return [{ affectedRows: old ? 2 : 1 }, []];
        }
        throw new Error(`unexpected connection execute ${sql}`);
      }),
      beginTransaction: vi.fn(async () => {
        before = { candidates: structuredClone(candidates), edges: structuredClone(edges) };
      }),
      commit: vi.fn(async () => {
        before = null;
      }),
      rollback: vi.fn(async () => {
        if (before) {
          candidates = before.candidates;
          edges = before.edges;
        }
      }),
      release: vi.fn(),
      destroy: vi.fn(),
    };
  }
  const pool = {
    pool: { config: { connectionLimit: 2 } },
    getConnection: vi.fn(async () => {
      const result = connection();
      connections.push(result);
      return result;
    }),
    query: vi.fn(async (_sql: string, values: unknown[]) => [[pages.get(String(values[0]))].filter(Boolean), []]),
    execute: vi.fn(async (_sql: string, values: unknown[]) => {
      pages.set(String(values[0]), {
        url: values[1],
        final_url: values[2],
        parser_version: values[3],
        kind: values[4],
        etag: values[5],
        last_modified: values[6],
        body_sha256: values[7],
        links: values[8],
        fetched_at: values[9],
      });
      return [{ affectedRows: 1 }, []];
    }),
  };
  return {
    pool,
    store: createBlogrollStore(pool as unknown as Pool),
    connections,
    candidates: () => candidates,
    edges: () => edges,
    pages,
  };
}

describe('blogroll cache and observation persistence', () => {
  it('round-trips parser version, page kind, redirects, validators, and parsed links without raw HTML', async () => {
    const h = harness();
    expect(await h.store.getPage(page().url)).toBeNull();
    await h.store.savePage(page());
    expect(await h.store.getPage(page().url)).toEqual(page());
    const row = [...h.pages.values()][0];
    expect(Object.keys(row)).not.toContain('html');
    row.links = '{corrupt json';
    expect(await h.store.getPage(page().url)).toBeNull();
  });

  it('enforces cache URL, link count/text, and serialized byte limits before SQL', async () => {
    const h = harness();
    await expect(h.store.savePage({ ...page(), url: 'http://127.0.0.1/private' })).rejects.toThrow('invalid discovery page');
    await expect(h.store.savePage({ ...page(), links: Array.from({ length: 1001 }, () => page().links[0]) })).rejects.toThrow(
      'invalid discovery page',
    );
    await expect(h.store.savePage({ ...page(), links: [{ ...page().links[0], text: '😀'.repeat(161) }] })).rejects.toThrow(
      'invalid discovery page',
    );
    const longLinks = Array.from({ length: 1000 }, (_, i) => ({
      url: `https://writer.test/${i}/${'x'.repeat(900)}`,
      text: '',
      follow: false,
    }));
    await expect(h.store.savePage({ ...page(), links: longLinks })).rejects.toThrow('invalid discovery page');
    expect(h.pool.execute).not.toHaveBeenCalled();
  });

  it('atomically inserts a candidate and multiple distinct root/source/target edges', async () => {
    const h = harness();
    expect(await h.store.observe(observation())).toEqual({ inserted: true });
    expect(await h.store.observe(observation('https://other-writer.test/blogroll'))).toEqual({ inserted: false });
    expect(h.candidates().size).toBe(1);
    expect(h.edges().size).toBe(2);
    for (const edge of h.edges().values()) expect(String(edge.edge_sha256)).toMatch(/^[a-f0-9]{64}$/);
    const candidate = [...h.candidates().values()][0];
    expect(candidate.status).toBe('candidate');
    expect((candidate.source_evidence as Row).rssDetection).toBe('pending');
    expect((candidate.source_evidence as Row).blogrollRelationship).toMatchObject({
      from: observation().sourceUrl,
      to: observation().targetUrl,
      status: 'observed-link',
    });
  });

  it.each(['approved', 'rejected'])('records an edge without changing existing %s candidate status or evidence', async (status) => {
    const original = { manualNote: 'Keep this decision', rssDetection: 'manually-verified' };
    const h = harness({ status, prior: original });
    await h.store.observe(observation());
    const candidate = [...h.candidates().values()][0];
    expect(candidate.status).toBe(status);
    expect(candidate.source_evidence).toEqual(original);
    expect(h.edges().size).toBe(1);
    expect(h.connections[0].execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE discovery_candidates'))).toBe(false);
  });

  it('enriches legacy crawler paths while preserving manual fields and completed RSS evidence', async () => {
    const h = harness({
      status: 'candidate',
      prior: {
        fingerprint: 'c'.repeat(64),
        blogrollRelationship: { status: 'pending-human-confirmation', from: null, to: observation().targetUrl, reviewerNote: 'retain' },
        discoveryPath: 'legacy',
        manualNote: 'retain',
        rssDetection: 'confirmed-by-editor',
      },
    });
    await h.store.observe(observation());
    const evidence = [...h.candidates().values()][0].source_evidence as Row;
    expect(evidence.discoveryPath).toBe(observation().path.join(' -> '));
    expect(evidence.blogrollRelationship).toMatchObject({ status: 'observed-link', from: observation().sourceUrl, reviewerNote: 'retain' });
    expect(evidence.manualNote).toBe('retain');
    expect(evidence.rssDetection).toBe('confirmed-by-editor');
  });

  it('preserves modern manual overrides and keeps fresh observation in a crawler-only field', async () => {
    const h = harness({
      status: 'candidate',
      prior: { discoveryPath: 'editor path', blogrollRelationship: { status: 'editor-confirmed', from: 'editor source' } },
    });
    await h.store.observe(observation());
    const evidence = [...h.candidates().values()][0].source_evidence as Row;
    expect(evidence.discoveryPath).toBe('editor path');
    expect(evidence.blogrollRelationship).toEqual({ status: 'editor-confirmed', from: 'editor source' });
    expect(evidence.crawlerObservation).toMatchObject({ discoveryPath: observation().path.join(' -> ') });
  });

  it('rolls candidate insertion back if edge persistence fails', async () => {
    const h = harness({ failEdge: true });
    await expect(h.store.observe(observation())).rejects.toThrow('simulated edge insert failure');
    expect(h.candidates().size).toBe(0);
    expect(h.edges().size).toBe(0);
    expect(h.connections[0].rollback).toHaveBeenCalledOnce();
    expect(h.connections[0].commit).not.toHaveBeenCalled();
    expect(h.connections[0].release).toHaveBeenCalledOnce();
  });

  it('rejects malformed provenance paths before opening a transaction', async () => {
    const h = harness();
    await expect(h.store.observe({ ...observation(), path: [observation().rootUrl, 'https://different.test/'] })).rejects.toThrow(
      'invalid blogroll observation',
    );
    expect(h.pool.getConnection).not.toHaveBeenCalled();
  });
});

describe('blogroll cross-process lease', () => {
  it('uses a dedicated connection for the lease and another for transactional observations', async () => {
    const h = harness();
    expect(await h.store.acquire()).toBe(true);
    expect(await h.store.acquire()).toBe(false);
    await h.store.savePage(page());
    await h.store.getPage(page().url);
    await h.store.observe(observation());
    expect(h.connections).toHaveLength(2);
    expect(h.connections[0].query.mock.calls[0][0]).toContain('GET_LOCK');
    expect(h.connections[0].query.mock.calls[0][1]).toEqual(['blog_observe:blogblog-discovery']);
    expect(h.connections[0].execute).not.toHaveBeenCalled();
    expect(h.connections[1].beginTransaction).toHaveBeenCalledOnce();
    await h.store.release();
    expect(h.connections[0].query.mock.calls[1][0]).toContain('RELEASE_LOCK');
    expect(h.connections[0].release).toHaveBeenCalledOnce();
    await h.store.release();
    expect(h.connections[0].release).toHaveBeenCalledOnce();
  });

  it('releases a denied lease and prevents simultaneous acquire calls from leaking sessions', async () => {
    const denied = harness({ acquire: 0 });
    expect(await denied.store.acquire()).toBe(false);
    expect(denied.connections[0].release).toHaveBeenCalledOnce();
    const h = harness();
    expect(await Promise.all([h.store.acquire(), h.store.acquire()])).toEqual([true, false]);
    expect(h.connections).toHaveLength(1);
    await h.store.release();
  });

  it('destroys a lock-owning connection instead of returning it to the pool after release failure', async () => {
    const h = harness({ failRelease: true });
    await h.store.acquire();
    await expect(h.store.release()).rejects.toThrow('release network failure');
    expect(h.connections[0].destroy).toHaveBeenCalledOnce();
    expect(h.connections[0].release).not.toHaveBeenCalled();
  });

  it('fails fast for a single-connection pool', () => {
    expect(() => createBlogrollStore({ pool: { config: { connectionLimit: 1 } } } as unknown as Pool)).toThrow('poolSize >= 2');
  });
});

describe('complete blogroll paths and live lease verification', () => {
  it('retains distinct paths to the same root/source/target relationship', async () => {
    const h = harness();
    const first = observation();
    const second = { ...first, path: [first.rootUrl, 'https://intermediate.test/roll', first.sourceUrl, first.targetUrl] };
    await h.store.observe(first);
    await h.store.observe(second);
    expect(h.candidates().size).toBe(1);
    expect(h.edges().size).toBe(2);
    expect(new Set([...h.edges().values()].map((row) => row.path)).size).toBe(2);
  });

  it('requires the observed source to immediately precede the target in the path', async () => {
    const h = harness();
    const item = observation();
    await expect(
      h.store.observe({ ...item, path: [item.rootUrl, item.sourceUrl, 'https://different-source.test/', item.targetUrl] }),
    ).rejects.toThrow('invalid blogroll observation');
    expect(h.pool.getConnection).not.toHaveBeenCalled();
  });

  it('checks ownership on the dedicated lease session without acquiring a pool session', async () => {
    const h = harness();
    await expect(h.store.assertLease!()).rejects.toThrow('lease is not held');
    await h.store.acquire();
    await h.store.assertLease!();
    expect(h.connections).toHaveLength(1);
    expect(h.connections[0].query.mock.calls[1]).toEqual([
      'SELECT IS_USED_LOCK(?)=CONNECTION_ID() AS held',
      ['blog_observe:blogblog-discovery'],
    ]);
    await h.store.release();
    await expect(h.store.assertLease!()).rejects.toThrow('lease is not held');
  });

  it.each([{ leaseHeld: 0 }, { failLeaseCheck: true }])('invalidates and destroys a lost lease session %j', async (options) => {
    const h = harness(options);
    await h.store.acquire();
    await expect(h.store.assertLease!()).rejects.toThrow(/lease was lost|lease connection lost/);
    expect(h.connections[0].destroy).toHaveBeenCalledOnce();
    expect(h.connections[0].release).not.toHaveBeenCalled();
    await h.store.release();
    await expect(h.store.assertLease!()).rejects.toThrow('lease is not held');
    expect(h.connections[0].destroy).toHaveBeenCalledOnce();
  });
});

describe('candidate duplicate handling', () => {
  it('treats only ER_DUP_ENTRY as an existing candidate without changing review status', async () => {
    const h = harness({ status: 'rejected', prior: { manualNote: 'do not approve' } });
    expect(await h.store.observe(observation())).toEqual({ inserted: false });
    expect([...h.candidates().values()][0]).toMatchObject({ status: 'rejected', source_evidence: { manualNote: 'do not approve' } });
    expect(h.edges().size).toBe(1);
    const statement = h.connections[0].execute.mock.calls[0][0];
    expect(statement).toMatch(/^INSERT INTO discovery_candidates/);
    expect(statement).not.toContain('IGNORE');
    expect(statement).not.toContain('ON DUPLICATE');
  });

  it('rolls back a nonduplicate candidate SQL error instead of suppressing it', async () => {
    const h = harness({ candidateError: 'ER_DATA_TOO_LONG' });
    await expect(h.store.observe(observation())).rejects.toMatchObject({ code: 'ER_DATA_TOO_LONG' });
    expect(h.candidates().size).toBe(0);
    expect(h.edges().size).toBe(0);
    expect(h.connections[0].rollback).toHaveBeenCalledOnce();
    expect(h.connections[0].commit).not.toHaveBeenCalled();
    expect(h.connections[0].execute).toHaveBeenCalledOnce();
  });

  it('keeps another source candidate at the same URL untouched while adding a blogblog candidate', async () => {
    const h = harness();
    const manual = {
      id: 99,
      url: observation().targetUrl,
      status: 'rejected',
      source_type: 'manual',
      source_evidence: { manualNote: 'preserve this source record' },
    };
    h.candidates().set(`${observation().targetUrl}|manual`, structuredClone(manual));
    expect(await h.store.observe(observation())).toEqual({ inserted: true });
    expect(h.candidates().size).toBe(2);
    expect(h.candidates().get(`${observation().targetUrl}|manual`)).toEqual(manual);
    expect(h.candidates().get(`${observation().targetUrl}|blogblog-club`)).toMatchObject({
      status: 'candidate',
      source_type: 'blogblog-club',
    });
  });
});
