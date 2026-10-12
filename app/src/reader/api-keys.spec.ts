import { createHash } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { apiKeyHash, createApiKeyService, keyLabel, looksLikeKey, newApiKey } from './api-keys.ts';

describe('personal public API keys', () => {
  it('generates high entropy blog-specific keys and SHA-256 digests', () => {
    const keys = Array.from({ length: 20 }, newApiKey);
    expect(new Set(keys).size).toBe(20);
    for (const key of keys) {
      expect(looksLikeKey(key)).toBe(true);
      expect(apiKeyHash(key)).toBe(createHash('sha256').update(key).digest('hex'));
      expect(apiKeyHash(key)).toHaveLength(64);
    }
    for (const bad of ['', `tag_${'a'.repeat(32)}`, `blog_${'a'.repeat(31)}`, ['blog_x'], 'blog_!!!!'])
      expect(looksLikeKey(bad)).toBe(false);
  });
  it('bounds labels in Unicode characters and rejects hidden controls', () => {
    expect(keyLabel(undefined)).toBe('');
    expect(keyLabel('  自用  ')).toBe('自用');
    expect(keyLabel('😀'.repeat(80))).toHaveLength(160);
    for (const label of [false, {}, 'x'.repeat(81), 'a\nb', 'a\u200db']) expect(() => keyLabel(label)).toThrow('invalid_label');
  });
  it('skips invalid shapes and caches only hashes, not raw keys', async () => {
    const query = vi.fn().mockResolvedValue([[{ id: 7, last_used_at: new Date() }]]);
    const service = createApiKeyService({ query } as unknown as Pool);
    expect(await service.identify('bad')).toBeNull();
    expect(query).not.toHaveBeenCalled();
    const key = newApiKey();
    expect(service.isCachedValid(key)).toBe(false);
    expect(await service.identify(key)).toEqual({ id: 7 });
    expect(service.isCachedValid(key)).toBe(true);
    expect(await service.identify(key)).toEqual({ id: 7 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(query.mock.calls)).not.toContain(key);
    expect(query.mock.calls[0][1]).toEqual([apiKeyHash(key)]);
  });
  it('does not restore a revoked key from an older in-flight lookup', async () => {
    const key = newApiKey();
    let resolveLookup!: (rows: unknown) => void;
    let lookups = 0;
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT id,last_used_at') && lookups++ > 0) return Promise.resolve([[]]);
      if (sql.startsWith('SELECT id,last_used_at'))
        return new Promise((resolve) => {
          resolveLookup = resolve;
        });
      if (sql.startsWith('SELECT key_hash')) return Promise.resolve([[{ key_hash: apiKeyHash(key) }]]);
      return Promise.resolve([{ affectedRows: 1 }]);
    });
    const service = createApiKeyService({ query } as unknown as Pool);
    const lookup = service.identify(key);
    await service.revoke(1, 7);
    resolveLookup([[{ id: 7, last_used_at: new Date() }]]);
    expect(await lookup).toBeNull();
    expect(service.isCachedValid(key)).toBe(false);
    expect(await service.identify(key)).toBeNull();
    expect(lookups).toBe(2);
  });
  it('unknown-key floods cannot evict positive entries and both caches have expiry', async () => {
    let clock = Date.now();
    const key = newApiKey(),
      hash = apiKeyHash(key);
    const query = vi
      .fn()
      .mockImplementation((_sql: string, args: string[]) =>
        Promise.resolve(args[0] === hash ? [[{ id: 7, last_used_at: new Date(clock) }]] : [[]]),
      );
    const service = createApiKeyService({ query } as unknown as Pool, () => clock);
    expect(await service.identify(key)).toEqual({ id: 7 });
    const unknown = Array.from({ length: 2001 }, newApiKey);
    for (const value of unknown) expect(await service.identify(value)).toBeNull();
    const before = query.mock.calls.length;
    expect(service.isCachedValid(key)).toBe(true);
    expect(await service.identify(key)).toEqual({ id: 7 });
    expect(query).toHaveBeenCalledTimes(before);
    // The oldest negative entry is evicted independently.
    expect(await service.identify(unknown[0])).toBeNull();
    expect(query).toHaveBeenCalledTimes(before + 1);
    clock += 60001;
    expect(service.isCachedValid(key)).toBe(false);
    expect(await service.identify(key)).toEqual({ id: 7 });
    expect(await service.identify(unknown[0])).toBeNull();
    expect(query).toHaveBeenCalledTimes(before + 3);
  });
  it('retries one cold lookup after an unrelated revocation without rejecting a valid key', async () => {
    const valid = newApiKey(),
      revoked = newApiKey();
    let resolveLookup!: (rows: unknown) => void;
    let lookups = 0;
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT id,last_used_at')) {
        lookups++;
        return lookups === 1
          ? new Promise((resolve) => {
              resolveLookup = resolve;
            })
          : Promise.resolve([[{ id: 7, last_used_at: new Date() }]]);
      }
      if (sql.startsWith('SELECT key_hash')) return Promise.resolve([[{ key_hash: apiKeyHash(revoked) }]]);
      return Promise.resolve([{ affectedRows: 1 }]);
    });
    const service = createApiKeyService({ query } as unknown as Pool);
    const pending = service.identify(valid);
    await service.revoke(1, 9);
    resolveLookup([[{ id: 7, last_used_at: new Date() }]]);
    expect(await pending).toEqual({ id: 7 });
    expect(lookups).toBe(2);
    expect(service.isCachedValid(valid)).toBe(true);
  });
  it('caps generation-race retries and does not cache an uncertain result', async () => {
    const key = newApiKey();
    const resolves: ((rows: unknown) => void)[] = [];
    const query = vi.fn().mockImplementation((sql: string) => {
      if (sql.startsWith('SELECT id,last_used_at'))
        return new Promise((resolve) => {
          resolves.push(resolve);
        });
      if (sql.startsWith('SELECT key_hash')) return Promise.resolve([[{ key_hash: apiKeyHash(newApiKey()) }]]);
      return Promise.resolve([{ affectedRows: 1 }]);
    });
    const service = createApiKeyService({ query } as unknown as Pool);
    const pending = service.identify(key);
    await service.revoke(1, 9);
    resolves[0]([[{ id: 7, last_used_at: new Date() }]]);
    await Promise.resolve();
    expect(resolves).toHaveLength(2);
    await service.revoke(1, 10);
    resolves[1]([[{ id: 7, last_used_at: new Date() }]]);
    expect(await pending).toBeNull();
    expect(service.isCachedValid(key)).toBe(false);
    expect(resolves).toHaveLength(2);
  });
});
