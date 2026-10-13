import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTechRead, TECH_READ_RESOURCES } from './read-resource.ts';

afterEach(() => vi.useRealTimers());
const read = (pool: Pool) => pool.query('SELECT id FROM blogs WHERE status=?', ['verified']);
describe('bounded technology fresh-read resources (offline connections)', () => {
  it('keeps timed-out acquire slots until late connections arrive, without issuing late SQL', async () => {
    vi.useFakeTimers();
    const first = Promise.withResolvers<unknown>();
    const second = Promise.withResolvers<unknown>();
    const getConnection = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const pool = { getConnection } as unknown as Pool;
    const a = runTechRead(pool, read).catch((e: Error) => e.message);
    const b = runTechRead(pool, read).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(TECH_READ_RESOURCES.deadlineMs + 1);
    expect(await a).toBe('technology_read_timeout');
    expect(await b).toBe('technology_read_timeout');
    for (let i = 0; i < 40; i++) await expect(runTechRead(pool, read)).rejects.toThrow('technology_busy');
    expect(getConnection).toHaveBeenCalledTimes(2);
    const released = Promise.withResolvers<void>();
    const late = { release: vi.fn(() => released.resolve()), query: vi.fn(), destroy: vi.fn() };
    first.resolve(late);
    await released.promise;
    expect(late.query).not.toHaveBeenCalled();
    expect(late.release).toHaveBeenCalledOnce();
    getConnection.mockRejectedValueOnce(Error('mock pool failure'));
    await expect(runTechRead(pool, read)).rejects.toThrow('mock pool failure');
    expect(getConnection).toHaveBeenCalledTimes(3);
    second.reject(Error('late acquisition failure'));
  });
  it('uses separate queries while A holds old data, rejects excess load, then admits fresh work', async () => {
    const gateA = Promise.withResolvers<void>();
    const gateB = Promise.withResolvers<void>();
    const enteredA = Promise.withResolvers<void>();
    const enteredB = Promise.withResolvers<void>();
    let visible = true;
    let calls = 0;
    const connections: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
    const pool = {
      getConnection: vi.fn(async () => {
        const c = {
          query: vi.fn(async (options: { sql: string; values: unknown[]; timeout: number }) => {
            expect(options).toMatchObject({
              sql: 'SET STATEMENT max_statement_time=0.25 FOR SELECT id FROM blogs WHERE status=?',
              values: ['verified'],
              timeout: 500,
            });
            const captured = visible;
            const index = ++calls;
            if (index === 1) {
              enteredA.resolve();
              await gateA.promise;
            }
            if (index === 2) {
              enteredB.resolve();
              await gateB.promise;
            }
            return [[{ visible: captured }]];
          }),
          release: vi.fn(),
          destroy: vi.fn(),
        };
        connections.push(c);
        return c;
      }),
    } as unknown as Pool;
    const a = runTechRead(pool, read);
    await enteredA.promise;
    visible = false; // Simulated visibility commit after A already read.
    const b = runTechRead(pool, read);
    await enteredB.promise;
    await expect(runTechRead(pool, read)).rejects.toThrow('technology_busy');
    expect(calls).toBe(2);
    gateB.resolve();
    expect(await b).toEqual([[{ visible: false }]]);
    gateA.resolve();
    expect(await a).toEqual([[{ visible: true }]]);
    expect(await runTechRead(pool, read)).toEqual([[{ visible: false }]]);
    expect(calls).toBe(3);
    expect(connections.every((c) => c.release.mock.calls.length === 1 && c.destroy.mock.calls.length === 0)).toBe(true);
  });
  it('destroys the connection on driver timeout and drains admission for a later request', async () => {
    const c = { query: vi.fn().mockRejectedValue(Error('driver timeout')), destroy: vi.fn(), release: vi.fn() };
    const getConnection = vi.fn(async () => c);
    const pool = { getConnection } as unknown as Pool;
    await expect(runTechRead(pool, read)).rejects.toThrow('driver timeout');
    expect(c.destroy).toHaveBeenCalledOnce();
    expect(c.release).not.toHaveBeenCalled();
    c.query.mockResolvedValue([[]]);
    expect(await runTechRead(pool, read)).toEqual([[]]);
    expect(getConnection).toHaveBeenCalledTimes(2);
  });
  it.each(['return-fallback', 'retry-then-fallback'])('rejects a loader that swallows a query timeout: %s', async (mode) => {
    const c = { query: vi.fn().mockRejectedValue(Error('driver timeout')), destroy: vi.fn(), release: vi.fn() };
    const pool = { getConnection: vi.fn(async () => c) } as unknown as Pool;
    const load = async (readPool: Pool) => {
      try {
        await read(readPool);
      } catch {
        // Destruction must precede the caller's catch, not wait for load to fail.
        expect(c.destroy).toHaveBeenCalledOnce();
      }
      if (mode === 'retry-then-fallback') await expect(read(readPool)).rejects.toThrow('technology_read_unavailable');
      return { items: [], fallback: true };
    };
    await expect(runTechRead(pool, load)).rejects.toThrow('technology_read_unavailable');
    expect(c.query).toHaveBeenCalledOnce();
    expect(c.destroy).toHaveBeenCalledOnce();
    expect(c.release).not.toHaveBeenCalled();
  });

  it('destroys an acquired connection on route deadline without calling that Promise cancellation', async () => {
    vi.useFakeTimers();
    const entered = Promise.withResolvers<void>();
    const done = Promise.withResolvers<unknown>();
    const c = {
      query: vi.fn(() => {
        entered.resolve();
        return done.promise;
      }),
      destroy: vi.fn(),
      release: vi.fn(),
    };
    const pool = { getConnection: vi.fn(async () => c) } as unknown as Pool;
    const result = runTechRead(pool, read).catch((e: Error) => e.message);
    await entered.promise;
    await vi.advanceTimersByTimeAsync(TECH_READ_RESOURCES.deadlineMs + 1);
    expect(await result).toBe('technology_read_timeout');
    expect(c.destroy).toHaveBeenCalledOnce();
    expect(c.release).not.toHaveBeenCalled();
    done.reject(Error('mock connection closed'));
  });
});
