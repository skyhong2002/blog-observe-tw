import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { capture, observePrivacy, requireDNT, assessContrast, collectSecondaryContrastDOM, verifyPrivateArtifactDirectory, verifyLatencyGate, installGuards, LIMITS, plan, requestDecision, verifyGate, verifyIdentity, browserRootInventory, quotaLeaseFromProcess, localProcessIdentity, listenerInodes, acquireHostBrowserQuota, recordNetworkAttempt, recordNetworkOutcome, NETWORK_GUARD_RULES, privateCapturePath, globalHomepageProbe, processInventory } from './ui-capture.mjs';

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
  await installGuards({ on: () => {}, route: async (pattern, fn) => { calls.push(pattern); handler = fn; }, routeWebSocket: async pattern => calls.push(`ws:${pattern}`), addInitScript: async () => calls.push('init') }, config.targetOrigin, counters);
  const actions = [];
  await handler({ request: () => ({ url: () => 'https://www.google-analytics.com/g/collect?secret=private', method: () => 'GET' }), abort: async () => actions.push('abort'), continue: async () => actions.push('continue') });
  assert.deepEqual(calls, ['**/*', 'ws:**/*', 'init']); assert.deepEqual(actions, ['abort']); assert.deepEqual(counters, { analytics: 1, external: 0 });
});
function mocks({ badIdentity = false, quota = true, hotPage = false, closeFails = false, wrongTheme = false, documentDNT = '1', navigatorDNT = '1', documentGPC = null, navigatorGPC = null } = {}) {
  const events = [], reports = [], images = []; let gates = 0;
  const headers = { 'x-blog-release': badIdentity ? 'b'.repeat(40) : config.expectedSHA, 'x-build-id': config.expectedBuildId };
  let current, theme = 'light';
  const page = { emulateMedia: async options => { theme = options.colorScheme; }, addInitScript: async (_fn, value) => assert.equal(value, theme), evaluate: async fn => fn === collectSecondaryContrastDOM ? [] : String(fn).includes('globalPrivacyControl') ? {doNotTrack:navigatorDNT,globalPrivacyControl:navigatorGPC} : ({ theme: wrongTheme ? 'unexpected' : theme, darkMedia: theme === 'dark' }), close: async () => {}, on: () => {}, setViewportSize: async () => {}, goto: async url => { current = url; events.push('goto'); return { status: () => 200, allHeaders: async () => headers, request: () => ({headerValue: async name => name === 'dnt' ? documentDNT : documentGPC}) }; }, url: () => current, screenshot: async options => { assert.equal(options.fullPage, false); return Buffer.alloc(64); } };
  const context = { on: () => {}, route: async () => events.push('route'), routeWebSocket: async () => events.push('ws'), addInitScript: async () => {}, newPage: async () => { events.push('newPage'); return page; } };
  const deps = { now: () => 'mock-clock', gate: async () => { gates++; return { ...gate, load: hotPage && gates === 3 ? 13 : 1 }; }, acquireGlobalQuota: async () => quota ? { assertHeld: async () => true, release: async () => events.push('release') } : null, launch: async () => { events.push('launch'); return { newContext: async opts => { assert.equal(opts.extraHTTPHeaders.DNT, '1'); assert.equal(opts.serviceWorkers, 'block'); return context; }, close: async () => { events.push('close'); if (closeFails) throw Error('fail'); } }; }, sleep: async ms => assert.equal(ms, 5000), saveImage: async name => images.push(name), saveReport: async r => reports.push(r), ttfb: async () => ['blog.observe.tw','tag.observe.tw','youtube.observe.tw'].map(host => ({host, totalSeconds: 0.2, ttfbSeconds: 0.2, status: 200})) };
  return { deps, events, reports, images, context };
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
  const m = mocks(); m.deps.ttfb = async () => [{ host: 'blog.observe.tw', totalSeconds: 6.18, ttfbSeconds: 0.01, status: 200 }, { host: 'tag.observe.tw', totalSeconds: 1, ttfbSeconds: 1, status: 200 }, { host: 'youtube.observe.tw', totalSeconds: 1, ttfbSeconds: 1, status: 200 }];
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
  const rows = [{ pid: 100, ppid: 1, executable: 'chrome', startTicks: '1', args: ['chrome'] },
    ...Array.from({ length: 9 }, (_, i) => ({ pid: 101 + i, ppid: 100, executable: 'chrome', startTicks: String(2+i), args: ['chrome', '--type=renderer'] }))];
  assert.deepEqual(browserRootInventory(rows), { browserRoots: 1, rootPids: [100], chromiumProcesses: 10 });
  verifyGate({ ...gate, rawPgrepCount: 10, ...browserRootInventory(rows) }, 1000);
  assert.equal(browserRootInventory([...rows, { pid: 120, ppid: 100, executable: 'chrome', startTicks: '20', args: [] }]).browserRoots, 1);
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

test('relative full-response gates accept blog 6.17s and tag/youtube 2s, reject unknown/duplicate/missing receipts', () => {
  const rows = [{ host: 'blog.observe.tw', status: 200, ttfbSeconds: 0.1, totalSeconds: 6.17 }, { host: 'tag.observe.tw', status: 200, ttfbSeconds: 0.1, totalSeconds: 2 }, { host: 'youtube.observe.tw', status: 200, ttfbSeconds: 0.1, totalSeconds: 2 }];
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
 m.deps.ttfb=async()=>['blog.observe.tw','tag.observe.tw','youtube.observe.tw'].map(host=>({host,status:200,ttfbSeconds:0.2,totalSeconds:++calls>3&&host==='blog.observe.tw'?6.18:0.2}));
 const r=await capture(config,m.deps);
 assert.equal(r.afterGateError,'ttfb_gate');assert.equal(r.error,'after_ttfb_gate');assert.equal(r.status,'stopped');assert.equal(r.closed,true);assert.equal(r.pages.length,2);
});

test('fast TTFB with slow complete body is refused at full-homepage threshold', () => {
 const rows=['blog.observe.tw','tag.observe.tw','youtube.observe.tw'].map(host=>({host,status:200,ttfbSeconds:0.01,totalSeconds:0.2}));
 for(const [host,limit] of [['blog.observe.tw',6.17],['tag.observe.tw',2],['youtube.observe.tw',2]]) assert.throws(()=>verifyLatencyGate(rows.map(row=>({...row,totalSeconds:row.host===host?limit+0.001:0.2}))),/ttfb_gate/);
});


test('headless_shell and chrome-headless-shell roots close launch gate; typed children do not add browsers', async () => {
  const first = [{ pid: 100, ppid: 1, executable: 'headless_shell', startTicks: '10', args: ['/fixture/headless_shell'] },
    { pid: 101, ppid: 100, executable: 'headless_shell', startTicks: '10', args: ['headless_shell', '--type=renderer'] },
    { pid: 102, ppid: 100, executable: 'headless_shell', startTicks: '10', args: ['headless_shell', '--type', 'gpu-process'] }];
  const second = [{ pid: 200, ppid: 1, executable: 'chrome-headless-shell', startTicks: '10', args: ['/fixture/chrome-headless-shell'] },
    { pid: 201, ppid: 200, executable: 'chrome-headless-shell', startTicks: '10', args: ['chrome-headless-shell', '--type=utility'] }];
  assert.deepEqual(browserRootInventory(first), { browserRoots: 1, rootPids: [100], chromiumProcesses: 3 });
  verifyGate({ ...gate, ...browserRootInventory(first) }, 1000);
  const inventory = browserRootInventory([...first, ...second]);
  assert.deepEqual(inventory, { browserRoots: 2, rootPids: [100, 200], chromiumProcesses: 5 });
  const m = mocks(); let probes = 0;
  m.deps.gate = async () => ({ ...gate, ...inventory });
  m.deps.ttfb = async () => { probes++; return []; };
  const result = await capture(config, m.deps);
  assert.equal(result.error, 'gate_closed');
  assert.equal(result.closed, false);
  assert.equal(probes, 0);
  assert.ok(!m.events.includes('launch'));
  assert.equal(m.images.length, 0);
  assert.equal(browserRootInventory([...first, { pid: 103, ppid: 100, executable: 'headless_shell', startTicks: '10', args: ['headless_shell'] }]).browserRoots, 1);
});


test('process scan trusts real exe basename despite rewritten argv0 and avoids unrelated exe permissions', async () => {
  const links = [];
  const files = {
    '/proc/100/comm': 'headless_shell\n', '/proc/101/comm': 'headless_shell\n',
    '/proc/200/comm': 'chrome-headless\n', '/proc/300/comm': 'node\n',
    '/proc/100/cmdline': '/proc/self/exe\0', '/proc/101/cmdline': '/proc/self/exe\0--type=renderer\0',
    '/proc/200/cmdline': 'rewritten-name\0',
    '/proc/100/stat': '100 (headless_shell) S 1 '+Array(17).fill('0').join(' ')+' 10', '/proc/101/stat': '101 (headless_shell) S 100 '+Array(17).fill('0').join(' ')+' 11',
    '/proc/200/stat': '200 (chrome-headless) S 1 '+Array(17).fill('0').join(' ')+' 10',
  };
  const inventory = await processInventory({ exec: async () => ({ stdout: '3\n' }), readdir: async () => ['100','101','200','300','self'],
    readFile: async path => { assert.ok(Object.hasOwn(files,path), path); return files[path]; },
    readlink: async path => { links.push(path); if(path.includes('/300/'))throw Object.assign(Error('denied'),{code:'EACCES'}); return path.includes('/200/') ? '/fixture/chrome-headless-shell' : '/fixture/headless_shell'; } });
  assert.equal(inventory.browserRoots,2);assert.equal(inventory.chromiumProcesses,3);
  assert.deepEqual(inventory.rootPids,[100,200]);assert.ok(!links.includes('/proc/300/exe'));
  assert.throws(()=>verifyGate({...gate,...inventory},1000),/gate_closed/);
});
test('suspected headless browser unreadable executable fails closed', async () => {
  await assert.rejects(processInventory({ exec: async()=>({stdout:'1\n'}), readdir: async()=>['100'], readFile: async()=> 'headless_shell\n', readlink: async()=>{throw Object.assign(Error('denied'),{code:'EACCES'});} }),/process_inventory_unavailable/);
});


test('duplicate headless identity stops and privately reports only bounded safe process fields', async () => {
  const rows = [{ pid:100, ppid:1, executable:'headless_shell', comm:'headless_shell', startTicks:'987', args:['/private/NEVER_LOG','--token=NEVER_LOG'] },
    { pid:100, ppid:1, executable:'headless_shell', comm:'headless_shell', startTicks:'988', args:['/proc/self/exe'] }];
  const m=mocks();m.deps.gate=async()=>browserRootInventory(rows);
  const report=await capture(config,m.deps);
  assert.equal(report.error,'browser_pid_duplicate');assert.equal(report.pages.length,0);assert.ok(!m.events.includes('launch'));
  assert.deepEqual(report.processDiagnostics[0].rows,[
    {pid:100,ppid:1,executable:'headless_shell',comm:'headless_shell',hasType:false,argCount:2,startTicks:'987'},
    {pid:100,ppid:1,executable:'headless_shell',comm:'headless_shell',hasType:false,argCount:1,startTicks:'988'}]);
  assert.equal(report.processDiagnostics.at(-1).phase,'after');
  assert.ok(!JSON.stringify(report).includes('NEVER_LOG'));assert.ok(!JSON.stringify(report).includes('/proc/self/exe'));
  assert.throws(()=>browserRootInventory([...rows,...Array.from({length:130},(_,i)=>({pid:200+i,ppid:1,executable:'headless_shell',comm:'headless_shell',args:[],startTicks:'999'}))]), error=>{
    assert.equal(error.processDiagnostics.length,128);assert.equal(error.processDiagnosticsTruncated,true);return error.message==='browser_pid_duplicate';});
});


test('actual six-process headless ancestry is one root despite argv-only cmdline; two trees block launch', async () => {
  const rows = [[1460454,1460190,'422900114'],[1460456,1460454,'422900125'],[1460457,1460454,'422900125'],[1460471,1460456,'422900131'],[1460475,1460454,'422900133'],[1460504,1460457,'422900139']].map(([pid,ppid,startTicks])=>({pid,ppid,startTicks,executable:'chrome-headless-shell',comm:'chrome-headless',args:['/proc/self/exe']}));
  assert.deepEqual(browserRootInventory(rows),{browserRoots:1,rootPids:[1460454],chromiumProcesses:6});
  const twoTrees=[...rows,{pid:2000000,ppid:1900000,startTicks:'422900200',executable:'headless_shell',args:['/proc/self/exe','--type=renderer']}];
  const inventory=browserRootInventory(twoTrees);assert.equal(inventory.browserRoots,2);assert.equal(inventory.chromiumProcesses,7);
  const m=mocks();m.deps.gate=async()=>({...gate,...inventory});const report=await capture(config,m.deps);
  assert.equal(report.error,'gate_closed');assert.equal(m.images.length,0);assert.ok(!m.events.includes('launch'));
});
test('ancestry cycle, repeated PID, newer parent and missing start proof all fail closed', () => {
  const row=(pid,ppid,startTicks='10')=>({pid,ppid,startTicks,executable:'headless_shell',args:['/proc/self/exe']});
  for(const [rows,reason]of [[[row(100,101),row(101,100)],'browser_ancestry_cycle'],[[row(100,1),row(100,1)],'browser_pid_duplicate'],[[row(100,1,'20'),row(101,100,'10')],'browser_parent_identity_changed'],[[{...row(100,1),startTicks:undefined}],'process_inventory_unavailable']]) assert.throws(()=>browserRootInventory(rows),error=>error.message===reason&&Array.isArray(error.processDiagnostics));
  const orphan={...row(100,999),'args':['/proc/self/exe','--type=renderer']};
  assert.deepEqual(browserRootInventory([orphan]),{browserRoots:1,rootPids:[100],chromiumProcesses:1});
});

test('actual DNT receipt is required before saving and GPC true/false/null is not invented', async()=>{
 for(const options of [{documentDNT:null},{documentDNT:'0'},{navigatorDNT:null},{navigatorDNT:'0'}]) { const m=mocks(options),r=await capture(config,m.deps);assert.equal(r.error,'privacy_unverified');assert.equal(m.images.length,0);assert.equal(r.closed,true);assert.equal(r.privacyObservations.length,1); }
 for(const value of [true,false,null]) { const m=mocks({navigatorGPC:value,documentGPC:value===true?'1':null}),r=await capture(config,m.deps);assert.equal(r.pages[0].privacy.navigatorGPC,value);assert.equal(r.pages[0].privacy.documentSecGPC,value===true?'1':null); }
});
test('privacy reads only DNT/Sec-GPC via headerValue, never bulk sensitive headers',async()=>{
 const names=[];const privacy=await observePrivacy({headerValue:async name=>{names.push(name);return name==='dnt'?'1':'0';},allHeaders:()=>{throw Error('must_not_read');}}, {doNotTrack:'1',globalPrivacyControl:false});
 assert.deepEqual(names,['dnt','sec-gpc']);assert.deepEqual(privacy,{documentDNT:'1',documentSecGPC:'0',navigatorDNT:'1',navigatorDoNotTrack:true,navigatorGPC:false});requireDNT(privacy);assert.ok(!JSON.stringify(privacy).includes('headers'));
});
const contrastFixture = patch=>({ordinal:1,tagName:'SPAN',classes:['text-zinc-500'],fontSize:16,fontWeight:400,foreground:'rgb(0, 0, 0)',opacity:1,backgrounds:[{color:'rgb(255, 255, 255)',image:'none',opacity:1}],...patch});
test('known WCAG ratios and transparent layered backgrounds are computed without content',()=>{
 const result=assessContrast(contrastFixture({}));assert.equal(result.ratio,21);assert.equal(result.threshold,4.5);assert.equal(result.result,'pass-sample');
 const low=assessContrast(contrastFixture({foreground:'rgb(180, 180, 180)'}));assert.ok(low.ratio<4.5);assert.equal(low.result,'fail-sample');
 const large=assessContrast(contrastFixture({fontSize:24}));assert.equal(large.threshold,3);
 const layered=assessContrast(contrastFixture({backgrounds:[{color:'rgb(255, 255, 255)',image:'none',opacity:1},{color:'rgba(0, 0, 0, 0.5)',image:'none',opacity:1}]}));assert.ok(layered.ratio>5&&layered.ratio<6);assert.deepEqual(layered.composedBackground,[0.5,0.5,0.5,1]);
 assert.ok(!JSON.stringify(result).includes('textContent'));
});
test('unsupported colors, unresolved alpha, images and group opacity remain unknown',()=>{
 for(const patch of [{foreground:'oklch(0.7 0.1 40)'},{backgrounds:[{color:'transparent',image:'none',opacity:1}]},{backgrounds:[{color:'rgb(255, 255, 255)',image:'linear-gradient(red,blue)',opacity:1}]},{backgrounds:[{color:'rgb(255, 255, 255)',image:'none',opacity:0.5}]}]) { const sample=assessContrast(contrastFixture(patch));assert.equal(sample.result,'unknown');assert.equal(sample.ratio,null); }
});

test('DOM contrast sample is bounded/visible and never reads text or copies image URL',()=>{
 const saved=new Map();const style={fontSize:'14px',fontWeight:'400',color:'rgb(110, 110, 110)',opacity:'1',visibility:'visible',backgroundColor:'rgb(255, 255, 255)',backgroundImage:'none'};
 const elements=Array.from({length:30},(_,i)=>({tagName:'SPAN',classList:['text-zinc-500','do-not-record-private-class'],parentElement:null,getBoundingClientRect:()=>({width:20,height:20,left:0,right:20,top:i===0?-40:10,bottom:i===0?-20:30}),get textContent(){throw Error('text_must_not_be_read');},get title(){throw Error('title_must_not_be_read');},style:{...style,backgroundImage:i===1?'url(https://private.example/secret-image)':'none'}}));
 const globals={document:{querySelectorAll:()=>elements},innerWidth:390,innerHeight:900,getComputedStyle:e=>e.style};
 try{for(const[k,v]of Object.entries(globals)){saved.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true});}const rows=collectSecondaryContrastDOM();assert.equal(rows.length,20);assert.equal(rows[0].ordinal,1);assert.deepEqual(rows[0].classes,['text-zinc-500']);assert.equal(rows[0].backgrounds[0].image,'unsupported');assert.ok(!JSON.stringify(rows).includes('private'));assert.equal(assessContrast(rows[0]).result,'unknown');}finally{for(const[k,v]of saved)v?Object.defineProperty(globalThis,k,v):delete globalThis[k];}
});

