import { describe, expect, it, vi } from 'vitest';
import { readCodexQuota, remainingOf, scraperTargetsFor } from './quota.ts';

const usage = (primary: number, secondary: number, extra = {}) => ({
  plan_type: 'pro',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: { used_percent: primary },
    secondary_window: { used_percent: secondary },
    ...extra,
  },
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('Codex quota for generated scrapers', () => {
  it('takes the tighter window, and nothing once a limit is reached', () => {
    expect(remainingOf(usage(10, 35))).toBe(65);
    expect(remainingOf(usage(90, 5))).toBe(10);
    expect(remainingOf(usage(10, 10, { limit_reached: true }))).toBe(0);
    expect(remainingOf({})).toBeNull();
  });
  it('maps remaining quota to targets per run, none when unknown', () => {
    const at = (remainingPercent: number) => scraperTargetsFor({ remainingPercent, accounts: [], checkedAt: '' });
    expect([at(100), at(80), at(79), at(50), at(49), at(20), at(19), at(0)]).toEqual([4, 4, 2, 2, 1, 1, 0, 0]);
    expect(scraperTargetsFor(null)).toBe(0);
  });
  it("asks the proxy for each enabled Codex account's own usage with its token placeholder", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth-files'))
        return json({
          files: [
            { provider: 'codex', auth_index: 'a1', email: 'one@x', account_id: 'acct-111111' },
            { provider: 'codex', auth_index: 'a2', email: 'two@x' },
            { provider: 'codex', auth_index: 'a3', disabled: true },
            { provider: 'claude', auth_index: 'c1' },
          ],
        });
      const body = JSON.parse(String(init?.body));
      return json({ status_code: 200, header: {}, body: JSON.stringify(body.auth_index === 'a1' ? usage(20, 40) : usage(0, 0)) });
    });
    const quota = await readCodexQuota({ fetch: fetcher as unknown as typeof fetch, key: 'k' });
    expect(quota).toMatchObject({
      remainingPercent: 80,
      accounts: [
        { label: 'one@x', remainingPercent: 60 },
        { label: 'two@x', remainingPercent: 100 },
      ],
    });
    const calls = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/api-call')).map(([, init]) => JSON.parse(String(init?.body)));
    expect(calls).toEqual([
      expect.objectContaining({
        auth_index: 'a1',
        url: 'https://chatgpt.com/backend-api/wham/usage',
        header: expect.objectContaining({ Authorization: 'Bearer $TOKEN$', 'ChatGPT-Account-Id': 'acct-111111' }),
      }),
      expect.objectContaining({ auth_index: 'a2', header: expect.not.objectContaining({ 'ChatGPT-Account-Id': expect.anything() }) }),
    ]);
    expect((fetcher.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe('Bearer k');
  });
  it('reads any failure as unknown', async () => {
    const fetcher = vi.fn(async () => json({ error: 'missing management key' }, 401));
    expect(await readCodexQuota({ fetch: fetcher as unknown as typeof fetch, key: 'k' })).toBeNull();
  });
});
