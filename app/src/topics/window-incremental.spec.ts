import { describe, expect, it } from 'vitest';
import { planIncrementalWindow, WINDOW_REQUEST_LIMIT, WINDOW_START_LIMIT } from './window-incremental.ts';

describe('bounded rolling vocabulary windows', () => {
  const now = new Date('2026-10-12T12:15:00Z');
  it('carries the local day while querying only one-hour overlap plus new interval', () => {
    expect(planIncrementalWindow(now, { id: 'previous', until: '2026-10-12T12:00:00Z', coverageSince: '2026-10-11T12:00:00Z' })).toEqual({
      window: { since: '2026-10-12T11:00:00.000Z', until: now.toISOString() },
      coverageSince: '2026-10-11T12:15:00.000Z',
      parentVersion: 'previous',
      strategy: 'incremental-overlap',
    });
  });
  it('catches up a gap and never fetches more than 24 hours', () => {
    const gap = planIncrementalWindow(now, { id: 'previous', until: '2026-10-12T01:00:00Z', coverageSince: '2026-10-11T01:00:00Z' });
    expect(gap.window.since).toBe('2026-10-12T00:00:00.000Z');
    for (const previous of [
      null,
      { id: 'old', until: '2026-10-11T12:00:00Z', coverageSince: '2026-10-10T12:00:00Z' },
      { id: 'partial', until: '2026-10-12T12:00:00Z', coverageSince: '2026-10-12T10:00:00Z' },
    ]) {
      const plan = planIncrementalWindow(now, previous);
      expect(plan.strategy).toBe('full-window');
      expect(plan.window.since).toBe(plan.coverageSince);
      expect(plan.parentVersion).toBeNull();
    }
  });
  it('budgets every wire attempt separately from the 96 scheduled starts', () => {
    expect(WINDOW_START_LIMIT).toBe(96);
    expect(WINDOW_REQUEST_LIMIT).toBe(600);
  });
});
