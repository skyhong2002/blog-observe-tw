import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { capture, verifyPrivateArtifactDirectory, verifyLatencyGate, installGuards, LIMITS, plan, requestDecision, verifyGate, verifyIdentity, browserRootInventory, quotaLeaseFromProcess, localProcessIdentity, listenerInodes, acquireHostBrowserQuota, recordNetworkAttempt } from './ui-capture.mjs';

const config = { targetOrigin: 'http://127.0.0.1:18174', expectedSHA: 'a'.repeat(40), expectedBuildId: 'fixture-build', buildIdHeader: 'x-build-id', pages: [{ path: '/', width: 1280 }, { path: '/articles/', width: 390 }] };
const gate = { load: 1, browserRoots: 0, rawPgrepCount: 10, available: LIMITS.reserve + 100 * 1024 ** 2 };
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
  for (const patch of [{ load: 12.01 }, { load: NaN }, { browserRoots: 2 }, { browserRoots: NaN }, { available: LIMITS.reserve + 999 }])
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
function mocks({ badIdentity = false, quota = true, hotPage = false, closeFails = false, wrongTheme = false } = {}) {
  const events = [], reports = [], images = []; let gates = 0;
  const headers = { 'x-blog-release': badIdentity ? 'b'.repeat(40) : config.expectedSHA, 'x-build-id': config.expectedBuildId };
  let current, theme = 'light';
  const page = { emulateMedia: async options => { theme = options.colorScheme; }, addInitScript: async (fn, value) => assert.equal(value, theme), evaluate: async () => ({ theme: wrongTheme ? 'unexpected' : theme, darkMedia: theme === 'dark' }), close: async () => {}, on: () => {}, setViewportSize: async () => {}, goto: async url => { current = url; events.push('goto'); return { status: () => 200, allHeaders: async () => headers }; }, url: () => current, screenshot: async options => { assert.equal(options.fullPage, false); return Buffer.alloc(64); } };
  const context = { route: async () => events.push('route'), routeWebSocket: async () => events.push('ws'), addInitScript: async () => {}, newPage: async () => { events.push('newPage'); return page; } };
  const deps = { now: () => 'mock-clock', gate: async () => { gates++; return { ...gate, load: hotPage && gates === 3 ? 13 : 1 }; }, acquireGlobalQuota: async () => quota ? { assertHeld: async () => true, release: async () => events.push('release') } : null, launch: async () => { events.push('launch'); return { newContext: async opts => { assert.equal(opts.extraHTTPHeaders.DNT, '1'); assert.equal(opts.serviceWorkers, 'block'); return context; }, close: async () => { events.push('close'); if (closeFails) throw Error('fail'); } }; }, sleep: async ms => assert.equal(ms, 5000), saveImage: async name => images.push(name), saveReport: async r => reports.push(r), ttfb: async () => ['blog.observe.tw','tag.observe.tw','youtube.observe.tw'].map(host => ({host, totalSeconds: 0.2, ttfbSeconds: 0.2, status: 200})) };
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
test('formal three-site full-homepage failure blocks launch without any real HTTP', async () => {
  const m = mocks(); m.deps.ttfb = async () => [{ host: 'blog.observe.tw', totalSeconds: 6.01, ttfbSeconds: 6.01, status: 200 }, { host: 'tag.observe.tw', totalSeconds: 1, ttfbSeconds: 1, status: 200 }, { host: 'youtube.observe.tw', totalSeconds: 1, ttfbSeconds: 1, status: 200 }];
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


test('explicit thaw still refuses an invalid plan without launching or probing', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cli = fileURLToPath(new URL('./ui-capture.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--capture', '/not-a-real-ui-capture-plan.json'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'ui_capture_refused');
});

test('start reserve subtracts estimates; running stop reserve differs from start', async () => {
  verifyGate({ ...gate, available: LIMITS.reserve + 1000 }, 1000);
  const m = mocks(); let calls = 0;
  m.deps.gate = async () => ({ ...gate, available: ++calls <= 2 ? gate.available : 35 * 1024 ** 3 });
  assert.equal((await capture(config, m.deps)).status, 'captured-unreviewed');
  const stopped = mocks(); calls = 0;
  stopped.deps.gate = async () => ({ ...gate, available: ++calls <= 2 ? gate.available : LIMITS.stopReserve });
  assert.equal((await capture(config, stopped.deps)).error, 'page_gate');
  assert.equal(stopped.images.length, 0);
});
test('browser root inventory separates ten Chromium processes from one browser', () => {
  const rows = [{ pid: 100, ppid: 1, executable: 'chrome', args: ['chrome'] },
    ...Array.from({ length: 9 }, (_, i) => ({ pid: 101 + i, ppid: 100, executable: 'chrome', args: ['chrome', '--type=renderer'] }))];
  assert.deepEqual(browserRootInventory(rows), { browserRoots: 1, rootPids: [100], chromiumProcesses: 10 });
  verifyGate({ ...gate, rawPgrepCount: 10, ...browserRootInventory(rows) }, 1000);
  assert.throws(() => browserRootInventory([...rows, { pid: 120, ppid: 100, executable: 'chrome', args: [] }]), /ambiguous/);
});
test('bounded manifest preserves raw GA/GTM attempts without query or foreign URL', () => {
  const network = { attempted: 0, ga: 0, gtm: 0, analytics: 0, blocked: 0, requests: [], truncated: false };
  recordNetworkAttempt('https://www.googletagmanager.com/gtag/js?id=private', 'GET', 'script', 'analytics', network);
  for (let i = 0; i < 501; i++) recordNetworkAttempt('https://www.google-analytics.com/g/collect?secret=private', 'POST', 'fetch', 'analytics', network);
  recordNetworkAttempt('https://foreign.test/private/path?secret=private', 'GET', 'image', 'external', network);
  assert.equal(network.ga, 501); assert.equal(network.gtm, 1); assert.equal(network.attempted, 503);
  assert.equal(network.requests.length, 500); assert.equal(network.truncated, true);
  assert.ok(!JSON.stringify(network).includes('private')); assert.ok(!JSON.stringify(network).includes('foreign.test'));
});
function fakeHolder(token, pid, onExit = () => {}, busy = false) {
  const child = new EventEmitter(); child.pid = pid; child.exitCode = null;
  child.stdout = new PassThrough(); child.stdin = new PassThrough();
  const exit = code => { if (child.exitCode !== null) return; child.exitCode = code; onExit(); child.emit('exit', code); child.stdout.end(); };
  child.kill = () => exit(143);
  child.stdin.on('data', chunk => { const msg = JSON.parse(String(chunk)); child.stdout.write(JSON.stringify({ ...msg, pid, start: '123' }) + '\n'); });
  child.stdin.on('finish', () => exit(0));
  queueMicrotask(() => busy ? exit(1) : child.stdout.write(JSON.stringify({ id: 'ready', token, pid, start: '123' }) + '\n'));
  return child;
}
test('live quota challenge rejects PID reuse and drains on release', async () => {
  let start = '123'; const child = fakeHolder('token', 123);
  const lease = await quotaLeaseFromProcess(child, 'token', async () => start);
  assert.equal(await lease.assertHeld(), true); assert.equal(lease.receipt.unmanagedThreadsEnforced, false);
  start = '456'; assert.equal(await lease.assertHeld(), false);
  await lease.release(); assert.equal(child.exitCode, 0); assert.equal(await lease.assertHeld(), false);
});
test('flock adapter uses two persistent slots and fails closed at capacity (mock protocol)', async () => {
  const held = new Set(), commands = []; let pid = 1000;
  const deps = {
    mkdir: async () => {}, open: async () => ({ close: async () => {} }), readStart: async () => '123',
    lstat: async path => ({ isDirectory: () => !path.endsWith('.lock'), isFile: () => path.endsWith('.lock'), isSymbolicLink: () => false, uid: process.getuid(), mode: path.endsWith('.lock') ? 0o600 : 0o700 }),
    spawn: (command, args) => {
      commands.push([command, ...args]); const path = args[3], busy = held.has(path);
      if (!busy) held.add(path);
      return fakeHolder(args.at(-1), ++pid, () => { if (!busy) held.delete(path); }, busy);
    },
  };
  const first = await acquireHostBrowserQuota(deps), second = await acquireHostBrowserQuota(deps);
  assert.equal(first.receipt.slot, 0); assert.equal(second.receipt.slot, 1);
  await assert.rejects(acquireHostBrowserQuota(deps), /global_quota_full/);
  assert.ok(commands.every(row => row[0] === 'flock' && row[1] === '--exclusive' && row[2] === '--nonblock' && row[3] === '--no-fork'));
  await first.release(); const replacement = await acquireHostBrowserQuota(deps);
  assert.equal(replacement.receipt.slot, 0); await second.release(); await replacement.release(); assert.equal(held.size, 0);
});
function identityFixture(patch = {}) {
  const localConfig = { ...config, targetOrigin: 'http://127.0.0.1:18176', buildIdHeader: undefined,
    localIdentity: { nextPid: 42, nextPort: 18177, gatewayPid: 43, gatewayPort: 18176, releaseDir: '/fixture/release', repositoryDir: '/fixture/repo' } };
  const stat = pid => `${pid} (server) ${Array.from({ length: 20 }, (_, i) => i === 19 ? '123' : '0').join(' ')}`;
  const tcp = 'header\n0: 0100007F:4701 00000000:0000 0A 0 0 0 0 0 100\n1: 0100007F:4700 00000000:0000 0A 0 0 0 0 0 200\n';
  const files = {
    '/proc/42/stat': stat(42), '/proc/43/stat': stat(43), '/fixture/release/web/.next/BUILD_ID': config.expectedBuildId,
    '/proc/42/net/tcp': tcp, '/proc/43/net/tcp': tcp, '/proc/42/net/tcp6': 'header', '/proc/43/net/tcp6': 'header',
    '/proc/42/environ': 'SECRET=never-emit-this\0BLOG_GATEWAY_INTERNAL_URL=http://127.0.0.1:18176\0',
    '/proc/43/environ': 'SECRET=never-emit-this\0BLOG_UI_ORIGIN=http://127.0.0.1:18177\0', ...patch,
  };
  const deps = { readFile: async path => { if (!(path in files)) throw Error('fixture_missing'); return files[path]; }, readdir: async () => ['8'],
    readlink: async path => path.startsWith('/proc/42/') ? 'socket:[100]' : 'socket:[200]',
    realpath: async path => path === '/proc/42/cwd' ? '/fixture/release/web' : path === '/proc/43/cwd' ? '/fixture/release' : path };
  return { localConfig, deps, tcp };
}
test('candidate identity proves gateway and Next socket ownership, wiring and actual build ID', async () => {
  const f = identityFixture(); assert.deepEqual(listenerInodes(f.tcp, 18176), ['200']);
  const receipt = await localProcessIdentity(f.localConfig, f.deps);
  assert.equal(receipt.gatewayPid, 43); assert.equal(receipt.nextPid, 42);
  assert.equal(receipt.gatewayUiOrigin, 'http://127.0.0.1:18177'); assert.equal(receipt.nextGatewayOrigin, 'http://127.0.0.1:18176');
  assert.ok(!JSON.stringify(receipt).includes('never-emit')); assert.equal(plan(f.localConfig).pages.length, 2);
  for (const patch of [
    { '/fixture/release/web/.next/BUILD_ID': 'wrong-build' },
    { '/proc/42/environ': 'BLOG_GATEWAY_INTERNAL_URL=http://127.0.0.1:18175\0' },
    { '/proc/43/net/tcp': 'header' },
  ]) { const bad = identityFixture(patch); await assert.rejects(localProcessIdentity(bad.localConfig, bad.deps)); }
  const bad = identityFixture(); bad.deps.realpath = async path => path === '/proc/42/cwd' ? '/elsewhere' : path;
  await assert.rejects(localProcessIdentity(bad.localConfig, bad.deps), /cwd/);
});
test('local receipt replaces headers without fabricating them; changed PID blocks screenshot', async () => {
  const f = identityFixture(), receipt = await localProcessIdentity(f.localConfig, f.deps);
  const m = mocks({ badIdentity: true }); m.deps.verifyLocalArchive = async () => ({ ...receipt, sha: config.expectedSHA, verifiedFiles: 100, sourceTreeHash: 'c'.repeat(40) });
  m.deps.verifyLocalProcess = async () => receipt;
  assert.equal((await capture(f.localConfig, m.deps)).status, 'captured-unreviewed');
  const bad = mocks(); bad.deps.verifyLocalArchive = m.deps.verifyLocalArchive; bad.deps.verifyLocalProcess = async () => ({ ...receipt, nextStart: '999' });
  assert.equal((await capture(f.localConfig, bad.deps)).error, 'identity_unverified'); assert.equal(bad.images.length, 0);
});
test('failed candidate latency gate does not run a second probe or launch', async () => {
  const m = mocks(); let probes = 0;
  m.deps.ttfb = async () => { probes++; return [{ status: 200, totalSeconds: 8, ttfbSeconds: 8 }]; };
  assert.equal((await capture(config, m.deps)).error, 'ttfb_gate'); assert.equal(probes, 1); assert.ok(!m.events.includes('launch'));
});

test('light and dark are applied and observed, not inferred from screenshot filenames', async () => {
  const m = mocks();
  const r = await capture({ ...config, pages: [{ path: '/', width: 1280, theme: 'light' }, { path: '/', width: 390, theme: 'dark' }] }, m.deps);
  assert.equal(r.status, 'captured-unreviewed');
  assert.deepEqual(r.pages.map(row => [row.theme, row.darkMedia]), [['light', false], ['dark', true]]);
  assert.match(r.pages[1].name, /390-dark/);
  assert.match(r.network.limitation, /External images/);
  assert.throws(() => plan({ ...config, pages: [{ path: '/', width: 390, theme: 'automatic' }] }), /invalid_theme/);
});

test('a page that does not apply the requested theme is not saved', async () => {
  const m = mocks({ wrongTheme: true });
  assert.equal((await capture(config, m.deps)).error, 'theme_unverified');
  assert.equal(m.images.length, 0);
});

test('site-specific full-response gates accept blog 6s and tag/youtube 2s, reject unknown/duplicate/missing receipts', () => {
  const rows = [{ host: 'blog.observe.tw', status: 200, ttfbSeconds: 0.1, totalSeconds: 6 }, { host: 'tag.observe.tw', status: 200, ttfbSeconds: 0.1, totalSeconds: 2 }, { host: 'youtube.observe.tw', status: 200, ttfbSeconds: 0.1, totalSeconds: 2 }];
  verifyLatencyGate(rows);
  for (let i=0;i<3;i++) assert.throws(() => verifyLatencyGate(rows.map((row,j)=>({...row, totalSeconds: row.totalSeconds+(i===j?0.001:0)}))), /ttfb_gate/);
  assert.throws(() => verifyLatencyGate([rows[0],rows[0],rows[2]]), /ttfb_gate/);
  assert.throws(() => verifyLatencyGate(rows.map(row=>({...row,totalSeconds:undefined}))), /ttfb_gate/);
});

test('private artifact directory rejects existing public permissions, wrong owner and symlink', () => {
 const info={isDirectory:()=>true,isSymbolicLink:()=>false,uid:42,mode:0o700};
 verifyPrivateArtifactDirectory(info,42);
 for(const patch of [{mode:undefined},{mode:0o777},{uid:43},{isSymbolicLink:()=>true},{isDirectory:()=>false}]) assert.throws(()=>verifyPrivateArtifactDirectory({...info,...patch},42),/private_artifact_dir_required/);
});
test('after latency failure is preserved and stops completion after honestly closing browser', async () => {
 const m=mocks();let calls=0;
 m.deps.ttfb=async()=>['blog.observe.tw','tag.observe.tw','youtube.observe.tw'].map(host=>({host,status:200,ttfbSeconds:0.2,totalSeconds:++calls>3&&host==='blog.observe.tw'?6.01:0.2}));
 const r=await capture(config,m.deps);
 assert.equal(r.afterGateError,'ttfb_gate');assert.equal(r.error,'after_ttfb_gate');assert.equal(r.status,'stopped');assert.equal(r.closed,true);assert.equal(r.pages.length,2);
});

test('fast TTFB with slow complete body is refused at full-homepage threshold', () => {
 const rows=['blog.observe.tw','tag.observe.tw','youtube.observe.tw'].map(host=>({host,status:200,ttfbSeconds:0.01,totalSeconds:0.2}));
 for(const [host,limit] of [['blog.observe.tw',6],['tag.observe.tw',2],['youtube.observe.tw',2]]) assert.throws(()=>verifyLatencyGate(rows.map(row=>({...row,totalSeconds:row.host===host?limit+0.001:0.2}))),/ttfb_gate/);
});