test('manifest distinguishes configured privacy, observed document privacy and pre-navigation installed guard', async () => {
  const m = mocks({ documentGPC: '1', navigatorGPC: true });
  const report = await capture(config, m.deps);
  assert.equal(report.guardSetup.status, 'installed');
  assert.equal(report.guardSetup.phase, 'before-newPage-and-first-navigation');
  assert.equal(report.guardSetup.installedAt, 'mock-clock');
  assert.ok(m.events.indexOf('route') < m.events.indexOf('newPage'));
  assert.ok(m.events.indexOf('ws') < m.events.indexOf('goto'));
  assert.equal(report.privacyConfiguration.documentDNT, '1');
  assert.equal(report.privacyConfiguration.documentSecGPC, 'not-configured');
  assert.equal(report.pages[0].privacy.documentSecGPC, '1');
  assert.equal(report.pages[0].privacy.navigatorGPC, true);
  assert.equal(report.pages[0].privacyObservation.source, 'actual-document-request-and-navigator');
  assert.equal(report.pages[0].privacyObservation.navigatorDNTSource, 'observed-value; init-script-override-configured');
  assert.deepEqual(report.expectedIdentity, { sha: config.expectedSHA, buildId: config.expectedBuildId });
  assert.equal(report.pages[0].identity.sha, config.expectedSHA);
  assert.equal(report.pages[0].identity.buildId, config.expectedBuildId);
});
test('missing WebSocket API fails closed before newPage or navigation', async () => {
  const m = mocks(); delete m.context.routeWebSocket;
  const report = await capture(config, m.deps);
  assert.equal(report.error, 'websocket_guard_unavailable');
  assert.equal(report.guardSetup.status, 'installing');
  assert.ok(!m.events.includes('newPage')); assert.ok(!m.events.includes('goto'));
  assert.equal(m.images.length, 0); assert.equal(report.closed, true);
});
test('host/scheme rules deny all analytics schemes and subdomains without matching deceptive suffixes', () => {
  assert.deepEqual(NETWORK_GUARD_RULES.allowedSchemes, ['http:', 'https:']);
  for (const scheme of ['http:', 'https:', 'ws:', 'wss:', 'ftp:']) {
    for (const root of NETWORK_GUARD_RULES.analyticsHostRoots) {
      assert.equal(requestDecision(`${scheme}//sub.${root}/secret?q=private`, config.targetOrigin), 'analytics');
      assert.equal(requestDecision(`${scheme}//${root}.attacker.test/`, config.targetOrigin), 'external');
    }
  }
  for (const scheme of ['ws:', 'wss:', 'ftp:', 'blob:', 'data:']) assert.notEqual(requestDecision(`${scheme}//127.0.0.1:18174/x`, config.targetOrigin), 'allow');
});
function guardMocks() {
  const context = { on: (event, cb) => { context.events[event] = cb; }, events: {}, close: async () => { context.closed = true; }, route: async (_, cb) => { context.http = cb; }, routeWebSocket: async (_, cb) => { context.ws = cb; }, addInitScript: async () => {} };
  const network = { attempted: 0, ga: 0, gtm: 0, analytics: 0, blocked: 0, requests: [], truncated: false };
  return { context, network, counters: { analytics: 0, external: 0 } };
}
test('HTTP, WebSocket and GA/GTM outcomes count completed policy actions, HTTP errors and requestfailed separately', async () => {
  const m = guardMocks(); await installGuards(m.context, config.targetOrigin, m.counters, m.network);
  await m.context.http({ request: () => ({ url: () => `${config.targetOrigin}/assets.js`, method: () => 'GET', resourceType: () => 'script' }), continue: async () => {}, abort: async () => assert.fail('not denied') });
  await m.context.http({ request: () => ({ url: () => 'https://secret.google-analytics.com/collect?token=never-log', method: () => 'POST', resourceType: () => 'fetch' }), abort: async () => {}, continue: async () => assert.fail('GA is never allowed') });
  for (const url of ['wss://www.googletagmanager.com/ws?token=never-log', 'ws://127.0.0.1:18174/socket?token=never-log']) await m.context.ws({ url: () => url, close: async () => {} });
  m.context.events.response({ status: () => 404 }); m.context.events.response({ status: () => 200 }); m.context.events.requestfailed({});
  assert.deepEqual(m.network.http, { attempted: 2, denied: 1, blocked: 1, allowed: 1, actionFailures: 0, errorResponses: 1, requestFailures: 1 });
  assert.deepEqual(m.network.websocket, { attempted: 2, denied: 2, blocked: 2, allowed: 0, actionFailures: 0 });
  assert.equal(m.network.analyticsEvidence.attempted, 2); assert.equal(m.network.analyticsEvidence.blocked, 2); assert.equal(m.network.analyticsEvidence.allowed, 0);
  assert.equal(m.network.analyticsEvidence.ga.blocked, 1); assert.equal(m.network.analyticsEvidence.gtm.blocked, 1);
  assert.ok(!JSON.stringify(m.network).includes('never-log')); assert.ok(!JSON.stringify(m.network).includes('secret.'));
});
test('failed abort or WebSocket close is not recorded as blocked and closes only owned context', async () => {
  for (const kind of ['http', 'websocket']) {
    const m = guardMocks(); await installGuards(m.context, config.targetOrigin, m.counters, m.network);
    if (kind === 'http') await m.context.http({ request: () => ({ url: () => 'https://www.google-analytics.com/collect', method: () => 'POST' }), abort: async () => { throw Error('private diagnostic'); } });
    else await m.context.ws({ url: () => 'wss://www.google-analytics.com/socket', close: async () => { throw Error('private diagnostic'); } });
    assert.equal(m.network[kind].blocked, 0); assert.equal(m.network[kind].actionFailures, 1);
    assert.equal(m.network.analyticsEvidence.actionFailures, 1); assert.equal(m.network.guardFailures, 1); assert.equal(m.context.closed, true);
    assert.ok(!JSON.stringify(m.network).includes('private diagnostic'));
  }
});
test('network row truncation does not truncate completed HTTP/WS analytics counters', async () => {
  const m = guardMocks(); await installGuards(m.context, config.targetOrigin, m.counters, m.network);
  for (let i = 0; i < 503; i++) await m.context.ws({ url: () => 'wss://www.google-analytics.com/socket?secret=not-stored', close: async () => {} });
  assert.equal(m.network.requests.length, 500); assert.equal(m.network.truncated, true);
  assert.equal(m.network.websocket.attempted, 503); assert.equal(m.network.websocket.blocked, 503);
  assert.equal(m.network.analyticsEvidence.ga.attempted, 503); assert.equal(m.network.analyticsEvidence.ga.blocked, 503); assert.equal(m.network.analyticsEvidence.ga.allowed, 0);
});
test('unknown WebSocket URL is an enforcement failure and never fake zero-GA evidence', async () => {
  const m = guardMocks(); await installGuards(m.context, config.targetOrigin, m.counters, m.network);
  await m.context.ws({ close: async () => {} });
  assert.equal(m.network.websocket.attempted, 1); assert.equal(m.network.guardFailures, 1); assert.equal(m.context.closed, true);
});
test('analytics permitted outcome is distinguishable from attempted and denied counters', () => {
  const m = guardMocks(); recordNetworkAttempt('https://www.google-analytics.com/collect', 'GET', 'fetch', 'allow', m.network);
  recordNetworkOutcome('https://www.google-analytics.com/collect','http','allowed',m.network);
  assert.equal(m.network.analyticsEvidence.attempted, 1); assert.equal(m.network.analyticsEvidence.denied, 0); assert.equal(m.network.analyticsEvidence.allowed, 1); assert.equal(m.network.analyticsEvidence.ga.allowed, 1);
});
test('failed network enforcement leaves a stopped manifest and never saves or claims outbound-safe success', async () => {
  const m = mocks(); m.context.close = async () => { m.events.push('contextClose'); };
  m.context.route = async (_, callback) => callback({ request: () => ({ url: () => 'https://www.google-analytics.com/collect', method: () => 'POST' }), abort: async () => { throw Error('secret failure'); } });
  const report = await capture(config,m.deps);
  assert.equal(report.status,'stopped'); assert.equal(report.error,'network_guard_unverified');
  assert.equal(report.network.analyticsEvidence.blocked,0); assert.equal(report.network.analyticsEvidence.actionFailures,1);
  assert.ok(!m.events.includes('newPage')); assert.ok(!m.events.includes('goto')); assert.equal(m.images.length,0);
  assert.equal(report.closed,true); assert.ok(!JSON.stringify(report).includes('secret failure'));
});

