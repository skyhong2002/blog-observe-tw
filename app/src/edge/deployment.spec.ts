import { describe, expect, it, vi } from 'vitest';
import { acknowledgeEdge, confirmOrRestore, pollReadiness, ReadinessFailure, wrapperExitCode } from './deployment.ts';
import type { EdgeState } from './state.ts';

const before: EdgeState = { active: 'blue', commit: 'a'.repeat(40), generation: 3 };
const next: EdgeState = { active: 'green', commit: 'b'.repeat(40), generation: 4 };
const restored = { ...before, generation: 5 };

describe('reviewed deployment failure handling', () => {
  it('leaves next in place when rollback target is unhealthy and preserves both reasons', async () => {
    const publishRollback = vi.fn();
    await expect(
      confirmOrRestore({
        before,
        next,
        publishRollback,
        acknowledge: async () => {
          throw Error('edge_homepage_unavailable');
        },
        checkOld: async () => {
          throw Error('slot_health_unavailable');
        },
      }),
    ).rejects.toMatchObject({
      message: 'rollback_target_unhealthy',
      primaryCode: 'edge_homepage_unavailable',
      rollbackCode: 'slot_health_unavailable',
    });
    expect(publishRollback).not.toHaveBeenCalled();
  });
  it('checks the old target before publishing and acknowledges the new rollback generation', async () => {
    const order: string[] = [];
    await expect(
      confirmOrRestore({
        before,
        next,
        acknowledge: async (state) => {
          order.push(`ack-${state.generation}`);
          if (state === next) throw Error('edge_health_mismatch');
          expect(state).toEqual(restored);
        },
        checkOld: async () => {
          order.push('check-old');
        },
        publishRollback: async (state) => {
          expect(state).toEqual(restored);
          order.push('publish-old');
        },
      }),
    ).rejects.toMatchObject({ message: 'switch_failed_rolled_back', primaryCode: 'edge_health_mismatch', rollbackCode: null });
    expect(order).toEqual(['ack-4', 'check-old', 'publish-old', 'ack-5']);
  });
  it('does not replace the original failure if rollback acknowledgement also fails', async () => {
    await expect(
      confirmOrRestore({
        before,
        next,
        checkOld: async () => {},
        publishRollback: async () => {},
        acknowledge: async (state) => {
          throw Error(state === next ? 'edge_homepage_unavailable' : 'edge_homepage_release_mismatch');
        },
      }),
    ).rejects.toMatchObject({
      message: 'rollback_ack_failed',
      primaryCode: 'edge_homepage_unavailable',
      rollbackCode: 'edge_homepage_release_mismatch',
    });
  });
  it('retains separate publish failure without logging its unsanitized details', async () => {
    await expect(
      confirmOrRestore({
        before,
        next,
        checkOld: async () => {},
        acknowledge: async () => {
          throw Error('edge_health_mismatch');
        },
        publishRollback: async () => {
          throw Error('sensitive arbitrary OS message');
        },
      }),
    ).rejects.toMatchObject({
      message: 'rollback_publish_failed',
      primaryCode: 'edge_health_mismatch',
      rollbackCode: 'deployment_probe_failed',
    });
  });
  it('does not examine or change rollback state after successful acknowledgement', async () => {
    const checkOld = vi.fn();
    const publishRollback = vi.fn();
    await confirmOrRestore({ before, next, acknowledge: async () => {}, checkOld, publishRollback });
    expect(checkOld).not.toHaveBeenCalled();
    expect(publishRollback).not.toHaveBeenCalled();
  });
});

describe('edge acknowledgement includes SSR HTML', () => {
  const headers = { 'x-blog-release': next.commit, 'x-blog-edge-generation': '4' };
  const health = () => new Response(JSON.stringify({ ok: true, port: 18175 }), { headers });
  it('accepts only homepage HTML served through 18160 by the selected release', async () => {
    const calls: string[] = [];
    await acknowledgeEdge(
      next,
      async (path, port, accept) => {
        expect(port).toBe(18160);
        calls.push(path);
        if (path === '/healthz') return health();
        expect(accept).toBe('text/html');
        return new Response('<!DOCTYPE html><html>ready</html>', { headers });
      },
      { attempts: 1 },
    );
    expect(calls).toEqual(['/healthz', '/']);
  });
  it.each([
    [503, '<html>unavailable</html>', headers, 'edge_homepage_unavailable'],
    [200, '{"ok":true}', headers, 'edge_homepage_unavailable'],
    [200, '<html>old release</html>', { ...headers, 'x-blog-release': before.commit }, 'edge_homepage_release_mismatch'],
    [200, '<html>old generation</html>', { ...headers, 'x-blog-edge-generation': '3' }, 'edge_homepage_release_mismatch'],
  ])('rejects an invalid homepage with status %s', async (status, html, pageHeaders, code) => {
    await expect(
      acknowledgeEdge(next, async (path) => (path === '/healthz' ? health() : new Response(html, { status, headers: pageHeaders })), {
        attempts: 1,
      }),
    ).rejects.toThrow(code);
  });
});

describe('intentional stop and bounded readiness polling', () => {
  it('reports intentional TERM/INT as success but preserves crashes and unsolicited signals', () => {
    expect(wrapperExitCode(true, null, 'SIGTERM')).toBe(0);
    expect(wrapperExitCode(true, null, 'SIGINT')).toBe(0);
    expect(wrapperExitCode(false, null, 'SIGTERM')).toBe(1);
    expect(wrapperExitCode(false, null, 'SIGINT')).toBe(1);
    expect(wrapperExitCode(true, null, 'SIGKILL')).toBe(1);
    expect(wrapperExitCode(true, 2, null)).toBe(2);
    expect(wrapperExitCode(false, 0, null)).toBe(0);
  });
  it('allows brief transient startup failures', async () => {
    const check = vi.fn().mockRejectedValueOnce(new ReadinessFailure('probe_transport_unavailable', true)).mockResolvedValueOnce(undefined);
    const wait = vi.fn(async () => {});
    await pollReadiness(check, { wait });
    expect(check).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });
  it('does not retry a wrong OAuth contract and preserves the final transient error', async () => {
    const badContract = vi.fn(async () => {
      throw Error('slot_oauth_failed');
    });
    await expect(pollReadiness(badContract, { wait: async () => {} })).rejects.toThrow('slot_oauth_failed');
    expect(badContract).toHaveBeenCalledTimes(1);
    const unavailable = vi.fn(async () => {
      throw new ReadinessFailure('slot_probe_failed:/', true);
    });
    await expect(pollReadiness(unavailable, { attempts: 2, wait: async () => {} })).rejects.toThrow('slot_probe_failed:/');
    expect(unavailable).toHaveBeenCalledTimes(2);
  });
});
