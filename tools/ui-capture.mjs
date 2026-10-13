import { HOMEPAGE_BASELINE, HOMEPAGE_LIMIT_SECONDS } from './homepage-gate-baseline.mjs';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { loadavg } from 'node:os';
import { mkdir, readFile, readdir, realpath, statfs, writeFile, readlink, open, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MiB = 1024 ** 2;
export const LIMITS = Object.freeze({ images: 4, bytes: 50 * MiB, reserve: 40 * 1024 ** 3, stopReserve: 30 * 1024 ** 3, load: 12, delay: 5000 });
const analyticsRoots = ['google-analytics.com', 'googletagmanager.com', 'doubleclick.net', 'googleadservices.com', 'googlesyndication.com'];
export function requestDecision(raw, targetOrigin) {
  try {
    const url = new URL(raw);
    if (analyticsRoots.some(root => url.hostname === root || url.hostname.endsWith(`.${root}`)) || url.hostname === 'analytics.google.com') return 'analytics';
    if (/\/(?:admin|auth|login|my|me)(?:\/|$)/.test(url.pathname)) return 'external';
    return url.origin === targetOrigin && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? 'allow' : 'external';
  } catch { return 'external'; }
}
export function plan(config) {
  const origin = new URL(config.targetOrigin);
  if (origin.origin !== config.targetOrigin || origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol)) throw Error('invalid_target');
  if (!/^[a-f0-9]{40}$/.test(config.expectedSHA || '') || !config.expectedBuildId || (!config.localIdentity && !/^[a-z0-9-]+$/i.test(config.buildIdHeader || ''))) throw Error('identity_required');
  if (!Array.isArray(config.pages) || config.pages.length < 1 || config.pages.length > LIMITS.images) throw Error('batch_limit');
  const pages = config.pages.map((page, index) => {
    if (![1280, 390].includes(page.width) || typeof page.path !== 'string' || !page.path.startsWith('/') || page.path.startsWith('//')) throw Error('invalid_page');
    const url = new URL(page.path, origin);
    if (url.origin !== origin.origin || url.username || url.password || /\/(?:admin|auth|login|my|me)(?:\/|$)/.test(url.pathname)) throw Error('private_route');
    const theme = page.theme ?? 'light';
    if (!['light', 'dark'].includes(theme)) throw Error('invalid_theme');
    return { url: url.href, width: page.width, height: 900, theme, name: `page-${index + 1}-${page.width}-${theme}.png` };
  });
  const estimatedBytes = pages.reduce((sum, page) => sum + page.width * page.height * 4, 0);
  if (estimatedBytes > LIMITS.bytes) throw Error('artifact_budget');
  return { pages, estimatedBytes, targetOrigin: origin.origin, formal: !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) };
}
export function verifyGate({ load, browserRoots, available }, estimate) {
  if (!Number.isFinite(load) || load > LIMITS.load || !Number.isSafeInteger(browserRoots) || browserRoots < 0 || browserRoots >= 2 || !Number.isFinite(available) || available - estimate < LIMITS.reserve) throw Error('gate_closed');
}
export function verifyIdentity(headers, config) {
  if (headers['x-blog-release'] !== config.expectedSHA || headers[config.buildIdHeader.toLowerCase()] !== config.expectedBuildId) throw Error('identity_unverified');
  return { sha: headers['x-blog-release'], buildId: headers[config.buildIdHeader.toLowerCase()] };
}
export function recordNetworkAttempt(raw, method, resourceType, decision, network) {
  if (!network) return;
  network.attempted++;
  let hostname = '', pathname = '';
  try { const url = new URL(raw); hostname = url.hostname; pathname = url.pathname; } catch { /* only counters for invalid URL */ }
  if (/(^|\.)google-analytics\.com$/.test(hostname) || hostname === 'analytics.google.com') network.ga++;
  if (/(^|\.)googletagmanager\.com$/.test(hostname)) network.gtm++;
  if (decision === 'analytics') network.analytics++;
  const blocked = decision !== 'allow' || !['GET', 'HEAD'].includes(method);
  if (blocked) network.blocked++;
  if (network.requests.length < 500) network.requests.push({ method: /^[A-Z]{1,10}$/.test(method) ? method : 'other', resourceType, decision: blocked ? decision === 'allow' ? 'method' : decision : 'allow',
    ...(decision === 'allow' ? { pathname } : decision === 'analytics' ? { hostname } : {}) });
  else network.truncated = true;
}
export async function installGuards(context, origin, counters, network) {
  await context.route('**/*', async route => {
    const decision = requestDecision(route.request().url(), origin);
    recordNetworkAttempt(route.request().url(), route.request().method(), route.request().resourceType?.() ?? 'unknown', decision, network);
    if (decision !== 'allow' || !['GET', 'HEAD'].includes(route.request().method())) { counters[decision === 'analytics' ? 'analytics' : 'external']++; return route.abort('blockedbyclient'); }
    return route.continue();
  });
  if (typeof context.routeWebSocket !== 'function') throw Error('websocket_guard_unavailable');
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.addInitScript(() => {
    localStorage.setItem('blog-analytics-opt-out', '1');
    localStorage.setItem('tag-analytics-opt-out', '1');
    localStorage.setItem('youtube-analytics-opt-out', '1');
    Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' });
  });
}
const exec = promisify(execFile);
const isBrowserExecutable = name => /^(?:chrome|chromium|chromium-browser|chrome-headless-shell|headless_shell)$/.test(name);
const safeProcessDiagnostics = rows => rows.slice(0, 128).map(row => ({
  pid: Number.isSafeInteger(row.pid) ? row.pid : null,
  ppid: Number.isSafeInteger(row.ppid) ? row.ppid : null,
  executable: isBrowserExecutable(row.executable) ? row.executable : null,
  comm: typeof row.comm === 'string' ? row.comm.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 32) : null,
  hasType: Array.isArray(row.args) ? row.args.some(arg => /^--type(?:=|$)/.test(arg)) : row.hasType === true,
  argCount: Array.isArray(row.args) ? row.args.length : Number.isSafeInteger(row.argCount) ? row.argCount : null,
  startTicks: /^\d+$/.test(row.startTicks ?? '') ? row.startTicks : null,
}));
export function browserRootInventory(rows) {
  const candidates = rows.filter(row => isBrowserExecutable(row.executable));
  const fail = reason => { throw Object.assign(Error(reason), { processDiagnostics: safeProcessDiagnostics(candidates), processDiagnosticsTruncated: candidates.length > 128 }); };
  if (candidates.some(row => !Number.isSafeInteger(row.pid) || row.pid < 2 || !Number.isSafeInteger(row.ppid) || row.ppid < 0 || typeof row.startTicks !== 'string' || !/^\d{1,32}$/.test(row.startTicks))) fail('process_inventory_unavailable');
  const byPid = new Map();
  for (const row of candidates) {
    if (byPid.has(row.pid)) fail('browser_pid_duplicate');
    byPid.set(row.pid, row);
  }
  // This headless binary truncates cmdline to argv[0], including descendants.
  // Count only topmost verified browser processes. Missing parents stay roots:
  // even --type cannot prove an unseen/reparented process belongs to another tree.
  for (const row of candidates) {
    const seen = new Set(); let current = row;
    while (current) {
      if (seen.has(current.pid)) fail('browser_ancestry_cycle');
      seen.add(current.pid);
      const parent = byPid.get(current.ppid);
      if (parent && BigInt(parent.startTicks) > BigInt(current.startTicks)) fail('browser_parent_identity_changed');
      current = parent;
    }
  }
  const roots = candidates.filter(row => !byPid.has(row.ppid));
  return { browserRoots: roots.length, rootPids: roots.map(row => row.pid), chromiumProcesses: candidates.length };
}
export async function processInventory(deps = { exec, readFile, readlink, readdir }) {
  let rawPgrepCount;
  try { const { stdout } = await deps.exec('pgrep', ['-fc', 'chrome|chromium|playwright|headless_shell']); rawPgrepCount = Number(stdout.trim()); }
  catch (error) { if (error.code === 1 && String(error.stdout).trim() === '0') rawPgrepCount = 0; else throw Error('process_count_unavailable'); }
  if (!Number.isSafeInteger(rawPgrepCount) || rawPgrepCount < 0) throw Error('process_count_unavailable');
  const rows = [];
  for (const pid of (await deps.readdir('/proc')).filter(name => /^\d+$/.test(name))) {
    try {
      // comm is readable for ordinary non-owned processes; only suspicious browser
      // names require privileged exe/cmdline reads. argv[0] may be /proc/self/exe.
      const comm = (await deps.readFile(`/proc/${pid}/comm`, 'utf8')).trim();
      if (!/^(?:chrome|chromium|headless)/.test(comm)) continue;
      const executable = (await deps.readlink(`/proc/${pid}/exe`)).replace(/ \(deleted\)$/, '').split('/').at(-1);
      if (!isBrowserExecutable(executable)) continue;
      const args = (await deps.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
      const fields = (await deps.readFile(`/proc/${pid}/stat`, 'utf8')).split(') ').at(-1).split(' ');
      if (['Z', 'X'].includes(fields[0])) continue;
      rows.push({ pid: Number(pid), ppid: Number(fields[1]), executable, comm, args, startTicks: fields[19] });
    } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw Error('process_inventory_unavailable'); }
  }
  return { rawPgrepCount, ...browserRootInventory(rows), quotaScope: 'participating-flock-clients-plus-point-in-time-root-inventory' };
}
async function snapshotGate() {
  const disk = await statfs('/home', { bigint: true });
  return { utc: new Date().toISOString(), load: loadavg()[0], ...await processInventory(), available: Number(disk.bavail * disk.bsize) };
}

