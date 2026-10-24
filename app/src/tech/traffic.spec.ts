import { describe, expect, it, vi } from 'vitest';
import { parseTrafficSites, projectTrafficSite, trafficTechClient } from './traffic.ts';

const site = {
  status: 'failed',
  observedAt: '2026-10-01T00:00:00Z',
  lastAttemptAt: '2026-10-24T00:00:00Z',
  sourceUrl: 'https://example.tw/',
  errorCode: 'not-html',
  detections: [
    {
      id: 'react',
      name: 'React',
      category: 'library',
      confidence: 0.8,
      version: 'unknown',
      ruleId: 'wappalyzer:react',
      ruleVersion: 'wappalyzer-d91f7e510e93',
      observedAt: '2026-10-01T00:00:00Z',
      evidence: [{ kind: 'marker', value: 'HTML rule' }],
    },
  ],
};
const payload = () => ({ sites: { 'example.tw': site }, notChecked: ['new.tw'] });
describe('traffic technology reads', () => {
  it('retains last success after failure and strips fields outside the public contract', () => {
    const parsed = parseTrafficSites({ sites: { 'example.tw': { ...site, private: 'secret' } }, notChecked: [] });
    expect(projectTrafficSite(parsed['example.tw'])).toMatchObject({
      status: 'failed',
      observedAt: site.observedAt,
      detections: site.detections,
    });
    expect(JSON.stringify(parsed)).not.toContain('secret');
    expect(projectTrafficSite()).toMatchObject({ status: 'not-observed', lastAttemptAt: null, detections: [] });
    expect(() => parseTrafficSites({ sites: { bad: { ...site, observedAt: null } }, notChecked: [] })).toThrow();
  });
  it('uses loopback credentials, coalesces reads, expires at 60 seconds and never caches failure', async () => {
    let now = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(payload()));
    const client = trafficTechClient({ fetcher, readToken: async () => 'test-token', now: () => now });
    await Promise.all([client.read(['www.Example.tw', 'new.tw']), client.read(['new.tw', 'www.Example.tw'])]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:18150/internal/v1/tech');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { authorization: 'Bearer test-token' } });
    expect(JSON.parse(String(init?.body))).toEqual({ domains: ['new.tw', 'www.Example.tw'] });
    now = 60_000;
    fetcher.mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(client.read(['new.tw', 'www.Example.tw'])).rejects.toThrow();
    await client.read(['new.tw', 'www.Example.tw']);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await expect(client.read(Array.from({ length: 2001 }, (_, i) => `${i}.tw`))).rejects.toThrow();
  });
});
