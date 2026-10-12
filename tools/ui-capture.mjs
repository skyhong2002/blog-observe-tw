import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadavg } from 'node:os';
import { mkdir, readFile, readdir, realpath, statfs, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MiB = 1024 ** 2;
export const LIMITS = Object.freeze({ images: 4, bytes: 50 * MiB, reserve: 112.5 * 1024 ** 3 + 512 * MiB, load: 12, delay: 5000 });
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
  if (!/^[a-f0-9]{40}$/.test(config.expectedSHA || '') || !config.expectedBuildId || !/^[a-z0-9-]+$/i.test(config.buildIdHeader || '')) throw Error('identity_required');
  if (!Array.isArray(config.pages) || config.pages.length < 1 || config.pages.length > LIMITS.images) throw Error('batch_limit');
  const pages = config.pages.map((page, index) => {
    if (![1280, 390].includes(page.width) || typeof page.path !== 'string' || !page.path.startsWith('/') || page.path.startsWith('//')) throw Error('invalid_page');
    const url = new URL(page.path, origin);
    if (url.origin !== origin.origin || url.username || url.password || /\/(?:admin|auth|login|my|me)(?:\/|$)/.test(url.pathname)) throw Error('private_route');
    return { url: url.href, width: page.width, height: 900, name: `page-${index + 1}-${page.width}.png` };
  });
  const estimatedBytes = pages.reduce((sum, page) => sum + page.width * page.height * 4, 0);
  if (estimatedBytes > LIMITS.bytes) throw Error('artifact_budget');
  return { pages, estimatedBytes, targetOrigin: origin.origin, formal: !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) };
}
export function verifyGate({ load, processes, available }, estimate) {
  if (!Number.isFinite(load) || load > LIMITS.load || !Number.isSafeInteger(processes) || processes < 0 || processes >= 2 || !Number.isFinite(available) || available - estimate < LIMITS.reserve) throw Error('gate_closed');
}
export function verifyIdentity(headers, config) {
  if (headers['x-blog-release'] !== config.expectedSHA || headers[config.buildIdHeader.toLowerCase()] !== config.expectedBuildId) throw Error('identity_unverified');
  return { sha: headers['x-blog-release'], buildId: headers[config.buildIdHeader.toLowerCase()] };
}
export async function installGuards(context, origin, counters) {
  await context.route('**/*', async route => {
    const decision = requestDecision(route.request().url(), origin);
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
async function processCount() {
  try { const { stdout } = await exec('pgrep', ['-fc', 'chrome|chromium|playwright']); return Number(stdout.trim()); }
  catch (error) { if (error.code === 1 && String(error.stdout).trim() === '0') return 0; throw Error('process_count_unavailable'); }
}
async function snapshotGate() {
  const disk = await statfs('/home', { bigint: true });
  return { utc: new Date().toISOString(), load: loadavg()[0], processes: await processCount(), available: Number(disk.bavail * disk.bsize) };
}
async function formalTTFB() {
  const rows = [];
  for (const host of ['blog.observe.tw', 'tag.observe.tw', 'youtube.observe.tw']) {
    const start = performance.now();
    const response = await fetch(`https://${host}/`, { headers: { DNT: '1' }, redirect: 'error', signal: AbortSignal.timeout(2500) });
    const seconds = (performance.now() - start) / 1000;
    await response.body?.cancel();
    rows.push({ host, seconds, status: response.status });
  }
  return rows;
}
export async function capture(config, deps) {
  const batch = plan(config);
  const report = { startedAt: deps.now(), endedAt: null, closeAt: null, closed: false, status: 'stopped', gates: [], pages: [], blocked: { analytics: 0, external: 0 } };
  let browser, lease;
  const proveQuota = async () => { if (await lease.assertHeld() !== true) throw Error('global_quota_unproven'); };
  try {
    const before = await deps.gate(); report.gates.push({ phase: 'before', ...before }); verifyGate(before, batch.estimatedBytes);
    // A local lock or pgrep snapshot cannot establish atomic quota across threads.
    lease = await deps.acquireGlobalQuota?.();
    if (!lease || typeof lease.assertHeld !== 'function' || typeof lease.release !== 'function') throw Error('global_quota_unproven');
    await proveQuota();
    if (batch.formal) { report.beforeTTFB = await deps.ttfb(); if (report.beforeTTFB.length !== 3 || report.beforeTTFB.some(x => x.status !== 200 || !Number.isFinite(x.seconds) || x.seconds > 2)) throw Error('ttfb_gate'); }
    const launchGate = await deps.gate(); report.gates.push({ phase: 'prelaunch', ...launchGate }); verifyGate(launchGate, batch.estimatedBytes);
    await proveQuota();
    browser = await deps.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { DNT: '1' }, serviceWorkers: 'block', permissions: [], acceptDownloads: false });
    await installGuards(context, batch.targetOrigin, report.blocked);
    const page = await context.newPage();
    let identityFailure = false;
    page.on('response', response => {
      if (response.request().resourceType() === 'document') {
        try { verifyIdentity(response.headers(), config); } catch { identityFailure = true; }
      }
    });
    for (const item of batch.pages) {
      report.currentPathname = new URL(item.url).pathname;
      await proveQuota();
      const gate = await deps.gate(); report.gates.push({ phase: 'page', ...gate });
      // Own Chromium creates multiple processes. The controller lease, not pgrep,
      // proves the live browser quota; pgrep's conservative prelaunch gate remains logged.
      if (!Number.isFinite(gate.load) || gate.load > LIMITS.load || !Number.isFinite(gate.available) || gate.available - batch.estimatedBytes < LIMITS.reserve) throw Error('page_gate');
      await page.setViewportSize({ width: item.width, height: item.height });
      const response = await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      if (!response || response.status() !== 200) throw Error('document_unavailable');
      const identity = verifyIdentity(await response.allHeaders(), config);
      await deps.sleep(LIMITS.delay);
      await proveQuota();
      if (identityFailure || page.url() !== item.url) throw Error('document_identity_changed');
      const png = await page.screenshot({ fullPage: false });
      if (png.length > item.width * item.height * 4 || report.pages.reduce((sum, row) => sum + row.bytes, 0) + png.length > LIMITS.bytes) throw Error('actual_artifact_budget');
      await deps.saveImage(item.name, png);
      report.pages.push({ name: item.name, pathname: new URL(item.url).pathname, viewport: [item.width, item.height], utc: deps.now(), identity, bytes: png.length, status: 'captured-unreviewed' });
    }
    report.status = 'captured-unreviewed';
  } catch (error) { report.error = error.message && /^[a-z_]+$/.test(error.message) ? error.message : 'capture_stopped'; }
  finally {
    try { if (browser) { await browser.close(); report.closed = true; report.closeAt = deps.now(); } }
    catch { report.closed = false; report.error = 'browser_close_failed'; }
    try { await lease?.release(); } catch { report.error = 'quota_release_failed'; }
    try {
      const after = await deps.gate(); report.gates.push({ phase: 'after', ...after });
      if (batch.formal && report.beforeTTFB && Number.isFinite(after.load) && after.load <= LIMITS.load) report.afterTTFB = await deps.ttfb();
      else report.afterTTFBSkipped = 'no_prior_probe_or_load_gate';
    } catch { report.afterGateError = 'gate_unavailable'; }
    report.endedAt = deps.now();
    await deps.saveReport(report);
  }
  return report;
}
async function main() {
  const args = process.argv.slice(2);
  // Operator freeze: do not even load a plan/module or create an artifact directory.
  // Remove only after the user explicitly lifts the capture stop; free space alone is not authorization.
  if (args.includes('--capture')) throw Error('capture_paused_by_operator');
  const file = args.find(arg => !arg.startsWith('--'));
  if (!file) throw Error('usage: node tools/ui-capture.mjs plan.json [--capture]');
  const config = JSON.parse(await readFile(file, 'utf8')), batch = plan(config);
  if (!args.includes('--capture')) { console.log(JSON.stringify({ mode: 'dry-plan', images: batch.pages.length, estimatedBytes: batch.estimatedBytes, requiredFreeBytes: LIMITS.reserve + batch.estimatedBytes, viewport: '1280/390 × 900', network: false, globalQuotaProviderRequired: true })); return; }
  if (!config.playwrightModule || !config.quotaModule || !config.artifactDir) throw Error('capture_dependencies_required');
  const artifactDir = resolve(config.artifactDir);
  if (!artifactDir.startsWith('/home/deck/.t3/userdata/') || /(?:^|\/)\.\.(?:\/|$)/.test(config.artifactDir)) throw Error('private_artifact_dir_required');
  const { chromium } = await import(pathToFileURL(resolve(config.playwrightModule)).href);
  const quota = await import(pathToFileURL(resolve(config.quotaModule)).href);
  await mkdir(artifactDir, { recursive: true, mode: 0o700 });
  const actualDir = await realpath(artifactDir), privateRoot = await realpath('/home/deck/.t3/userdata');
  if (!actualDir.startsWith(privateRoot + '/') || (await readdir(actualDir)).length) throw Error('fresh_private_artifact_dir_required');
  const report = await capture(config, { now: () => new Date().toISOString(), gate: snapshotGate, ttfb: formalTTFB, acquireGlobalQuota: () => quota.acquire({ maxBrowsers: 2 }), launch: () => chromium.launch({ headless: true }), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), saveImage: (name, data) => writeFile(resolve(artifactDir, name), data, { flag: 'wx', mode: 0o600 }), saveReport: report => writeFile(resolve(artifactDir, 'capture-report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 }) });
  if (report.error) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message === 'capture_paused_by_operator' ? 'capture_paused_by_operator' : 'ui_capture_refused'); process.exitCode = 1; });