const procStart = async pid => (await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ').at(-1).split(' ')[19];
const holderCode = `
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const token=process.argv[1];
const start=readFileSync('/proc/self/stat','utf8').split(') ').at(-1).split(' ')[19];
const output=(id)=>process.stdout.write(JSON.stringify({id,token,pid:process.pid,start})+'\\n');
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{try{const m=JSON.parse(line);if(m.token===token&&typeof m.id==='string')output(m.id);}catch{}});
lines.on('close',()=>process.exit(0));
output('ready');
`;
/** A live inherited flock, not a TTL directory lock or a constant-true assertion. */
export async function quotaLeaseFromProcess(child, token, readStart = procStart) {
  const pending = new Map();
  let exited = false;
  const wait = id => new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Error('quota_handshake_timeout')); }, 1500);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolveReady(value); }, reject: error => { clearTimeout(timer); reject(error); } });
  });
  const ready = wait('ready');
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    if (line.length > 1024) return;
    try {
      const value = JSON.parse(line), item = pending.get(value.id);
      if (item && value.token === token && value.pid === child.pid && /^\d+$/.test(value.start)) {
        pending.delete(value.id); item.resolve(value);
      }
    } catch { /* Invalid receipts cannot establish a lease. */ }
  });
  const onExit = () => { exited = true; for (const item of pending.values()) item.reject(Error('quota_holder_exited')); pending.clear(); };
  child.once('exit', onExit); child.once('error', onExit); child.stdin.on('error', onExit);
  let receipt;
  try { receipt = await ready; }
  catch (error) { lines.close(); if (child.exitCode === null) child.kill('SIGTERM'); throw error; }
  return {
    receipt: { scope: 'participating-threads-flock', holderPid: receipt.pid, holderStart: receipt.start, unmanagedThreadsEnforced: false },
    async assertHeld() {
      if (exited || child.exitCode !== null || await readStart(receipt.pid) !== receipt.start) return false;
      const id = randomBytes(12).toString('hex'), response = wait(id);
      child.stdin.write(JSON.stringify({ id, token }) + '\n');
      const proof = await response;
      return !exited && child.exitCode === null && proof.pid === receipt.pid && proof.start === receipt.start;
    },
    async release() {
      if (exited) return;
      const stopped = new Promise((resolveExit, reject) => {
        const timer = setTimeout(() => { child.kill('SIGTERM'); reject(Error('quota_release_timeout')); }, 1500);
        child.once('exit', () => { clearTimeout(timer); resolveExit(); });
      });
      child.stdin.end(); await stopped; lines.close();
    },
  };
}
export async function acquireHostBrowserQuota(deps = { mkdir, lstat, open, spawn, readStart: procStart }) {
  const directory = '/home/deck/.cache/observe-ui-quota';
  await deps.mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await deps.lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || info.uid !== process.getuid()) throw Error('quota_directory_unsafe');
  for (let slot = 0; slot < 2; slot++) {
    const path = `${directory}/browser-${slot}.lock`;
    try { const fd = await deps.open(path, 'ax', 0o600); await fd.close(); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const file = await deps.lstat(path);
    if (!file.isFile() || file.isSymbolicLink() || file.uid !== process.getuid() || (file.mode & 0o077)) throw Error('quota_file_unsafe');
    const token = randomBytes(24).toString('hex');
    const child = deps.spawn('flock', ['--exclusive', '--nonblock', '--no-fork', path, process.execPath, '--input-type=module', '-e', holderCode, token], { stdio: ['pipe', 'pipe', 'ignore'] });
    try { const lease = await quotaLeaseFromProcess(child, token, deps.readStart); lease.receipt.slot = slot; return lease; }
    catch (error) { if (child.exitCode !== 1) throw error; }
  }
  throw Error('global_quota_full');
}