test('private route deny is case-insensitive and checks safe decoded/dot variants for plans and requests', () => {
  for (const path of ['/ADMIN/', '/Auth/google', '/LOGIN', '/MY/', '/Me;', '/%61dmin/', '/%2561dmin/', '/x/%2e%2e/%6dy/', '/%2fadmin/', '/%zz']) {
    assert.equal(privateCapturePath(path),true);
    assert.equal(requestDecision(config.targetOrigin+path,config.targetOrigin),'external');
    assert.throws(()=>plan({...config,pages:[{path,width:390}]}));
  }
  assert.equal(privateCapturePath('/articles/'),false); assert.equal(privateCapturePath('/assets/my-icon.svg'),false);
});
test('candidate and formal captures retain the same required independent Node global HTML gate receipts', async () => {
  for(const targetOrigin of [config.targetOrigin,'https://blog.observe.tw']){
    const m=mocks();const r=await capture({...config,targetOrigin},m.deps);
    assert.equal(r.globalHomepageProbes.length,2);
    for(const receipt of r.globalHomepageProbes){assert.equal(receipt.status,'passed');assert.equal(receipt.configuredDNT,'1');assert.equal(receipt.observedRequestDNT,null);assert.equal(receipt.browserNetworkIncluded,false);assert.equal(receipt.eventsSource,'dependency-result-only');assert.equal(receipt.attempts.length,3);assert.ok(receipt.attempts.every(x=>x.attempted&&x.httpStatus===200));}
    assert.equal(r.network.attempted,0);assert.match(r.network.evidenceSemantics.limitation,/Zero analytics allowed is not zero all outbound/);
  }
});
test('failed global probe retains mask-safe attempted/failed/not-attempted statuses separately from browser network',async()=>{
  const report={};const deps={now:()=> '2026-10-13T10:00:00.000Z',ttfb:async observe=>{
    observe({host:'blog.observe.tw',status:'started',utc:'2026-10-13T10:00:00.000Z',cookie:'never-log',url:'https://secret.invalid/?token=never-log'});
    observe({host:'blog.observe.tw',status:'failed',httpStatus:503,utc:'2026-10-13T10:00:00.001Z',message:'never-log'});
    throw Error('never-log');
  }};
  await assert.rejects(globalHomepageProbe(report,'before',deps),/ttfb_gate/);
  const receipt=report.globalHomepageProbes[0];assert.equal(receipt.status,'failed');assert.equal(receipt.eventsSource,'transport-attempt-events');
  assert.deepEqual(receipt.attempts.map(x=>x.status),['failed','not-attempted','not-attempted']);assert.equal(receipt.attempts[0].httpStatus,503);
  assert.ok(!JSON.stringify(receipt).includes('never-log'));assert.ok(!JSON.stringify(receipt).includes('secret.invalid'));
});
test('a candidate global probe failure is never skipped or replaced by zero browser analytics attempts', async()=>{
  const m=mocks();m.deps.ttfb=async observe=>{observe({host:'tag.observe.tw',status:'failed',httpStatus:null});throw Error('privatefailure');};
  const r=await capture(config,m.deps);assert.equal(r.error,'ttfb_gate');assert.ok(!m.events.includes('launch'));assert.equal(r.network.attempted,0);
  assert.equal(r.globalHomepageProbes[0].status,'failed');assert.equal(r.globalHomepageProbes[0].attempts.find(x=>x.host==='tag.observe.tw').attempted,true);
});

