import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import type { RobotsObservation } from './feed.ts';
import { recordRobotsObservations } from './robots-observations.ts';

const listener = vi.hoisted(() => ({ current: null as ((o: RobotsObservation) => void) | null }));
vi.mock('./feed.ts', () => ({
  onRobotsObservation: (fn: (o: RobotsObservation) => void) => {
    listener.current = fn;
  },
}));

describe('robots.txt reads kept per host', () => {
  it('writes the latest read, skips an identical repeat, and keeps the last readable time across outages', () => {
    const execute = vi.fn(async (_sql: string, _parameters: unknown[]) => [{}]);
    recordRobotsObservations({ execute } as unknown as Pool);
    const at = (minutes: number) => new Date(Date.parse('2026-10-17T12:00:00Z') + minutes * 60_000);
    const down = (minutes: number): RobotsObservation => ({
      host: 'blog.example.tw',
      outcome: 'unreachable',
      httpStatus: null,
      error: 'timeout',
      disallow: [],
      checkedAt: at(minutes),
    });
    const emit = listener.current!;
    emit(down(0));
    emit(down(1)); // same answer within ten minutes: not written again
    emit(down(11));
    emit({ ...down(12), outcome: 'partial', httpStatus: 200, error: null, disallow: ['/wp-json/'] });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[0][0]).toContain('readable_at=COALESCE(VALUES(readable_at),readable_at)');
    expect(execute.mock.calls[0][1]).toEqual(['blog.example.tw', 'unreachable', null, 'timeout', '[]', at(0), null]);
    expect(execute.mock.calls[2][1]).toEqual(['blog.example.tw', 'partial', 200, null, '["/wp-json/"]', at(12), at(12)]);
  });
});
