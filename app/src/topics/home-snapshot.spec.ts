import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { HomeRankingSnapshot } from './home-snapshot.ts';
import { invalidateTopicCache, registerTopicRoutes } from './routes.ts';

const row = (id: string) => ({
  topic_id: id,
  label: id,
  source: 'tag-vocabulary',
  score: 2,
  posts: 2,
  blogs: 2,
  title_posts: 2,
  body_posts: 0,
  recent_total: 10,
  baseline_total: 20,
  baseline_matched: 2,
  high_frequency: 0,
});

describe('home ranking snapshot', () => {
  it('serves one read until the refresh interval, then the old value while one background read replaces it', async () => {
    let clock = 0;
    let reads = 0;
    const snapshot = new HomeRankingSnapshot<number>(1000, 6000, () => clock);
    const load = async () => ++reads;
    expect(await snapshot.get('k', load)).toBe(1);
    clock = 999;
    expect(await snapshot.get('k', load)).toBe(1);
    expect(reads).toBe(1);
    clock = 1000;
    expect(await snapshot.get('k', load)).toBe(1);
    expect(reads).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await snapshot.get('k', load)).toBe(2);
    expect(reads).toBe(2);
    // Too old to show: the request waits for a new read.
    clock = 1000 + 6000;
    expect(await snapshot.get('k', load)).toBe(3);
  });

  it('shares one read between concurrent first requests and keeps the old value when a background read fails', async () => {
    let clock = 0;
    let reads = 0;
    let fail = false;
    const snapshot = new HomeRankingSnapshot<number>(1000, 6000, () => clock);
    const load = async () => {
      reads++;
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (fail) throw Error('timeout');
      return reads;
    };
    expect(await Promise.all([snapshot.get('k', load), snapshot.get('k', load)])).toEqual([1, 1]);
    expect(reads).toBe(1);
    fail = true;
    clock = 2000;
    expect(await snapshot.get('k', load)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await snapshot.get('k', load)).toBe(1);
    // A missing snapshot propagates the failure; nothing is invented.
    await expect(snapshot.get('other', load)).rejects.toThrow('timeout');
  });

  it('clear() drops the snapshot and a read already in flight cannot restore it', async () => {
    let reads = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const snapshot = new HomeRankingSnapshot<number>(1000, 6000, () => 0);
    const first = snapshot.get('k', async () => {
      await held;
      return ++reads;
    });
    snapshot.clear();
    expect(await snapshot.get('k', async () => 100 + ++reads)).toBe(101);
    release();
    expect(await first).toBe(2);
    expect(await snapshot.get('k', async () => 0)).toBe(101);
  });

  it('refreshMs 0 reads every time', async () => {
    let reads = 0;
    const snapshot = new HomeRankingSnapshot<number>(0);
    await snapshot.get('k', async () => ++reads);
    await snapshot.get('k', async () => ++reads);
    expect(reads).toBe(2);
  });

  it('the home route answers repeat visits from one ranking read; invalidation forces a new one', async () => {
    let reads = 0;
    const pool = {
      query: async () => [[row(`tag:read-${++reads}`)]],
    } as unknown as Pool;
    const app = Fastify();
    registerTopicRoutes(app, pool);
    try {
      const first = await app.inject('/api/topics?days=30&view=home');
      const second = await app.inject('/api/topics?days=30&view=home');
      expect(second.headers['cache-control']).toBe('no-store');
      expect(second.json()).toEqual(first.json());
      expect(first.json().cacheSeconds).toBe(300);
      expect(reads).toBe(1);
      // Another window is its own snapshot.
      await app.inject('/api/topics?days=7&view=home');
      expect(reads).toBe(2);
      invalidateTopicCache(pool);
      expect((await app.inject('/api/topics?days=30&view=home')).json().items[0].id).toBe('tag:read-3');
    } finally {
      await app.close();
    }
  });
});
