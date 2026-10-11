import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverSimilarSites } from './similarweb.ts';

describe('Similarweb coordination', () => {
  it('does not call the network when disabled by default', async () => {
    let calls = 0;
    const result = await discoverSimilarSites('example.com', {
      fetcher: async () => {
        calls += 1;
        return new Response('{}');
      },
    });
    expect(result.status).toBe('disabled');
    expect(calls).toBe(0);
  });

  it('uses a host lock and bounded daily budget when explicitly enabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'blog-similarweb-'));
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return new Response(JSON.stringify({ similar_sites: [{ domain: 'other.example' }] }), {
        headers: { 'content-type': 'application/json' },
      });
    };
    const options = { enabled: true, lockPath: join(dir, 'lock'), budgetPath: join(dir, 'budget.json'), maxPerDay: 1, fetcher };
    await expect(discoverSimilarSites('example.com', options)).resolves.toMatchObject({ status: 'ok', candidates: ['other.example'] });
    await expect(discoverSimilarSites('another.example', options)).resolves.toMatchObject({ status: 'budget' });
    expect(calls).toBe(1);
  });
});
