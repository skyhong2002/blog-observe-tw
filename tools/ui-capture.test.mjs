import test from 'node:test';
import assert from 'node:assert/strict';
import { capture, installGuards, LIMITS, plan, requestDecision, verifyGate, verifyIdentity } from './ui-capture.mjs';

const config = { targetOrigin: 'http://127.0.0.1:18174', expectedSHA: 'a'.repeat(40), expectedBuildId: 'fixture-build', buildIdHeader: 'x-build-id', pages: [{ path: '/', width: 1280 }, { path: '/articles/', width: 390 }] };
const gate = { load: 1, processes: 0, available: LIMITS.reserve + 100 * 1024 ** 2 };
test('ordinary analytics hosts and subdomains are blocked, even on target origin', () => {
  for (const host of ['www.google-analytics.com', 'region1.google-analytics.com', 'www.googletagmanager.com', 'analytics.google.com', 'stats.g.doubleclick.net'])
    assert.equal(requestDecision(`https://${host}/collect`, `https://${host}`), 'analytics');
});
test('hostname parsing denies external origins, deceptive suffixes and unsafe URLs', () => {
  assert.equal(requestDecision('https://google-analytics.com.attacker.test/collect', config.targetOrigin), 'external');
  assert.equal(requestDecision('http://127.0.0.1:18174/assets.js', config.targetOrigin), 'allow');
  assert.equal(requestDecision('http://127.0.0.1:18175/assets.js', config.targetOrigin), 'external');
  assert.equal(requestDecision('http://user@127.0.0.1:18174/', config.targetOrigin), 'external');
  assert.equal(requestDecision('data:text/html,test', config.targetOrigin), 'external');
});
test('bounded plan estimates uncompressed pixels and rejects more than four images/private routes', () => {
  assert.equal(plan(config).estimatedBytes, (1280 + 390) * 900 * 4);
  assert.throws(() => plan({ ...config, pages: Array(5).fill(config.pages[0]) }), /batch_limit/);
  assert.throws(() => plan({ ...config, pages: [{ path: '//attacker.test/', width: 390 }] }));
  assert.throws(() => plan({ ...config, pages: [{ path: '/login/', width: 390 }] }), /private_route/);
});
test('disk/load/process gates fail closed for missing values and conservative quota', () => {
  verifyGate(gate, 1000);
  for (const patch of [{ load: 12.01 }, { load: NaN }, { processes: 2 }, { processes: NaN }, { available: LIMITS.reserve + 999 }])
    assert.throws(() => verifyGate({ ...gate, ...patch }, 1000), /gate_closed/);
});
test('response identity requires observed SHA and BUILD_ID', () => {
  assert.deepEqual(verifyIdentity({ 'x-blog-release': config.expectedSHA, 'x-build-id': 'fixture-build' }, config), { sha: config.expectedSHA, buildId: 'fixture-build' });
  assert.throws(() => verifyIdentity({ 'x-blog-release': config.expectedSHA }, config), /identity_unverified/);
  assert.throws(() => verifyIdentity({ 'x-blog-release': 'b'.repeat(40), 'x-build-id': 'fixture-build' }, config));
});
test('all-request and websocket guards install before init script, without logging URL/header/query', async () => {
  const calls = [], counters = { analytics: 0, external: 0 };
  let handler;
  await installGuards({ route: async (pattern, fn) => { calls.push(pattern); handler = fn; }, routeWebSocket: async pattern => calls.push(`ws:${pattern}`), addInitScript: async () => calls.push('init') }, config.targetOrigin, counters);
  const actions = [];
  await handler({ request: () => ({ url: () => 'https://www.google-analytics.com/g/collect?secret=private', method: () => 'GET' }), abort: async () => actions.push('abort'), continue: async () => actions.push('continue') });
  assert.deepEqual(calls, ['**/*', 'ws:**/*', 'init']); assert.deepEqual(actions, ['abort']); assert.deepEqual(counters, { analytics: 1, external: 0 });
});
function mocks({ badIdentity = false, quota = true, hotPage = false, closeFails = false } = {}) {
  const events = [], reports = [], images = []; let gates = 0;
  const headers = { 'x-blog-release': badIdentity ? 'b'.repeat(40) : config.expectedSHA, 'x-build-id': config.expectedBuildId };
  let current;
  const page = { on: () => {}, setViewportSize: async () => {}, goto: async url => { current = url; events.push('goto'); return { status: () => 200, allHeaders: async () => headers }; }, url: () => current, screenshot: async options => { assert.equal(options.fullPage, false); return Buffer.alloc(64); } };
  const context = { route: async () => events.push('route'), routeWebSocket: async () => events.push('ws'), addInitScript: async () => {}, newPage: async () => { events.push('newPage'); return page; } };
  const deps = { now: () => 'mock-clock', gate: async () => { gates++; return { ...gate, load: hotPage && gates === 3 ? 13 : 1 }; }, acquireGlobalQuota: async () => quota ? { assertHeld: async () => true, release: async () => events.push('release') } : null, launch: async () => { events.push('launch'); return { newContext: async opts => { assert.equal(opts.extraHTTPHeaders.DNT, '1'); assert.equal(opts.serviceWorkers, 'block'); return context; }, close: async () => { events.push('close'); if (closeFails) throw Error('fail'); } }; }, sleep: async ms => assert.equal(ms, 5000), saveImage: async name => images.push(name), saveReport: async r => reports.push(r), ttfb: async () => { throw Error('unexpected_network'); } };
  return { deps, events, reports, images };
}
test('quota cannot be proven: no launch or network; termination is honestly recorded', async () => {
  const m = mocks({ quota: false }); const report = await capture(config, m.deps);
  assert.equal(report.error, 'global_quota_unproven'); assert.ok(!m.events.includes('launch')); assert.equal(report.closed, false); assert.equal(report.endedAt, 'mock-clock');
});
test('mock capture saves only verified bounded unreviewed images and closes browser', async () => {
  const m = mocks(); const r = await capture(config, m.deps);
  assert.equal(r.status, 'captured-unreviewed'); assert.equal(r.closed, true); assert.equal(r.pages.length, 2); assert.ok(m.events.indexOf('route') < m.events.indexOf('newPage')); assert.ok(m.events.indexOf('newPage') < m.events.indexOf('goto'));
  assert.deepEqual(r.pages.map(row => row.pathname), ['/', '/articles/']);
});
test('identity mismatch or high per-page load saves no image and still closes', async () => {
  for (const settings of [{ badIdentity: true }, { hotPage: true }]) {
    const m = mocks(settings); const r = await capture(config, m.deps); assert.equal(m.images.length, 0); assert.equal(r.closed, true); assert.equal(r.status, 'stopped');
  }
});
test('failed close never fabricates browserClosed=true', async () => {
  const m = mocks({ closeFails: true }); const r = await capture(config, m.deps); assert.equal(r.closed, false); assert.equal(r.closeAt, null); assert.equal(r.error, 'browser_close_failed');
});
test('formal three-site TTFB failure blocks launch without any real HTTP', async () => {
  const m = mocks(); m.deps.ttfb = async () => [{ host: 'blog.observe.tw', seconds: 2.01, status: 200 }, { host: 'tag.observe.tw', seconds: 1, status: 200 }, { host: 'youtube.observe.tw', seconds: 1, status: 200 }];
  const r = await capture({ ...config, targetOrigin: 'https://blog.observe.tw' }, m.deps);
  assert.equal(r.error, 'ttfb_gate'); assert.ok(!m.events.includes('launch')); assert.equal(r.closed, false); assert.equal(r.gates.at(-1).phase, 'after');
});
test('false quota receipt remains fail closed', async () => {
  const m = mocks(); m.deps.acquireGlobalQuota = async () => ({ assertHeld: async () => false, release: async () => {} });
  const r = await capture(config, m.deps); assert.equal(r.error, 'global_quota_unproven'); assert.ok(!m.events.includes('launch'));
});
test('report omits request query, headers and credentials', async () => {
  const m = mocks(); const r = await capture({ ...config, pages: [{ path: '/topics/test/?q=private-value', width: 390 }] }, m.deps);
  assert.equal(r.pages[0].pathname, '/topics/test/'); assert.ok(!JSON.stringify(r).includes('private-value')); assert.ok(!JSON.stringify(r).includes('headers'));
});


test('operator pause refuses CLI capture before reading even a nonexistent plan', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cli = fileURLToPath(new URL('./ui-capture.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--capture', '/not-a-real-ui-capture-plan.json'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'capture_paused_by_operator');
});
