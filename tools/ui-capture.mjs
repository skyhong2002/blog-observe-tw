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
const analyticsRoots = ['google-analytics.com', 'analytics.google.com', 'googletagmanager.com', 'doubleclick.net', 'googleadservices.com', 'googlesyndication.com'];
export const NETWORK_GUARD_RULES = Object.freeze({
  requestPattern: '**/*', websocketPattern: '**/*',
  allowedSchemes: Object.freeze(['http:', 'https:']), allowedMethods: Object.freeze(['GET', 'HEAD']),
  analyticsHostRoots: Object.freeze([...analyticsRoots]), hostMatch: 'exact-root-or-dot-subdomain',
  analyticsDenySchemes: 'all URL schemes with a parsed analytics hostname',
  defaultDeny: 'non-target-origin, credentials, non-http(s), private paths, non-GET/HEAD',
  websockets: 'all denied; never connectToServer',
});
function analyticsHost(raw) {
  try { const host = new URL(raw).hostname; return analyticsRoots.find(root => host === root || host.endsWith(`.${root}`)) ?? null; }
  catch { return null; }
}
export function privateCapturePath(raw) {
  let path = raw;
  const forbidden = /\/(?:admin|auth|login|my|me|reader)(?:[/;\x5c.]|$)/i;
  for (let depth = 0; depth < 5; depth++) {
    if (forbidden.test(path)) return true;
    try {
      if (forbidden.test(new URL(path, 'http://guard.invalid').pathname)) return true;
      const decoded = decodeURIComponent(path);
      if (decoded === path) return false;
      path = decoded;
    } catch { return true; }
  }
  return true; // Deep/malformed encodings are unverified, not a public-route exemption.
}
export function requestDecision(raw, targetOrigin) {
  try {
    const url = new URL(raw);
    if (analyticsHost(raw)) return 'analytics';
    if (privateCapturePath(url.pathname)) return 'external';
    return url.origin === targetOrigin && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? 'allow' : 'external';
  } catch { return 'external'; }
}
export function plan(config) {
  const origin = new URL(config.targetOrigin);
  if (origin.origin !== config.targetOrigin || origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol)) throw Error('invalid_target');
  if (!/^[a-f0-9]{40}$/.test(config.expectedSHA || '') || !config.expectedBuildId || (!config.localIdentity && config.htmlBuildIdentity !== true && !/^[a-z0-9-]+$/i.test(config.buildIdHeader || ''))) throw Error('identity_required');
  if (!Array.isArray(config.pages) || config.pages.length < 1 || config.pages.length > LIMITS.images) throw Error('batch_limit');
  const pages = config.pages.map((page, index) => {
    if (![1280, 390].includes(page.width) || typeof page.path !== 'string' || !page.path.startsWith('/') || page.path.startsWith('//')) throw Error('invalid_page');
    const url = new URL(page.path, origin);
    if (url.origin !== origin.origin || url.username || url.password || privateCapturePath(url.pathname)) throw Error('private_route');
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
export function htmlNextBuildId(html) {
  const ids = new Set();
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const match = /self\.__next_f\.push\((\[[\s\S]*\])\)/.exec(script[1]);
    if (!match) continue;
    let frame; try { frame = JSON.parse(match[1]); } catch { continue; }
    if (!Array.isArray(frame) || frame[0] !== 1 || typeof frame[1] !== 'string') continue;
    for (const line of frame[1].split('\n')) {
      if (!line.startsWith('0:{')) continue;
      try { const value = JSON.parse(line.slice(2)); if (typeof value.b === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value.b)) ids.add(value.b); } catch { /* other flight frames */ }
    }
  }
  if (ids.size !== 1) throw Error('html_build_identity_unverified');
  return [...ids][0];
}
export function verifyIdentity(headers, config, observedBuildId) {
  if (headers['x-blog-release'] !== config.expectedSHA || (config.htmlBuildIdentity === true ? observedBuildId : headers[config.buildIdHeader.toLowerCase()]) !== config.expectedBuildId) throw Error('identity_unverified');
  return { sha: headers['x-blog-release'], buildId: config.htmlBuildIdentity === true ? observedBuildId : headers[config.buildIdHeader.toLowerCase()] };
}
function ensureNetworkEvidence(network) {
  if (!network) return;
  for (const transport of ['http', 'websocket']) network[transport] ??= { attempted: 0, denied: 0, blocked: 0, allowed: 0, actionFailures: 0 };
  network.http.errorResponses ??= 0;
  network.http.requestFailures ??= 0;
  network.analyticsEvidence ??= { attempted: 0, denied: 0, blocked: 0, allowed: 0, actionFailures: 0,
    ga: { attempted: 0, blocked: 0, allowed: 0 }, gtm: { attempted: 0, blocked: 0, allowed: 0 } };
  network.guardFailures ??= 0;
}
export function recordNetworkAttempt(raw, method, resourceType, decision, network, transport = 'http') {
  if (!network) return;
  ensureNetworkEvidence(network);
  network.attempted++;
  const root = analyticsHost(raw);
  let pathname = '', protocol = 'other';
  try { const url = new URL(raw); pathname = url.pathname; if (['http:', 'https:', 'ws:', 'wss:', 'ftp:', 'data:', 'blob:'].includes(url.protocol)) protocol = url.protocol; } catch { /* counters only */ }
  const ga = root === 'google-analytics.com' || root === 'analytics.google.com', gtm = root === 'googletagmanager.com';
  if (ga) network.ga++;
  if (gtm) network.gtm++;
  if (decision === 'analytics') network.analytics++;
  const denied = transport === 'websocket' || decision !== 'allow' || !['GET', 'HEAD'].includes(method);
  if (denied) network.blocked++; // Legacy field is policy-denied attempts, not confirmed abort outcomes.
  network[transport].attempted++;
  if (denied) network[transport].denied++;
  if (root) {
    network.analyticsEvidence.attempted++;
    if (denied) network.analyticsEvidence.denied++;
    if (ga) network.analyticsEvidence.ga.attempted++;
    if (gtm) network.analyticsEvidence.gtm.attempted++;
  }
  const types = ['document', 'stylesheet', 'image', 'media', 'font', 'script', 'texttrack', 'xhr', 'fetch', 'eventsource', 'websocket', 'manifest', 'other'];
  if (network.requests.length < 500) network.requests.push({ transport, protocol, method: /^[A-Z]{1,10}$/.test(method) ? method : 'other', resourceType: types.includes(resourceType) ? resourceType : 'unknown', decision: denied ? decision === 'allow' ? transport === 'websocket' ? 'websocket' : 'method' : decision : 'allow',
    ...(decision === 'allow' && transport === 'http' ? { pathname } : root ? { hostname: root } : {}) });
  else network.truncated = true;
}
export function recordNetworkOutcome(raw, transport, outcome, network) {
  if (!network) return;
  ensureNetworkEvidence(network);
  network[transport][outcome]++;
  const root = analyticsHost(raw);
  if (outcome === 'actionFailures') network.guardFailures++;
  if (!root) return;
  network.analyticsEvidence[outcome]++;
  if (outcome === 'blocked' || outcome === 'allowed') {
    if (root === 'google-analytics.com' || root === 'analytics.google.com') network.analyticsEvidence.ga[outcome]++;
    if (root === 'googletagmanager.com') network.analyticsEvidence.gtm[outcome]++;
  }
}
export async function installGuards(context, origin, counters, network, now = () => new Date().toISOString()) {
  const startedAt = now();
  ensureNetworkEvidence(network);
  if (typeof context.routeWebSocket !== 'function') throw Error('websocket_guard_unavailable');
  if (typeof context.on !== 'function') throw Error('http_observation_unavailable');
  const failed = async (raw, transport) => {
    recordNetworkOutcome(raw, transport, 'actionFailures', network);
    // Close only this owned context on failed enforcement. Do not permit a failed abort as success.
    try { await context.close(); } catch { if (network) network.contextCloseFailures = (network.contextCloseFailures ?? 0) + 1; }
  };
  await context.route('**/*', async route => {
    const request = route.request(), raw = request.url(), method = request.method();
    const decision = requestDecision(raw, origin);
    recordNetworkAttempt(raw, method, request.resourceType?.() ?? 'unknown', decision, network);
    const denied = decision !== 'allow' || !['GET', 'HEAD'].includes(method);
    if (denied) counters[decision === 'analytics' ? 'analytics' : 'external']++;
    try {
      if (denied) await route.abort('blockedbyclient'); else await route.continue();
      recordNetworkOutcome(raw, 'http', denied ? 'blocked' : 'allowed', network);
    } catch { await failed(raw, 'http'); }
  });
  await context.routeWebSocket('**/*', async socket => {
    let raw = '';
    let urlObserved = false;
    try { if (typeof socket.url === 'function') { raw = socket.url(); urlObserved = typeof raw === 'string'; } } catch { /* unverified URL closes the owned context below */ }
    const decision = analyticsHost(raw) ? 'analytics' : 'external';
    recordNetworkAttempt(raw, 'GET', 'websocket', decision, network, 'websocket');
    counters[decision === 'analytics' ? 'analytics' : 'external']++;
    if (!urlObserved) { await failed('', 'websocket'); return; }
    try { await socket.close(); recordNetworkOutcome(raw, 'websocket', 'blocked', network); }
    catch { await failed(raw, 'websocket'); }
  });
  context.on('response', response => { if (response.status() >= 400 && network) network.http.errorResponses++; });
  context.on('requestfailed', () => { if (network) network.http.requestFailures++; });
  await context.addInitScript(() => {
    localStorage.setItem('blog-analytics-opt-out', '1');
    localStorage.setItem('tag-analytics-opt-out', '1');
    localStorage.setItem('youtube-analytics-opt-out', '1');
    Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' });
  });
  return { status: 'installed', startedAt, installedAt: now(), phase: 'before-newPage-and-first-navigation',
    requestRouteInstalled: true, websocketRouteInstalled: true, initScriptInstalled: true, httpEventObserversInstalled: true, rules: NETWORK_GUARD_RULES };
}
/** Only the two allowed request fields are read; no bulk headers or native GPC override. */
export async function observePrivacy(request, navigatorValues) {
  const field = async name => { const value = await request.headerValue(name); return value === null || value === undefined ? null : value === '1' || value === '0' ? value : 'unsupported'; };
  return { documentDNT: await field('dnt'), documentSecGPC: await field('sec-gpc'), navigatorDNT: ['1', '0'].includes(navigatorValues.doNotTrack) ? navigatorValues.doNotTrack : null,
    navigatorDoNotTrack: navigatorValues.doNotTrack === '1' ? true : navigatorValues.doNotTrack === '0' ? false : null,
    navigatorGPC: typeof navigatorValues.globalPrivacyControl === 'boolean' ? navigatorValues.globalPrivacyControl : null };
}
export function requireDNT(privacy) {
  if (privacy.documentDNT !== '1' || privacy.navigatorDNT !== '1') throw Error('privacy_unverified');
}
function rgba(color) {
  if (color === 'transparent') return [0, 0, 0, 0];
  const match = /^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(color ?? '');
  if (!match) return null;
  const values = [Number(match[1])/255, Number(match[2])/255, Number(match[3])/255, match[4] === undefined ? 1 : Number(match[4])];
  return values.every(v => Number.isFinite(v) && v >= 0 && v <= 1) ? values : null;
}
const over = (top, bottom) => {
  const alpha = top[3] + bottom[3]*(1-top[3]);
  return alpha ? [...top.slice(0,3).map((v,i)=>(v*top[3]+bottom[i]*bottom[3]*(1-top[3]))/alpha),alpha] : [0,0,0,0];
};
export function assessContrast(sample) {
  const unknown = reason => ({ ...sample, ratio: null, threshold: null, result: 'unknown', reason });
  const fg = rgba(sample.foreground);
  if (!fg || !Array.isArray(sample.backgrounds) || !sample.backgrounds.length || !Number.isFinite(sample.fontSize) || !Number.isFinite(sample.fontWeight)) return unknown('unsupported_color_or_font');
  let bg=[0,0,0,0];
  for (const layer of sample.backgrounds) {
    const color=rgba(layer.color);
    if (!color || layer.image !== 'none' || !Number.isFinite(layer.opacity) || layer.opacity !== 1) return unknown('unsupported_background_or_ancestor_opacity');
    bg=over(color,bg);
  }
  if (bg[3] < 1 || !Number.isFinite(sample.opacity) || sample.opacity < 0 || sample.opacity > 1) return unknown('unresolved_transparency');
  const text=over([...fg.slice(0,3),fg[3]*sample.opacity],bg);
  const luminance = rgb => rgb.slice(0,3).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
  const a=luminance(text),b=luminance(bg), ratio=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
  const threshold=sample.fontSize>=24 || (sample.fontSize>=18.6666667 && sample.fontWeight>=700) ? 3 : 4.5;
  return { ...sample, composedBackground: bg, effectiveForeground: text, ratio, threshold, result: ratio>=threshold?'pass-sample':'fail-sample' };
}
/** Bounded visible secondary-class sample, no text/title/content/identity copied. */
export function collectSecondaryContrastDOM() {
  const output=[];
  for (const element of document.querySelectorAll('main [class]')) {
    const classes=Array.from(element.classList).filter(c=>/^(?:dark:)?text-zinc-(?:400|500|600)$/.test(c));
    if (!classes.length) continue;
    const box=element.getBoundingClientRect(),style=getComputedStyle(element);
    if (box.width<=0 || box.height<=0 || box.bottom<=0 || box.top>=innerHeight || box.right<=0 || box.left>=innerWidth || style.visibility!=='visible' || Number(style.opacity)===0) continue;
    const backgrounds=[];
    let parent=element.parentElement,depth=0;
    while(parent && depth++<32) { const s=getComputedStyle(parent);backgrounds.unshift({color:s.backgroundColor,image:s.backgroundImage === 'none' ? 'none' : 'unsupported',opacity:Number(s.opacity)});parent=parent.parentElement; }
    // Own background is separate from its own text opacity; fractional group opacity is unsupported, not guessed.
    backgrounds.push({color:style.backgroundColor,image:style.backgroundImage === 'none' ? 'none' : 'unsupported',opacity:Number(style.opacity)});
    output.push({ordinal:output.length+1,tagName:element.tagName,classes,fontSize:Number.parseFloat(style.fontSize),fontWeight:Number.parseFloat(style.fontWeight),foreground:style.color,opacity:Number(style.opacity),backgrounds,ancestorLimitReached:Boolean(parent)});
    if(output.length===20)break;
  }
  return output;
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
export function summarizeHomepageSamples(host, samples) {
  if (samples.length !== 3 || samples.some(s => s.status !== 200 || !Number.isFinite(s.totalSeconds) || s.totalSeconds < 0)) throw Error('ttfb_gate');
  const median = key => samples.map(s => s[key]).sort((a,b) => a-b)[1];
  return { host, status: 200, totalSeconds: median('totalSeconds'), ttfbSeconds: median('ttfbSeconds'), samples };
}
async function formalTTFB(onAttempt = () => {}) {
  const rows = [];
  for (const host of ['blog.observe.tw', 'tag.observe.tw', 'youtube.observe.tw']) {
    const samples=[];
    for (let sample=0;sample<3;sample++) {
      const start = performance.now(), startedAt=new Date().toISOString();
      onAttempt({ host, sample, status: 'started', utc: startedAt });
      let response, bytes=0;
      try {
        response = await fetch(`https://${host}/`, { headers: { DNT: '1', Accept: 'text/html' }, redirect: 'error', signal: AbortSignal.timeout(Math.max(5000,TTFB_LIMITS[host]*2000+1000)) });
        const ttfbSeconds = (performance.now() - start) / 1000;
        const reader = response.body?.getReader();
        if (reader) try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 2 * MiB) throw Error('probe_body_limit'); } } finally { await reader.cancel().catch(() => undefined); }
        const row = { startedAt, endedAt:new Date().toISOString(), totalSeconds: (performance.now() - start) / 1000, ttfbSeconds, status: response.status, bytes, cfCacheStatus:response.headers.get('cf-cache-status'), exit:0 };
        samples.push(row);
        onAttempt({ ...row, host, sample, status: 'completed', httpStatus: response.status, utc:row.endedAt });
        if (response.status !== 200) throw Error('http_error');
      } catch {
        onAttempt({ host, sample, status: 'failed', httpStatus: response?.status ?? null, bytes, exit:1, utc: new Date().toISOString() });
        throw Error('ttfb_gate');
      }
    }
    rows.push(summarizeHomepageSamples(host,samples));
  }
  return rows;
}
export async function globalHomepageProbe(report, phase, deps) {
  const receipt = { phase, startedAt: deps.now(), endedAt: null, status: 'running',
    scope: 'user-required-global-resource-gate; applies-to-formal-and-candidate', transport: 'independent-Node-fetch',
    path: '/', method: 'GET', configuredDNT: '1', configuredAccept: 'text/html', observedRequestDNT: null,
    browserNetworkIncluded: false, javascriptExecuted: false, resourceSubrequests: false,
    homepageBaseline: HOMEPAGE_BASELINE, eventsSource: 'dependency-result-only',
    attempts: Object.keys(TTFB_LIMITS).map(host => ({ host, attempted: false, status: 'not-attempted' })) };
  report.globalHomepageProbes ??= [];
  report.globalHomepageProbes.push(receipt);
  const observe = event => {
    const slot = receipt.attempts.find(row => row.host === event?.host);
    if (!slot || !['started', 'completed', 'failed'].includes(event.status)) return;
    receipt.eventsSource = 'transport-attempt-events';
    slot.attempted = true; slot.status = event.status;
    slot.events ??= [];
    slot.utc = typeof event.utc === 'string' && /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(event.utc) ? event.utc : null;
    if (event.httpStatus === null || Number.isInteger(event.httpStatus) && event.httpStatus >= 100 && event.httpStatus <= 599) slot.httpStatus = event.httpStatus;
    for (const field of ['totalSeconds', 'ttfbSeconds']) if (Number.isFinite(event[field]) && event[field] >= 0) slot[field] = event[field];
    const safe = { status:event.status, utc:slot.utc, httpStatus:slot.httpStatus };
    for (const field of ['sample','bytes','exit']) if (Number.isSafeInteger(event[field]) && event[field]>=0) safe[field]=event[field];
    for (const field of ['totalSeconds','ttfbSeconds']) if (Number.isFinite(event[field]) && event[field]>=0) safe[field]=event[field];
    if (['HIT','MISS','DYNAMIC','BYPASS','EXPIRED','REVALIDATED','UPDATING'].includes(event.cfCacheStatus)) safe.cfCacheStatus=event.cfCacheStatus;
    slot.events.push(safe);
  };
  try {
    const rows = await deps.ttfb(observe);
    for (const row of Array.isArray(rows) ? rows : []) {
      const slot = receipt.attempts.find(item => item.host === row?.host);
      if (slot) { if (row.samples) slot.samples=row.samples; slot.attempted = true; slot.status = row.status === 200 ? 'completed' : 'http-error';
        if (Number.isInteger(row.status) && row.status >= 100 && row.status <= 599) slot.httpStatus = row.status;
        for (const field of ['totalSeconds', 'ttfbSeconds']) if (Number.isFinite(row[field]) && row[field] >= 0) slot[field] = row[field]; }
    }
    verifyLatencyGate(rows);
    receipt.status = 'passed';
    return rows;
  } catch { receipt.status = 'failed'; throw Error('ttfb_gate'); }
  finally { receipt.endedAt = deps.now(); }
}
export async function capture(config, deps) {
  const batch = plan(config);
  const report = { evidenceVersion: 2, expectedIdentity: { sha: config.expectedSHA, buildId: config.expectedBuildId }, guardSetup: { status: 'not-installed', phase: 'before-newPage-and-first-navigation' }, privacyConfiguration: { documentDNT: '1', navigatorDNT: '1', navigatorDNTSource: 'init-script-override', documentSecGPC: 'not-configured', navigatorGPC: 'not-overridden-by-runner', serviceWorkers: 'block', optOutLocalStorage: ['blog-analytics-opt-out', 'tag-analytics-opt-out', 'youtube-analytics-opt-out'], limitation: 'Configuration is not an observation. Document request values and navigator values are recorded separately per page.' }, homepageBaseline: HOMEPAGE_BASELINE, startedAt: deps.now(), endedAt: null, closeAt: null, closed: false, status: 'stopped', gates: [], pages: [], blocked: { analytics: 0, external: 0 }, network: { attempted: 0, ga: 0, gtm: 0, analytics: 0, blocked: 0, requests: [], truncated: false, limitation: 'External images/fonts/scripts are blocked by default; their absence is not evidence of a page defect.' }, authorization: typeof config.authorization === 'string' ? config.authorization.slice(0, 300) : 'explicit-user-thaw'  };
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
    report.beforeTTFB = await globalHomepageProbe(report, 'before', deps);
    const launchGate = await deps.gate(); report.gates.push({ phase: 'prelaunch', ...launchGate }); verifyGate(launchGate, batch.estimatedBytes);
    await proveQuota();
    browser = await deps.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { DNT: '1' }, serviceWorkers: 'block', permissions: [], acceptDownloads: false });
    report.guardSetup = { ...report.guardSetup, status: 'installing', startedAt: deps.now() };
    report.guardSetup = await installGuards(context, batch.targetOrigin, report.blocked, report.network, deps.now);
    if (report.network.guardFailures) throw Error('network_guard_unverified');
    for (const item of batch.pages) {
    const page = await context.newPage();
    report.guardSetup.pageCreatedAt = deps.now();
    await page.emulateMedia({ colorScheme: item.theme });
    await page.addInitScript(theme => localStorage.setItem('theme', theme), item.theme);
    let identityFailure = false;
    page.on('response', response => {
      if (!config.localIdentity && response.request().resourceType() === 'document') {
        try { if (config.htmlBuildIdentity === true) { if (response.headers()['x-blog-release'] !== config.expectedSHA) throw Error('identity_unverified'); } else verifyIdentity(response.headers(), config); } catch { identityFailure = true; }
      }
    });
      report.currentPathname = new URL(item.url).pathname;
      await proveQuota();
      const gate = await deps.gate(); report.gates.push({ phase: 'page', ...gate });
      // Keep raw pgrep diagnostics separate from browser-root counts. Flock
      // constrains participants only; stop if the live root inventory exceeds two.
      if (!Number.isFinite(gate.load) || gate.load > LIMITS.load || !Number.isSafeInteger(gate.browserRoots) || gate.browserRoots < 0 || gate.browserRoots > 2 || !Number.isFinite(gate.available) || gate.available - Math.max(0, batch.estimatedBytes - report.pages.reduce((sum, row) => sum + row.bytes, 0)) < LIMITS.stopReserve) throw Error('page_gate');
      await page.setViewportSize({ width: item.width, height: item.height });
      report.guardSetup.firstNavigationAt ??= deps.now();
      const response = await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      if (!response || response.status() !== 200) throw Error('document_unavailable');
      const identity = config.localIdentity ? await deps.verifyLocalProcess?.() : verifyIdentity(await response.allHeaders(), config, config.htmlBuildIdentity === true ? htmlNextBuildId(await response.text()) : undefined);
      if (config.localIdentity && (!identity || ['buildId','nextPid','nextStart','nextPort','port','cwd','releaseDir','gatewayPid','gatewayStart','gatewayCwd','gatewayUiOrigin','nextGatewayOrigin'].some(key => identity[key] !== report.localIdentity[key]))) throw Error('identity_unverified');
      await deps.sleep(LIMITS.delay);
      await proveQuota();
      if (config.localIdentity) { const current = await deps.verifyLocalProcess?.(); if (!current || ['buildId','nextPid','nextStart','nextPort','port','cwd','releaseDir','gatewayPid','gatewayStart','gatewayCwd','gatewayUiOrigin','nextGatewayOrigin'].some(key => current[key] !== identity[key])) throw Error('identity_unverified'); }
      if (identityFailure || page.url() !== item.url) throw Error('document_identity_changed');
      const saveGate = await deps.gate(); report.gates.push({ phase: 'presave', ...saveGate });
      if (!Number.isFinite(saveGate.load) || saveGate.load > LIMITS.load || !Number.isFinite(saveGate.available) || saveGate.available - batch.estimatedBytes < LIMITS.stopReserve || !Number.isSafeInteger(saveGate.browserRoots) || saveGate.browserRoots < 0 || saveGate.browserRoots > 2) throw Error('page_gate');
      const observedTheme = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, darkMedia: matchMedia('(prefers-color-scheme: dark)').matches }));
      if (observedTheme.theme !== item.theme || observedTheme.darkMedia !== (item.theme === 'dark')) throw Error('theme_unverified');
      const navigatorValues = await page.evaluate(() => ({ doNotTrack: navigator.doNotTrack, globalPrivacyControl: typeof navigator.globalPrivacyControl === 'boolean' ? navigator.globalPrivacyControl : null }));
      const privacy = await observePrivacy(response.request(), navigatorValues);
      report.privacyObservations ??= [];
      report.privacyObservations.push({ pathname: new URL(item.url).pathname, utc: deps.now(), ...privacy });
      requireDNT(privacy);
      if (report.network.guardFailures || report.network.analyticsEvidence?.allowed) throw Error('network_guard_unverified');
      const contrastSamples = (await page.evaluate(collectSecondaryContrastDOM)).map(sample => sample.ancestorLimitReached ? { ...sample, ratio: null, result: 'unknown', reason: 'ancestor_limit' } : assessContrast(sample));
      const png = await page.screenshot({ fullPage: false });
      if (png.length > item.width * item.height * 4 || report.pages.reduce((sum, row) => sum + row.bytes, 0) + png.length > LIMITS.bytes) throw Error('actual_artifact_budget');
      await deps.saveImage(item.name, png);
      report.pages.push({ privacyObservation: { source: 'actual-document-request-and-navigator', navigatorDNTSource: 'observed-value; init-script-override-configured', navigatorGPCSource: 'observed-value; runner-does-not-override' }, privacy, contrastSamples, contrastLimitation: 'Visible main secondary-class DOM samples only; unsupported CSS colors/backgrounds/group opacity remain unknown, not a full WCAG scan.', name: item.name, pathname: new URL(item.url).pathname, viewport: [item.width, item.height], theme: observedTheme.theme, darkMedia: observedTheme.darkMedia, utc: deps.now(), identity: config.localIdentity ? { ...identity, sha: report.localIdentity.sha, sourceTreeHash: report.localIdentity.sourceTreeHash } : identity, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), status: 'captured-unreviewed' });
      await page.close();
    }
    if (report.network.guardFailures || report.network.analyticsEvidence?.allowed) throw Error('network_guard_unverified');
    report.status = 'captured-unreviewed';
  } catch (error) { noteProcessFailure(error, report.currentPathname ? 'page' : 'initial'); report.error = error.message && /^[a-z_]+$/.test(error.message) ? error.message : 'capture_stopped'; }
  finally {
    try { if (browser) { await browser.close(); report.closed = true; report.closeAt = deps.now(); } }
    catch { report.closed = false; report.error = 'browser_close_failed'; }
    try { if (!browser || report.closed) await lease?.release(); else report.quotaRetained = 'browser_close_failed'; } catch { report.error = 'quota_release_failed'; }
    try {
      const after = await deps.gate(); report.gates.push({ phase: 'after', ...after });
      if (browser && report.closed && report.beforeTTFB && Number.isFinite(after.load) && after.load <= LIMITS.load) {
        try { report.afterTTFB = await globalHomepageProbe(report, 'after', deps); }
        catch { report.afterGateError = 'ttfb_gate'; report.error ??= 'after_ttfb_gate'; report.status = 'stopped'; }
      }
      else report.afterTTFBSkipped = 'no_completed_browser_or_load_gate';
    } catch (error) { noteProcessFailure(error, 'after'); report.afterGateError = 'gate_unavailable'; }
    if (report.network.guardFailures || report.network.analyticsEvidence?.allowed) { report.error ??= 'network_guard_unverified'; report.status = 'stopped'; }
    report.network.evidenceSemantics = { legacyBlocked: 'policy-denied attempts', blocked: 'route.abort or websocket.close completed', allowed: 'route.continue completed; not proof of packet delivery', httpErrors: 'observed HTTP status >=400; response bodies not logged', requestFailures: 'observed requestfailed including guard aborts, not all server errors', analyticsOutbound: 'No analytics route was permitted only when allowed=0, actionFailures=0 and pre-navigation guards installed; not packet capture', limitation: 'Counters cover intercepted requests and websocket routes, not a host-wide packet trace; independent Node homepage probes are recorded separately and are outbound HTML requests. Zero analytics allowed is not zero all outbound. Truncated rows do not truncate counters.' };
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
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => { console.error('ui_capture_refused'); process.exitCode = 1; });
