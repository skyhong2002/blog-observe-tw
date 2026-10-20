import { describe, expect, it, vi } from 'vitest';
import { INDIEPING_LISTING, indiepingListing, listingLabel, listingOf } from './directory-listing.ts';
import { discoverIndieping, INDIEPING_DELAY_MS, indiepingMembers } from './indieping.ts';

const answer = (links: Record<string, unknown>[], remaining = 90) =>
  new Response(JSON.stringify({ domain: 'x', aliases: [], inList: true, links }), {
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-limit': '18000',
      'x-ratelimit-remaining': String(remaining),
      'x-ratelimit-reset': '0',
    },
  });
const link = (blogUrl: string, blogName = '站') => ({ blog_url: blogUrl, blog_name: blogName, post_url: `${blogUrl}/p/` });

describe('IndiePing as a directory source', () => {
  it('reads one member per publication home', () => {
    const members = indiepingMembers(
      { links: [link('https://blog.a.example'), link('https://blog.a.example/'), link('javascript:alert(1)'), { blog_url: 3 }] },
      'carrot.tw',
    );
    expect(members.map((m) => [m.home, m.linkedTo])).toEqual([['https://blog.a.example/', 'carrot.tw']]);
  });
  it('counts only its own listing page', () => {
    const evidence = { indiepingListing: { page: INDIEPING_LISTING } };
    expect(indiepingListing(evidence)).toBe(INDIEPING_LISTING);
    expect(indiepingListing({ indiepingListing: { page: 'https://evil.test/' } })).toBeNull();
    expect(listingOf('indieping', evidence)).toBe(INDIEPING_LISTING);
    expect(listingOf('article-link', evidence)).toBeNull();
    expect(listingLabel('indieping')).toBe('IndiePing 名單自動收錄');
  });
  it('asks about collected hosts then new members, adds only uncollected homes, and keeps to half the window', async () => {
    const asked: string[] = [];
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      if (url.pathname === '/robots.txt') return new Response('', { status: 404 });
      const domain = url.searchParams.get('domain')!;
      asked.push(domain);
      if (domain === 'carrot.tw') return answer([link('https://new.example'), link('https://known.example')], 60);
      if (domain === 'new.example') return answer([link('https://deeper.example')], 40);
      return answer([], 99);
    });
    const executed: unknown[][] = [];
    const pool = {
      query: vi.fn(async () => [[{ url: 'https://carrot.tw/' }, { url: 'https://known.example/' }]]),
      execute: vi.fn(async (_sql: string, parameters: unknown[]) => {
        executed.push(parameters);
        return [{ affectedRows: 1 }];
      }),
    };
    const waits: number[] = [];
    const result = await discoverIndieping(pool as never, {
      fetcher: fetcher as never,
      resolveHost: async () => ['93.184.216.34'],
      delayMs: 250,
      wait: async (ms) => void waits.push(ms),
    });
    expect(asked).toEqual(['carrot.tw', 'known.example', 'new.example', 'deeper.example']);
    expect(executed.map((parameters) => parameters[0])).toEqual(['https://new.example/', 'https://deeper.example/']);
    expect(result).toMatchObject({ queries: 4, added: 2, alreadyCollected: 1, errors: 0 });
    // Paced between queries; new.example's answer left 40 of a window that started at 61, so it waited for the reset.
    expect(waits.filter((ms) => ms === INDIEPING_DELAY_MS)).toHaveLength(3);
    expect(waits.some((ms) => ms > INDIEPING_DELAY_MS)).toBe(true);
  });
});
