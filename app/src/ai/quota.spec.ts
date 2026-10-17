import { describe, expect, it, vi } from 'vitest';
import { codexQuotaOf, readCodexQuota, scraperTargetsFor } from './quota.ts';

const now = Date.parse('2026-10-17T11:12:00Z');
const account = (id: string, remainingPercent: number, extra = {}) => ({
  id,
  provider: 'codex',
  account: `${id}@x`,
  label: `Codex · ${id}`,
  remainingPercent,
  disabled: false,
  loginRejected: false,
  error: null,
  up: true,
  ...extra,
});
const host = (name: string, list: unknown[], checkedAt = '2026-10-17T11:09:24Z', fresh = true) => ({
  name,
  enabled: true,
  accounts: { fresh, checkedAt, list },
});
const status = (...hosts: unknown[]) => ({
  gateway: { usage: { accountMatches: false, windows: [{ usedPercent: 99 }] }, hosts },
});

describe('Codex quota from the status page', () => {
  it('averages usable Codex accounts once each across mirrored hosts', () => {
    const quota = codexQuotaOf(
      status(
        host('sky-mini', [account('ffb', 53), account('a64', 82), { ...account('cl', 9), provider: 'claude' }]),
        host('skyhong-blog', [account('ffb', 53, { mirror: 'peer' }), account('a64', 82, { mirror: 'peer' })]),
      ),
      now,
    );
    expect(quota).toMatchObject({ remainingPercent: 68, checkedAt: '2026-10-17T11:09:24.000Z' });
    expect(quota?.accounts.map((a) => a.remainingPercent)).toEqual([53, 82]);
  });
  it('leaves out disabled, rejected or failing logins, and stale or unfresh reports', () => {
    const quota = codexQuotaOf(
      status(
        host('a', [
          account('ok', 40),
          account('off', 100, { disabled: true }),
          account('rej', 100, { loginRejected: true }),
          account('err', 100, { error: 'x' }),
        ]),
        host('stale', [account('old', 100)], '2026-10-17T10:00:00Z'),
        host('unfresh', [account('nf', 100)], '2026-10-17T11:10:00Z', false),
      ),
      now,
    );
    expect(quota?.accounts.map((a) => a.remainingPercent)).toEqual([40]);
    expect(codexQuotaOf(status(host('stale', [account('old', 100)], '2026-10-17T10:00:00Z')), now)).toBeNull();
    expect(codexQuotaOf({}, now)).toBeNull();
  });
  it('maps remaining quota to targets per run, none when unknown', () => {
    const at = (remainingPercent: number) => scraperTargetsFor({ remainingPercent, accounts: [], checkedAt: '' });
    expect([at(100), at(80), at(79), at(50), at(49), at(20), at(19), at(0)]).toEqual([4, 4, 2, 2, 1, 1, 0, 0]);
    expect(scraperTargetsFor(null)).toBe(0);
  });
  it('reads any fetch failure as unknown', async () => {
    const fail = vi.fn(async () => new Response('down', { status: 502 }));
    expect(await readCodexQuota({ fetch: fail as unknown as typeof fetch, now: () => now })).toBeNull();
    const ok = vi.fn(async () => new Response(JSON.stringify(status(host('a', [account('x', 90)]))), { status: 200 }));
    expect(await readCodexQuota({ fetch: ok as unknown as typeof fetch, now: () => now })).toMatchObject({ remainingPercent: 90 });
  });
});
