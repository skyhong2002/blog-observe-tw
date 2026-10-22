import { describe, expect, it, vi } from 'vitest';
import { applyPlatformRepair, planPlatformRepair, scanPlatform } from './platform-repair.ts';

const detection = (id: string, confidence: number) => ({ id, confidence });
const row = (blogId: number, slug: string, platform: string, detections: unknown[] | null, scanStatus: string | null = 'detected') => ({
  blogId,
  slug,
  platform,
  detections: detections && JSON.stringify(detections),
  scanStatus: detections ? scanStatus : null,
});
const poolOf = (rows: unknown[]) => ({ query: vi.fn(async () => [rows]) }) as never;

describe('the platform a technology scan names', () => {
  it('is the most confident blogging platform, and nothing when it is weak or tied', () => {
    expect(scanPlatform([detection('hugo', 1), detection('cloudflare', 0.4)])).toBe('hugo');
    expect(scanPlatform([detection('wordpress', 0.95), detection('hugo', 0.7)])).toBe('wordpress');
    expect(scanPlatform([detection('hugo', 0.5)])).toBeNull();
    expect(scanPlatform([detection('hugo', 1), detection('ghost', 1)])).toBeNull();
    expect(scanPlatform([detection('ga', 1)])).toBeNull();
    expect(scanPlatform('not json list')).toBeNull();
  });
});

describe('platform repair plan', () => {
  it('changes a platform its own technology scan contradicts, and counts the ones it confirms', async () => {
    const plan = await planPlatformRepair(
      poolOf([
        row(1, 'a', 'wordpress', [detection('hugo', 1)]),
        row(2, 'b', 'wordpress', [detection('wordpress', 0.95)]),
        row(3, 'c', 'jekyll', [detection('ghost', 0.95)]),
      ]),
    );
    expect(plan.changes).toEqual([
      { blogId: 1, slug: 'a', from: 'wordpress', to: 'hugo', evidence: 'technology-scan' },
      { blogId: 3, slug: 'c', from: 'jekyll', to: 'ghost', evidence: 'technology-scan' },
    ]);
    expect(plan.confirmed).toBe(1);
  });
  it('lists WordPress guesses that nothing confirms and leaves other unconfirmed platforms alone', async () => {
    const plan = await planPlatformRepair(
      poolOf([
        row(1, 'blocked', 'wordpress', null),
        row(2, 'plain', 'generic', null),
        row(3, 'weak', 'wordpress', [detection('cloudflare', 0.4)]),
      ]),
    );
    expect(plan.changes).toEqual([]);
    expect(plan.unverified.map((r) => r.slug)).toEqual(['blocked', 'weak']);
  });
  it('lets a page read just now outrank the stored scan, and a page that names nothing leave the guess unverified', async () => {
    const rows = [row(1, 'jn', 'wordpress', null), row(2, 'quiet', 'wordpress', null)];
    const plan = await planPlatformRepair(
      poolOf(rows),
      new Map([
        [1, 'hugo' as const],
        [2, null],
      ]),
    );
    expect(plan.changes).toEqual([{ blogId: 1, slug: 'jn', from: 'wordpress', to: 'hugo', evidence: 'home-page' }]);
    expect(plan.unverified.map((r) => r.slug)).toEqual(['quiet']);
  });
});

describe('platform repair apply', () => {
  const changes = [{ blogId: 1, slug: 'a', from: 'wordpress', to: 'hugo' as const, evidence: 'technology-scan' as const }];
  it('saves the old rows first, then updates only a rule still inferred with the platform seen at preview', async () => {
    const order: string[] = [];
    const execute = vi.fn(async (sql: string, parameters: unknown[]) => {
      order.push('update');
      expect(sql).toContain("rule_source='inferred' AND platform=?");
      expect(parameters).toEqual(['hugo', 'hugo-public', new Date('2026-10-22T00:00:00Z'), 1, 'wordpress']);
      return [{ affectedRows: 1 }];
    });
    const changed = await applyPlatformRepair(
      { execute } as never,
      { changes, unverified: [], confirmed: 0 },
      () => void order.push('backup'),
      new Date('2026-10-22T00:00:00Z'),
    );
    expect(order).toEqual(['backup', 'update']);
    expect(changed).toBe(1);
  });
  it('does not update when the backup fails', async () => {
    const execute = vi.fn();
    await expect(
      applyPlatformRepair({ execute } as never, { changes, unverified: [], confirmed: 0 }, () => {
        throw new Error('disk full');
      }),
    ).rejects.toThrow('disk full');
    expect(execute).not.toHaveBeenCalled();
  });
});
