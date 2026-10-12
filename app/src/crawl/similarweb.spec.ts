import * as filesystem from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.js';
import { discoverSimilarSites } from './similarweb.ts';

// Fail the assertions if a future implementation revives local lock/budget I/O.
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
}));

const network = vi.fn(() => {
  throw new Error('Provider requests must remain disabled until the tag contract exists');
});

function expectNoIO() {
  expect(network).not.toHaveBeenCalled();
  for (const operation of Object.values(filesystem)) expect(operation).not.toHaveBeenCalled();
}

describe('Similarweb integration waits for the approved tag contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', network);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('returns no candidates or I/O by default and when explicitly disabled', async () => {
    await expect(discoverSimilarSites('  WWW.Example.com  ')).resolves.toEqual({
      enabled: false,
      domain: 'example.com',
      status: 'disabled',
      candidates: [],
    });
    await expect(discoverSimilarSites('example.com', { enabled: false })).resolves.toMatchObject({
      status: 'disabled',
      candidates: [],
    });
    expectNoIO();
  });

  it('cannot fetch or produce candidates when enabled without a tag adapter', async () => {
    await expect(discoverSimilarSites('example.com', { enabled: true })).resolves.toEqual({
      enabled: true,
      domain: 'example.com',
      status: 'awaiting-contract',
      candidates: [],
    });
    expectNoIO();
  });

  it('ignores all retired environment flags, endpoints and filesystem settings', async () => {
    const legacy = {
      BLOG_SIMILARWEB_ENABLED: 'true',
      BLOG_SIMILARWEB_ENDPOINT: 'http://127.0.0.1:18160/healthz',
      BLOG_SIMILARWEB_LOCK_PATH: '/tmp/retired-blog-similarweb-lock',
      BLOG_SIMILARWEB_BUDGET_PATH: '/tmp/retired-blog-similarweb-budget.json',
      BLOG_SIMILARWEB_MAX_PER_DAY: '9999',
    };
    for (const [name, value] of Object.entries(legacy)) vi.stubEnv(name, value);
    const config = loadConfig({ BLOG_DB_URL: 'mysql://blog:unused@127.0.0.1/blog_observe', ...legacy });
    expect(config.similarWeb).toEqual({ enabled: false });
    await expect(discoverSimilarSites('example.com')).resolves.toMatchObject({ status: 'disabled', candidates: [] });
    await expect(discoverSimilarSites('example.com', config.similarWeb)).resolves.toMatchObject({ status: 'disabled', candidates: [] });
    await expect(discoverSimilarSites('example.com', { enabled: true })).resolves.toMatchObject({
      status: 'awaiting-contract',
      candidates: [],
    });
    expectNoIO();
  });
});