export function listenerInodes(text, port) {
  return text.trim().split('\n').slice(1).filter(line => {
    const fields = line.trim().split(/\s+/);
    return fields[3] === '0A' && Number.parseInt(fields[1].split(':').at(-1), 16) === port;
  }).map(line => line.trim().split(/\s+/)[9]);
}
export async function localProcessIdentity(config, deps = { readFile, readlink, readdir, realpath }) {
  const local = config.localIdentity, target = new URL(config.targetOrigin);
  const nextPort = local?.nextPort ?? local?.port, port = local?.gatewayPort ?? nextPort;
  if (!local || !Number.isSafeInteger(local.nextPid) || local.nextPid < 1 || !Number.isSafeInteger(nextPort) || !Number.isSafeInteger(port) || nextPort < 1 || nextPort > 65535 || port < 1 || port > 65535 || Number(target.port) !== port || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) throw Error('local_identity_required');
  const release = await deps.realpath(local.releaseDir), cwd = await deps.realpath(`/proc/${local.nextPid}/cwd`);
  if (!(cwd === release || cwd.startsWith(release + '/'))) throw Error('local_identity_cwd');
  const startOf = async pid => (await deps.readFile(`/proc/${pid}/stat`, 'utf8')).split(') ').at(-1).split(' ')[19];
  const ownsPort = async (pid, expectedPort) => {
    const sockets = new Set();
    for (const name of ['tcp', 'tcp6']) for (const inode of listenerInodes(await deps.readFile(`/proc/${pid}/net/${name}`, 'utf8'), expectedPort)) sockets.add(inode);
    for (const fd of await deps.readdir(`/proc/${pid}/fd`)) {
      try { if (sockets.has(/^socket:\[(\d+)\]$/.exec(await deps.readlink(`/proc/${pid}/fd/${fd}`))?.[1])) return true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return false;
  };
  const start = await startOf(local.nextPid);
  if (!/^\d+$/.test(start)) throw Error('local_identity_pid');
  const buildId = (await deps.readFile(resolve(cwd, '.next/BUILD_ID'), 'utf8')).trim();
  if (buildId !== config.expectedBuildId) throw Error('identity_unverified');
  if (!(await ownsPort(local.nextPid, nextPort))) throw Error('local_identity_port');
  const receipt = { buildId, nextPid: local.nextPid, nextStart: start, nextPort, port, cwd, releaseDir: release, method: 'local-proc-socket-and-build-id' };
  if (local.gatewayPid !== undefined) {
    if (!Number.isSafeInteger(local.gatewayPid) || local.gatewayPid < 1 || !local.gatewayPort) throw Error('local_identity_gateway');
    const gatewayCwd = await deps.realpath(`/proc/${local.gatewayPid}/cwd`), gatewayStart = await startOf(local.gatewayPid);
    if (!(gatewayCwd === release || gatewayCwd.startsWith(release + '/')) || !/^\d+$/.test(gatewayStart) || !(await ownsPort(local.gatewayPid, port))) throw Error('local_identity_gateway');
    // Only these two non-secret origins are selected. Never emit or retain the rest of /proc/environ.
    const selectedEnv = async (pid, key) => {
      const values = (await deps.readFile(`/proc/${pid}/environ`, 'utf8')).split('\0').filter(item => item.startsWith(key + '='));
      if (values.length !== 1) throw Error('local_identity_wiring');
      return values[0].slice(key.length + 1).replace(/\/$/, '');
    };
    const gatewayUiOrigin = await selectedEnv(local.gatewayPid, 'BLOG_UI_ORIGIN');
    const nextGatewayOrigin = await selectedEnv(local.nextPid, 'BLOG_GATEWAY_INTERNAL_URL');
    if (gatewayUiOrigin !== `http://127.0.0.1:${nextPort}` || nextGatewayOrigin !== `http://127.0.0.1:${port}`) throw Error('local_identity_wiring');
    if (await startOf(local.gatewayPid) !== gatewayStart) throw Error('local_identity_pid_changed');
    Object.assign(receipt, { gatewayPid: local.gatewayPid, gatewayStart, gatewayCwd, gatewayUiOrigin, nextGatewayOrigin });
  } else if (local.gatewayPort !== undefined) throw Error('local_identity_gateway');
  if (await startOf(local.nextPid) !== start) throw Error('local_identity_pid_changed');
  return receipt;
}
export async function verifyArchiveIdentity(config) {
  const receipt = await localProcessIdentity(config);
  const repository = await realpath(config.localIdentity.repositoryDir);
  const { stdout: tree } = await exec('git', ['-C', repository, 'rev-parse', `${config.expectedSHA}^{tree}`]);
  const sourceTreeHash = tree.trim();
  if (!/^[a-f0-9]{40}$/.test(sourceTreeHash)) throw Error('source_tree_unverified');
  const { stdout } = await exec('git', ['-C', repository, 'ls-tree', '-rz', config.expectedSHA], { maxBuffer: 4 * MiB });
  let verifiedFiles = 0;
  for (const item of stdout.split('\0').filter(Boolean)) {
    const [entry, path] = item.split('\t'), [mode, kind, expected] = entry.split(' ');
    if (!path || path.split('/').includes('..') || path.startsWith('/') || kind !== 'blob') throw Error('source_tree_unverified');
    const file = resolve(receipt.releaseDir, path);
    const bytes = mode === '120000' ? Buffer.from(await readlink(file)) : await readFile(file);
    const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (actual !== expected) throw Error('source_archive_mismatch');
    verifiedFiles++;
  }
  if (!verifiedFiles) throw Error('source_tree_unverified');
  return { ...receipt, sha: config.expectedSHA, sourceTreeHash, sourceTreeHashAlgorithm: 'git-tree-sha1', verifiedFiles };
}
export const TTFB_LIMITS = HOMEPAGE_LIMIT_SECONDS;
export function verifyLatencyGate(rows) {
  if (!Array.isArray(rows) || rows.length !== 3 || new Set(rows.map(row => row.host)).size !== 3 || rows.some(row => !Object.hasOwn(TTFB_LIMITS, row.host) || row.status !== 200 || !Number.isFinite(row.totalSeconds) || row.totalSeconds < 0 || row.totalSeconds > TTFB_LIMITS[row.host])) throw Error('ttfb_gate');
}
async function formalTTFB() {
  const rows = [];
  for (const host of ['blog.observe.tw', 'tag.observe.tw', 'youtube.observe.tw']) {
    const start = performance.now();
    const response = await fetch(`https://${host}/`, { headers: { DNT: '1', Accept: 'text/html' }, redirect: 'error', signal: AbortSignal.timeout(TTFB_LIMITS[host] * 1000 + 500) });
    const ttfbSeconds = (performance.now() - start) / 1000;
    let bytes = 0;
    const reader = response.body?.getReader();
    if (reader) try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 2 * MiB) throw Error('probe_body_limit'); } } finally { await reader.cancel().catch(() => undefined); }
    const totalSeconds = (performance.now() - start) / 1000;
    rows.push({ host, totalSeconds, ttfbSeconds, status: response.status });
  }
  return rows;
}
export async function capture(config, deps) {
  const batch = plan(config);
  const report = { homepageBaseline: HOMEPAGE_BASELINE, startedAt: deps.now(), endedAt: null, closeAt: null, closed: false, status: 'stopped', gates: [], pages: [], blocked: { analytics: 0, external: 0 }, network: { attempted: 0, ga: 0, gtm: 0, analytics: 0, blocked: 0, requests: [], truncated: false, limitation: 'External images/fonts/scripts are blocked by default; their absence is not evidence of a page defect.' }, authorization: typeof config.authorization === 'string' ? config.authorization.slice(0, 300) : 'explicit-user-thaw'  };
  let browser, lease;
  const noteProcessFailure = (error, phase) => {
    if (Array.isArray(error?.processDiagnostics)) {
      report.processDiagnostics ??= [];
      report.processDiagnostics.push({ phase, utc: deps.now(), rows: safeProcessDiagnostics(error.processDiagnostics), truncated: error.processDiagnosticsTruncated === true });
    }
  };
  const proveQuota = async () => { if (await lease.assertHeld() !== true) throw Error('global_quota_unproven'); };
  try {
    const before = await deps.gate(); report.gates.push({ phase: 'before', ...before }); verifyGate(before, batch.estimatedBytes);
    // flock is atomic for participating clients; unrelated threads remain outside its contract.
    lease = await deps.acquireGlobalQuota?.();
    if (!lease || typeof lease.assertHeld !== 'function' || typeof lease.release !== 'function') throw Error('global_quota_unproven');
    await proveQuota();
    report.quota = lease.receipt ?? { scope: 'dependency-test-or-external-receipt', unmanagedThreadsEnforced: false };
    if (config.localIdentity) {
      report.localIdentity = await deps.verifyLocalArchive?.();
      if (!report.localIdentity || report.localIdentity.sha !== config.expectedSHA || report.localIdentity.buildId !== config.expectedBuildId || !report.localIdentity.verifiedFiles) throw Error('identity_unverified');
    }
    { report.beforeTTFB = await deps.ttfb(); verifyLatencyGate(report.beforeTTFB); }
    const launchGate = await deps.gate(); report.gates.push({ phase: 'prelaunch', ...launchGate }); verifyGate(launchGate, batch.estimatedBytes);
    await proveQuota();
    browser = await deps.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { DNT: '1' }, serviceWorkers: 'block', permissions: [], acceptDownloads: false });
    await installGuards(context, batch.targetOrigin, report.blocked, report.network);
    for (const item of batch.pages) {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: item.theme });
    await page.addInitScript(theme => localStorage.setItem('theme', theme), item.theme);
    let identityFailure = false;
    page.on('response', response => {
      if (!config.localIdentity && response.request().resourceType() === 'document') {
        try { verifyIdentity(response.headers(), config); } catch { identityFailure = true; }
      }
    });
      report.currentPathname = new URL(item.url).pathname;
      await proveQuota();
      const gate = await deps.gate(); report.gates.push({ phase: 'page', ...gate });
      // Keep raw pgrep diagnostics separate from browser-root counts. Flock
      // constrains participants only; stop if the live root inventory exceeds two.
      if (!Number.isFinite(gate.load) || gate.load > LIMITS.load || !Number.isSafeInteger(gate.browserRoots) || gate.browserRoots < 0 || gate.browserRoots > 2 || !Number.isFinite(gate.available) || gate.available - Math.max(0, batch.estimatedBytes - report.pages.reduce((sum, row) => sum + row.bytes, 0)) < LIMITS.stopReserve) throw Error('page_gate');
      await page.setViewportSize({ width: item.width, height: item.height });
      const response = await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      if (!response || response.status() !== 200) throw Error('document_unavailable');
      const identity = config.localIdentity ? await deps.verifyLocalProcess?.() : verifyIdentity(await response.allHeaders(), config);
      if (config.localIdentity && (!identity || ['buildId','nextPid','nextStart','nextPort','port','cwd','releaseDir','gatewayPid','gatewayStart','gatewayCwd','gatewayUiOrigin','nextGatewayOrigin'].some(key => identity[key] !== report.localIdentity[key]))) throw Error('identity_unverified');
      await deps.sleep(LIMITS.delay);
      await proveQuota();
      if (config.localIdentity) { const current = await deps.verifyLocalProcess?.(); if (!current || ['buildId','nextPid','nextStart','nextPort','port','cwd','releaseDir','gatewayPid','gatewayStart','gatewayCwd','gatewayUiOrigin','nextGatewayOrigin'].some(key => current[key] !== identity[key])) throw Error('identity_unverified'); }
      if (identityFailure || page.url() !== item.url) throw Error('document_identity_changed');
      const saveGate = await deps.gate(); report.gates.push({ phase: 'presave', ...saveGate });
      if (!Number.isFinite(saveGate.load) || saveGate.load > LIMITS.load || !Number.isFinite(saveGate.available) || saveGate.available - batch.estimatedBytes < LIMITS.stopReserve || !Number.isSafeInteger(saveGate.browserRoots) || saveGate.browserRoots < 0 || saveGate.browserRoots > 2) throw Error('page_gate');
      const observedTheme = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, darkMedia: matchMedia('(prefers-color-scheme: dark)').matches }));
      if (observedTheme.theme !== item.theme || observedTheme.darkMedia !== (item.theme === 'dark')) throw Error('theme_unverified');
      const png = await page.screenshot({ fullPage: false });
      if (png.length > item.width * item.height * 4 || report.pages.reduce((sum, row) => sum + row.bytes, 0) + png.length > LIMITS.bytes) throw Error('actual_artifact_budget');
      await deps.saveImage(item.name, png);
      report.pages.push({ name: item.name, pathname: new URL(item.url).pathname, viewport: [item.width, item.height], theme: observedTheme.theme, darkMedia: observedTheme.darkMedia, utc: deps.now(), identity: config.localIdentity ? { ...identity, sha: report.localIdentity.sha, sourceTreeHash: report.localIdentity.sourceTreeHash } : identity, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), status: 'captured-unreviewed' });
      await page.close();
    }
    report.status = 'captured-unreviewed';
  } catch (error) { noteProcessFailure(error, report.currentPathname ? 'page' : 'initial'); report.error = error.message && /^[a-z_]+$/.test(error.message) ? error.message : 'capture_stopped'; }
  finally {
    try { if (browser) { await browser.close(); report.closed = true; report.closeAt = deps.now(); } }
    catch { report.closed = false; report.error = 'browser_close_failed'; }
    try { if (!browser || report.closed) await lease?.release(); else report.quotaRetained = 'browser_close_failed'; } catch { report.error = 'quota_release_failed'; }
    try {
      const after = await deps.gate(); report.gates.push({ phase: 'after', ...after });
      if (browser && report.closed && report.beforeTTFB && Number.isFinite(after.load) && after.load <= LIMITS.load) {
        try { report.afterTTFB = await deps.ttfb(); verifyLatencyGate(report.afterTTFB); }
        catch { report.afterGateError = 'ttfb_gate'; report.error ??= 'after_ttfb_gate'; report.status = 'stopped'; }
      }
      else report.afterTTFBSkipped = 'no_completed_browser_or_load_gate';
    } catch (error) { noteProcessFailure(error, 'after'); report.afterGateError = 'gate_unavailable'; }
    report.endedAt = deps.now();
    await deps.saveReport(report);
  }
  return report;
}
export function verifyPrivateArtifactDirectory(info, uid = process.getuid()) {
  if (!info?.isDirectory?.() || info.isSymbolicLink?.() !== false || info.uid !== uid || !Number.isSafeInteger(info.mode) || (info.mode & 0o077)) throw Error('private_artifact_dir_required');
}
async function main() {
  const args = process.argv.slice(2);
  // Explicit user thaw permits --capture, but all runtime gates still apply.
  // Dry-plan remains the default; no second approval flag is invented.
  const file = args.find(arg => !arg.startsWith('--'));
  if (!file) throw Error('usage: node tools/ui-capture.mjs plan.json [--capture]');
  const config = JSON.parse(await readFile(file, 'utf8')), batch = plan(config);
  if (!args.includes('--capture')) { console.log(JSON.stringify({ mode: 'dry-plan', images: batch.pages.length, estimatedBytes: batch.estimatedBytes, requiredFreeBytes: LIMITS.reserve + batch.estimatedBytes, viewport: '1280/390 × 900', network: false, quota: 'shared-participating-thread-flock', startReserveBytes: LIMITS.reserve, stopReserveBytes: LIMITS.stopReserve })); return; }
  if (!config.playwrightModule || !config.artifactDir) throw Error('capture_dependencies_required');
  const artifactDir = resolve(config.artifactDir);
  if (!artifactDir.startsWith('/home/deck/.t3/userdata/') || /(?:^|\/)\.\.(?:\/|$)/.test(config.artifactDir)) throw Error('private_artifact_dir_required');
  const { chromium } = await import(pathToFileURL(resolve(config.playwrightModule)).href);
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  verifyPrivateArtifactDirectory(await lstat(artifactDir));
  const actualDir = await realpath(artifactDir), privateRoot = await realpath('/home/deck/.t3/userdata');
  if (!actualDir.startsWith(privateRoot + '/') || (await readdir(actualDir)).length) throw Error('fresh_private_artifact_dir_required');
  const report = await capture(config, { now: () => new Date().toISOString(), gate: snapshotGate, ttfb: formalTTFB, verifyLocalArchive: () => verifyArchiveIdentity(config), verifyLocalProcess: () => localProcessIdentity(config), acquireGlobalQuota: () => acquireHostBrowserQuota(), launch: () => chromium.launch({ headless: true }), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), saveImage: (name, data) => writeFile(resolve(artifactDir, name), data, { flag: 'wx', mode: 0o600 }), saveReport: report => writeFile(resolve(artifactDir, 'capture-report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 }) });
  if (report.error) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error('ui_capture_refused'); process.exitCode = 1; });
