import { describe, expect, it } from 'vitest';
import { topicDeferredReason } from './deferred-reason.ts';
import { TagArticleSource } from './tag-source.ts';

describe('safe vocabulary defer diagnostics', () => {
  it('reproduces a closing upstream 503 without retries or raw response exposure', async () => {
    let calls = 0;
    const source = new TagArticleSource(async () => {
      calls++;
      return new Response('private upstream debug details', { status: 503 });
    });
    let failure: unknown;
    try {
      await source.page({ since: '2026-10-12T07:23:12.536Z', until: '2026-10-12T14:16:08.875Z' }, '1791811844000_53353038');
    } catch (error) {
      failure = error;
    }
    expect(calls).toBe(1);
    expect(topicDeferredReason(failure)).toBe('upstream-http-503');
  });
  it('never exposes arbitrary SQL, tokens or driver codes', () => {
    expect(topicDeferredReason({ code: 'ER_LOCK_DEADLOCK', message: 'secret SQL' })).toBe('database:ER_LOCK_DEADLOCK');
    expect(topicDeferredReason({ code: 'TOKEN-secret', message: 'secret SQL' })).toBe('unexpected-error');
    expect(topicDeferredReason(new Error('Tag source HTTP 503 secret'))).toBe('unexpected-error');
    expect(topicDeferredReason(new Error('Tag request deadline'))).toBe('upstream-timeout');
    expect(topicDeferredReason(new Error('Tag request failed'))).toBe('upstream-network');
  });
});
