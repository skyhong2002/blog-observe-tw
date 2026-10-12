import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdminApiError, AdminWriter, adminGet, manualOverride, safeAdminLink } from '../src/lib/admin-client.ts';

test('admin write carries csrf and random intent with only same-origin credentials', async () => {
  const calls: Array<{ path: RequestInfo | URL; init?: RequestInit }> = [];
  const request: typeof fetch = async (path, init) => {
    calls.push({ path, init });
    return Response.json({ ok: true });
  };
  const writer = new AdminWriter();
  await writer.post('/api/admin/tags', { blogId: 1, action: 'set', label: '旅行' }, 'test-csrf', request);
  const { path, init } = calls[0];
  assert.equal(path, '/api/admin/tags');
  assert.equal(init?.method, 'POST');
  assert.equal(init?.cache, 'no-store');
  assert.equal(init?.credentials, 'same-origin');
  const headers = new Headers(init?.headers);
  assert.equal(headers.get('x-blog-csrf'), 'test-csrf');
  assert.match(headers.get('idempotency-key') ?? '', /^[a-f0-9-]{36}$/);
  assert.equal(headers.has('origin'), false);
  assert.equal(headers.has('authorization'), false);
  assert.deepEqual(JSON.parse(String(init?.body)), { blogId: 1, action: 'set', label: '旅行' });
});
test('uncertain response reuses intent; successful repeated action gets a new intent', async () => {
  const keys: string[] = [];
  let count = 0;
  const request: typeof fetch = async (_path, init) => {
    keys.push(new Headers(init?.headers).get('idempotency-key')!);
    if (!count++) throw Error('connection lost');
    return Response.json({ ok: true });
  };
  const writer = new AdminWriter();
  await assert.rejects(writer.post('/api/admin/tags', { label: '旅行' }, 'csrf', request));
  await writer.post('/api/admin/tags', { label: '旅行' }, 'csrf', request);
  await writer.post('/api/admin/tags', { label: '旅行' }, 'csrf', request);
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
});
test('double submission is rejected before second wire call', async () => {
  let resolve!: (response: Response) => void;
  let count = 0;
  const request: typeof fetch = async () => {
    count++;
    return new Promise<Response>((r) => {
      resolve = r;
    });
  };
  const writer = new AdminWriter();
  const first = writer.post('/api/admin/tags', { label: '旅行' }, 'csrf', request);
  await assert.rejects(
    writer.post('/api/admin/tags', { label: '旅行' }, 'csrf', request),
    (e: unknown) => e instanceof AdminApiError && e.code === 'intent_pending',
  );
  assert.equal(count, 1);
  resolve(Response.json({ ok: true }));
  await first;
});
test('missing csrf sends no request, access failures and failed idempotent results are errors', async () => {
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    return Response.json({ ok: true });
  };
  await assert.rejects(new AdminWriter().post('/api/admin/tags', {}, '', request), /驗證資訊/);
  assert.equal(calls, 0);
  for (const [status, code] of [
    [401, 'login_required'],
    [403, 'csrf_required'],
    [409, 'intent_pending'],
    [429, 'admin_daily_budget'],
  ] as const) {
    await assert.rejects(
      adminGet('/api/admin/session', async () => Response.json({ error: code }, { status })),
      (e: unknown) => e instanceof AdminApiError && e.status === status,
    );
  }
  await assert.rejects(
    new AdminWriter().post('/api/admin/tags', {}, 'csrf', async () => Response.json({ error: 'admin_action_failed' })),
    AdminApiError,
  );
});
test('read requests remain local/private and source hyperlinks reject active or credential URLs', async () => {
  let init: RequestInit | undefined;
  await adminGet('/api/admin/audits', async (_path, options) => {
    init = options;
    return Response.json({ items: [] });
  });
  assert.equal(init?.cache, 'no-store');
  assert.equal(init?.credentials, 'same-origin');
  assert.equal(safeAdminLink('javascript:alert(1)'), undefined);
  assert.equal(safeAdminLink('data:text/html,bad'), undefined);
  assert.equal(safeAdminLink('https://user:pass@example.com'), undefined);
  assert.equal(safeAdminLink('https://example.com/'), 'https://example.com/');
});
test('human profile/topic payload obeys server structural limits without classifying a site', () => {
  const out = manualOverride('人工校正的簡介', '旅行\n生活，旅行');
  assert.deepEqual(out, {
    classification: 'uncertain',
    confidence: 0,
    quotedEvidence: [],
    bio: '人工校正的簡介',
    topics: ['旅行', '生活'],
  });
  assert.throws(() => manualOverride('字'.repeat(601), ''));
  assert.throws(() => manualOverride('', Array.from({ length: 9 }, (_, i) => String(i)).join('\n')));
  assert.throws(() => manualOverride('', '題'.repeat(61)));
});

test('write helper cannot leak csrf to external or unrelated paths', async () => {
  let requests = 0;
  const request: typeof fetch = async () => {
    requests++;
    return Response.json({ ok: true });
  };
  for (const path of ['https://evil.example/', '//evil.example/', '/auth/logout', '/api/admin/session'])
    await assert.rejects(new AdminWriter().post(path, {}, 'csrf', request));
  assert.equal(requests, 0);
});