test('reader routes are denied for case and encoded variants before navigation or resource continuation', () => {
  for (const path of ['/reader/', '/READER/', '/Reader/keys', '/%72eader/', '/%2572eader/', '/x/%2e%2e/%72eader/', '/reader;keys']) {
    assert.equal(privateCapturePath(path), true);
    assert.equal(requestDecision(config.targetOrigin + path, config.targetOrigin), 'external');
    assert.throws(() => plan({ ...config, pages: [{ path, width: 390 }] }), /private_route/);
  }
  assert.equal(privateCapturePath('/articles/reader-guide/'), false);
});

await test('homepage gate uses three-sample median but never masks an HTTP error', async () => {
 const {summarizeHomepageSamples}=await import('./ui-capture.mjs');
 const samples=[1,8,2].map(totalSeconds=>({status:200,totalSeconds,ttfbSeconds:0.2}));
 assert.equal(summarizeHomepageSamples('blog.observe.tw',samples).totalSeconds,2);
 assert.throws(()=>summarizeHomepageSamples('blog.observe.tw',[...samples.slice(0,2),{status:500,totalSeconds:1}]),/ttfb_gate/);
 assert.throws(()=>summarizeHomepageSamples('blog.observe.tw',samples.slice(0,2)),/ttfb_gate/);
});

test('formal HTML identity reads actual Flight BUILD_ID and rejects absent/conflicting identities', async () => {
  const { htmlNextBuildId, verifyIdentity } = await import('./ui-capture.mjs');
  const flight = id => '<script>self.__next_f.push(' + JSON.stringify([1, '0:' + JSON.stringify({ b: id, c: ['articles'] }) + '\n']) + ')</script>';
  assert.equal(htmlNextBuildId(flight('current-build')), 'current-build');
  assert.throws(() => htmlNextBuildId('<script>"current-build"</script>'));
  assert.throws(() => htmlNextBuildId(flight('current-build') + flight('other-build')));
  const sha='a'.repeat(40),config={htmlBuildIdentity:true,expectedSHA:sha,expectedBuildId:'current-build'};
  assert.equal(verifyIdentity({'x-blog-release':sha},config,htmlNextBuildId(flight('current-build'))).buildId,'current-build');
  assert.throws(() => verifyIdentity({'x-blog-release':sha},config,'other-build'));
});
