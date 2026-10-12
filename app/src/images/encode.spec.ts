import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'node:child_process';
import { encodeRaster } from './encode.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});
describe('native decoder watchdog', () => {
  it('kills a hung decoder after 8 seconds and never forwards application credentials', async () => {
    vi.useFakeTimers();
    const stdin = Object.assign(new EventEmitter(), { end: vi.fn() }),
      stdout = new EventEmitter();
    const child = Object.assign(new EventEmitter(), { stdin, stdout, kill: vi.fn() });
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    const encoded = encodeRaster(Buffer.from('fixture'), [160]);
    const rejected = expect(encoded).rejects.toThrow('image_decode_failed');
    await vi.advanceTimersByTimeAsync(8000);
    await rejected;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    const options = vi.mocked(spawn).mock.calls[0]?.[2];
    expect(options?.env).toEqual({ VIPS_CONCURRENCY: '1', MALLOC_ARENA_MAX: '2' });
    expect(options?.stdio).toEqual(['pipe', 'pipe', 'ignore']);
  });
});
