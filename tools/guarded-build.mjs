/** Root-approved web builds only. Import-safe: tests inject all I/O; no automatic resume or cleanup. */
import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, realpath, statfs, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const GiB = 1024 ** 3;
export const BUILD_LIMITS = Object.freeze({ startBytes: 40 * GiB, stopBytes: 30 * GiB, load1: 12, homepageMs: 2000, intervalMs: 1000 });
export const BUILD_LOCKS = Object.freeze(['/home/deck/.cache/observe-build-0.lock', '/home/deck/.cache/observe-build-1.lock']);
export const APPROVAL_ROOT = '/home/deck/.t3/projects/blog-observe-tw/.reviews/guarded-build';
export const HOMES = Object.freeze([
  { site: 'blog', url: 'https://blog.observe.tw/', limitMs: 6000 },
  { site: 'tag', url: 'https://tag.observe.tw/', limitMs: 2000 },
  { site: 'youtube', url: 'https://youtube.observe.tw/', limitMs: 2000 },
]);
export function buildPlan(approval, now = Date.now()) {
  if (
    approval?.kind !== 'root-approved-web-build-v1' ||
    typeof approval.cwd !== 'string' ||
    !approval.cwd.startsWith('/home/deck/') ||
    resolve(approval.cwd) !== approval.cwd ||
    /\/(?:releases?|temp|tmp)(?:\/|$)/i.test(approval.cwd) ||
    approval.gatewayInternalUrl !== 'http://127.0.0.1:18175' ||
    !/^[a-f0-9]{40}$/.test(approval.sha ?? '') ||
    !Number.isFinite(approval.estimatedGiB) ||
    approval.estimatedGiB <= 0 ||
    approval.estimatedGiB > 100 ||
    !Number.isFinite(Date.parse(approval.expiresAt)) ||
    Date.parse(approval.expiresAt) <= now
  )
    throw Error('invalid_root_approval');
  return {
    cwd: approval.cwd,
    projectCwd: approval.cwd,
    sha: approval.sha,
    gatewayInternalUrl: approval.gatewayInternalUrl,
    estimatedBytes: Math.ceil(approval.estimatedGiB * GiB),
    command: '/usr/bin/nice',
    args: ['-n', '19', '/usr/bin/ionice', '-c', '3', process.execPath, fileURLToPath(import.meta.url), '--handshake-child', approval.cwd],
  };
}
export function resourceReason(resource, estimate, stage) {
  if (
    !Number.isFinite(resource?.available) ||
    resource.available < 0 ||
    !Number.isFinite(resource.load1) ||
    resource.load1 < 0 ||
    !Number.isSafeInteger(resource.otherBuilds) ||
    resource.otherBuilds < 0
  )
    return 'resource_unproven';
  if (resource.otherBuilds >= 2) return 'other_build';
  if (resource.load1 > BUILD_LIMITS.load1) return 'load';
  if (
    stage === 'start'
      ? resource.available < BUILD_LIMITS.startBytes || resource.available - estimate < BUILD_LIMITS.startBytes
      : resource.available < BUILD_LIMITS.stopBytes
  )
    return 'disk';
  return null;
}
export function gateReason(resource, probes, estimate, stage) {
  const resourceGate = resourceReason(resource, estimate, stage);
  if (resourceGate) return resourceGate;
  if (!Array.isArray(probes) || probes.length !== HOMES.length) return 'homepage_unproven';
  for (const { site, limitMs } of HOMES) {
    const matching = probes.filter((p) => p?.site === site);
    if (
      matching.length !== 1 ||
      matching[0].status !== 200 ||
      !Number.isFinite(matching[0].totalMs) ||
      matching[0].totalMs < 0 ||
      matching[0].totalMs > limitMs ||
      matching[0].complete !== true
    )
      return 'homepage';
  }
  return null;
}
export function procIdentity(pid, stat) {
  const tail = stat
    .slice(stat.lastIndexOf(')') + 2)
    .trim()
    .split(/\s+/);
  if (!Number.isSafeInteger(pid) || pid < 2 || tail.length < 20) throw Error('process_unproven');
  return { pid, state: tail[0], ppid: Number(tail[1]), pgid: Number(tail[2]), session: Number(tail[3]), startTicks: tail[19] };
}
export function ownedGroup(original, current, parentPid) {
  return (
    original?.pid > 1 &&
    original.pid === current?.pid &&
    original.startTicks === current.startTicks &&
    original.pgid === original.pid &&
    current.pgid === original.pgid &&
    current.session === original.pid &&
    current.ppid === parentPid &&
    !['Z', 'X'].includes(current.state)
  );
}
export function isBuildCommand(argv) {
  if (!Array.isArray(argv) || !argv.length) return false;
  const command = argv[0].split('/').at(-1);
  return (
    ((command === 'node' || command === 'npm' || command === 'flock') &&
      argv.some((a) => /(?:^|\/)build-web\.mjs$/.test(a) || /(?:^|\/)next(?:\.js)?$/.test(a)) &&
      (argv.includes('build') || argv.some((a) => /build-web\.mjs$/.test(a)))) ||
    (command === 'docker' && argv.slice(1).includes('build')) ||
    (command === 'buildctl' && argv.includes('build')) ||
    (command === 'node' && argv.includes('--handshake-child'))
  );
}
async function readIdentity(pid) {
  return procIdentity(pid, await readFile(`/proc/${pid}/stat`, 'utf8'));
}
export const scanProcessPid = (name) => /^\d+$/.test(name) && Number(name) > 1;
async function resources(ownedPid = null) {
  const disk = await statfs('/home', { bigint: true });
  const otherGroups = new Set();
  for (const name of await readdir('/proc')) {
    if (!scanProcessPid(name)) continue;
    try {
      const identity = await readIdentity(Number(name));
      if (['Z', 'X'].includes(identity.state) || identity.pgid === ownedPid) continue;
      const argv = (await readFile(`/proc/${name}/cmdline`, 'utf8')).split('\0').filter(Boolean);
      if (isBuildCommand(argv)) otherGroups.add(identity.pgid);
    } catch (error) {
      if (!['ENOENT', 'ESRCH'].includes(error?.code)) throw Error('process_scan_unproven');
    }
  }
  return { available: Number(disk.bavail * disk.bsize), load1: loadavg()[0], otherBuilds: otherGroups.size };
}
/** Full final HTTP response body, not early hints/TTFB; no cookies/token/header/body logged. */
async function probes() {
  const result = [];
  for (const home of HOMES) {
    const started = performance.now();
    let response;
    try {
      response = await fetch(home.url, {
        redirect: 'manual',
        cache: 'no-store',
        headers: { DNT: '1' },
        signal: AbortSignal.timeout(home.limitMs),
      });
      let bytes = 0;
      if (!response.body) throw Error('homepage_incomplete');
      for await (const chunk of response.body) {
        bytes += chunk.byteLength;
        if (bytes > 8 * 1024 ** 2) throw Error('homepage_oversized');
      }
      result.push({ site: home.site, status: response.status, totalMs: performance.now() - started, complete: true });
    } catch {
      await response?.body?.cancel().catch(() => {});
      result.push({ site: home.site, status: response?.status ?? null, totalMs: performance.now() - started, complete: false });
    }
  }
  return result;
}
export function buildOptions(plan, environment = process.env) {
  return {
    cwd: plan.cwd,
    detached: true,
    shell: false,
    stdio: ['pipe', 'ignore', 'ignore'],
    env: {
      ...environment,
      CIRCLE_NODE_TOTAL: '2',
      RAYON_NUM_THREADS: '2',
      UV_THREADPOOL_SIZE: '2',
      BLOG_GATEWAY_INTERNAL_URL: plan.gatewayInternalUrl,
    },
  };
}
export function detachBuild(child) {
  child.stdin?.unref?.();
  child.unref();
}
function spawnBuild(plan) {
  const child = spawn(plan.command, plan.args, buildOptions(plan));
  const receipt = {
    pid: child.pid,
    exited: false,
    code: null,
    failed: false,
    detach: () => detachBuild(child),
    cancel: () => {
      child.stdin?.end();
    },
    go: (owned) =>
      new Promise((resolveGo) =>
        child.stdin.write(JSON.stringify({ type: 'GO', owner: owned, parentPid: process.pid }) + '\n', (error) => resolveGo(!error)),
      ),
  };
  child.stdin?.on('error', () => {});
  child.once('error', () => {
    receipt.failed = true;
    receipt.exited = true;
  });
  child.once('exit', (code) => {
    receipt.exited = true;
    receipt.code = code;
  });
  return receipt;
}
const defaults = {
  resources,
  probes,
  spawn: spawnBuild,
  identity: readIdentity,
  signal: (pid, signal) => process.kill(pid, signal),
  wait: (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms)),
  now: () => new Date().toISOString(),
  monotonic: () => performance.now(),
  parentPid: process.pid,
};
/** Only safe numeric gate fields and a fixed reason leave this runner. Build stdout/stderr are never captured. */
export async function guardedBuild(approval, injected = {}) {
  const deps = { ...defaults, ...injected },
    plan = buildPlan(approval);
  const events = [];
  let gateSamples = 0;
  const note = (stage, resource, measurements) => {
    gateSamples++;
    if (events.length >= 100) events.splice(1, 1);
    events.push({
      utc: deps.now(),
      stage,
      availableBytes: Number.isFinite(resource?.available) ? resource.available : null,
      load1: Number.isFinite(resource?.load1) ? resource.load1 : null,
      otherBuilds: Number.isSafeInteger(resource?.otherBuilds) ? resource.otherBuilds : null,
      homes: HOMES.map(({ site }) => {
        const p = measurements?.find((value) => value?.site === site);
        return {
          site,
          status: Number.isInteger(p?.status) && p.status >= 100 && p.status <= 599 ? p.status : null,
          totalMs: Number.isFinite(p?.totalMs) ? p.totalMs : null,
          complete: p?.complete === true,
        };
      }),
    });
  };
  let first, homes;
  try {
    first = await deps.resources();
    if (!resourceReason(first, plan.estimatedBytes, 'start')) homes = await deps.probes();
  } catch {
    return { status: 'blocked', reason: 'gate_unproven', sha: plan.sha, gateSamples, events };
  }
  note('start', first, homes);
  const reason = gateReason(first, homes, plan.estimatedBytes, 'start');
  if (reason) return { status: 'blocked', reason, sha: plan.sha, gateSamples, events };
  // Recheck host state immediately before attempting the atomic flock slot.
  try {
    first = await deps.resources();
  } catch {
    return { status: 'blocked', reason: 'resource_unproven', sha: plan.sha, gateSamples, events };
  }
  if (gateReason(first, homes, plan.estimatedBytes, 'start'))
    return { status: 'blocked', reason: 'start_changed', sha: plan.sha, gateSamples, events };
  let child;
  try {
    buildPlan(approval);
    child = deps.spawn(plan);
  } catch {
    return { status: 'failed', reason: 'spawn_failed', sha: plan.sha, gateSamples, events };
  }
  if (child.exited) {
    child.cancel();
    child.detach();
    return { status: 'failed', reason: child.code === 73 ? 'flock_busy' : 'spawn_failed', sha: plan.sha, gateSamples, events };
  }
  let owned;
  try {
    owned = await deps.identity(child.pid);
    if (!ownedGroup(owned, owned, deps.parentPid)) throw Error('ownership_unproven');
  } catch {
    child.cancel();
    child.detach();
    return { status: 'failed', reason: child.code === 73 ? 'flock_busy' : 'ownership_unproven', sha: plan.sha, gateSamples, events };
  }
  // No build has begun: the controlled child is waiting for this verified GO.
  try {
    const beforeGo = await deps.resources(child.pid);
    if (resourceReason(beforeGo, plan.estimatedBytes, 'start')) throw Error('start_changed');
    if (!(await child.go(owned))) throw Error('handshake_failed');
  } catch {
    child.cancel();
    child.detach();
    return { status: 'blocked', reason: 'handshake_closed', sha: plan.sha, gateSamples, events };
  }
  let lastHomes = homes,
    nextProbe = deps.monotonic() + 10000;
  while (!child.exited) {
    let resource, measurements, why;
    try {
      resource = await deps.resources(child.pid);
      why = resourceReason(resource, plan.estimatedBytes, 'monitor');
      if (!why) {
        if (deps.monotonic() >= nextProbe) {
          lastHomes = await deps.probes();
          nextProbe = deps.monotonic() + 10000;
        }
        measurements = lastHomes;
        why = gateReason(resource, measurements, plan.estimatedBytes, 'monitor');
      }
    } catch {
      why = 'monitor_unproven';
    }
    note('monitor', resource, measurements);
    if (child.exited) {
      if (why) {
        child.detach();
        return { status: 'failed', reason: 'final_gate', sha: plan.sha, gateSamples, events };
      }
      break;
    }
    if (why) {
      try {
        const current = await deps.identity(child.pid);
        if (!ownedGroup(owned, current, deps.parentPid)) throw Error('ownership_unproven');
        deps.signal(-owned.pid, 'SIGSTOP');
        child.detach();
        return {
          status: 'paused',
          reason: why,
          sha: plan.sha,
          gateSamples,
          ownerUid: process.getuid(),
          runnerPid: deps.parentPid,
          ownedPid: owned.pid,
          ownedPgid: owned.pgid,
          ownedStartTicks: owned.startTicks,
          autoResume: false,
          events,
        };
      } catch {
        child.cancel();
        child.detach();
        return { status: 'failed', reason: 'ownership_unproven', sha: plan.sha, gateSamples, events };
      }
    }
    await deps.wait(BUILD_LIMITS.intervalMs);
  }
  child.detach();
  if (child.code === 0 && !child.failed) {
    try {
      const after = await deps.resources();
      const afterHomes = await deps.probes();
      note('final', after, afterHomes);
      if (gateReason(after, afterHomes, plan.estimatedBytes, 'monitor'))
        return { status: 'failed', reason: 'final_gate', sha: plan.sha, gateSamples, events };
    } catch {
      return { status: 'failed', reason: 'final_gate', sha: plan.sha, gateSamples, events };
    }
  }
  return {
    status: child.code === 0 && !child.failed ? 'complete' : 'failed',
    reason: child.code === 73 ? 'flock_busy' : child.failed ? 'spawn_failed' : 'build_exit',
    sha: plan.sha,
    gateSamples,
    exitCode: child.code,
    events,
  };
}
/** One shared open-file description survives the short flock utility; the controlled child retains the FD while paused. */
export async function claimBuildSlot(openSlot, lockFd) {
  for (const slot of BUILD_LOCKS) {
    const handle = await openSlot(slot);
    const code = await lockFd(handle.fd);
    if (code === 0) return { slot, handle };
    await handle.close();
    if (code !== 73) throw Error('build_slot_unproven');
  }
  return null;
}
function lockFd(fd) {
  return new Promise((resolveLock, reject) => {
    const child = spawn('/usr/bin/flock', ['--nonblock', '--conflict-exit-code', '73', '3'], {
      stdio: ['ignore', 'ignore', 'ignore', fd],
      shell: false,
    });
    child.once('error', () => reject(Error('build_slot_unproven')));
    child.once('exit', (code) => resolveLock(code));
  });
}
function handshakeChild(cwd) {
  let buffer = '',
    starting = false,
    started = false,
    closed = false,
    self;
  const deadline = setTimeout(() => process.exit(1), 10000);
  const controllerClosed = () => {
    closed = true;
    if (started) {
      process.kill(-self.pgid, 'SIGSTOP');
    } else if (!starting) process.exit(1);
  };
  process.stdin.on('end', controllerClosed);
  process.stdin.on('error', controllerClosed);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > 4096 || starting) {
      controllerClosed();
      return;
    }
    if (!buffer.includes('\n')) return;
    starting = true;
    clearTimeout(deadline);
    (async () => {
      const go = JSON.parse(buffer.trim());
      self = await readIdentity(process.pid);
      if (go.type !== 'GO' || !ownedGroup(go.owner, self, go.parentPid) || (await realpath(cwd)) !== cwd) throw Error('handshake_unproven');
      const slot = await claimBuildSlot(async (path) => {
        const handle = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
        const stat = await handle.stat();
        if (!stat.isFile() || stat.uid !== process.getuid()) {
          await handle.close();
          throw Error('build_slot_unproven');
        }
        return handle;
      }, lockFd);
      if (!slot) process.exit(73);
      if (closed) {
        await slot.handle.close();
        process.exit(1);
      }
      try {
        await lstat(`${cwd}/web/.next`);
        throw Error('existing_build_artifacts');
      } catch (error) {
        if (error.code !== 'ENOENT') {
          await slot.handle.close();
          throw error;
        }
      }
      if (closed) {
        await slot.handle.close();
        process.exit(1);
      }
      started = true;
      // Fixed complete clean build + npm postbuild + standalone pair check. No detached descendants.
      const pipeline = spawn(process.execPath, [`${cwd}/tools/build-web.mjs`], {
        cwd,
        detached: false,
        shell: false,
        stdio: 'ignore',
        env: process.env,
      });
      const finish = (code) => {
        started = false;
        slot.handle.close().finally(() => process.exit(code));
      };
      pipeline.once('error', () => finish(1));
      pipeline.once('exit', (code) => finish(Number.isInteger(code) ? code : 1));
    })().catch(() => {
      if (started) controllerClosed();
      else process.exit(1);
    });
  });
}
async function main() {
  if (process.argv.length !== 3) throw Error('root_approval_required');
  const file = resolve(process.argv[2]);
  if (!file.startsWith(`${APPROVAL_ROOT}/`)) throw Error('invalid_root_approval');
  const stat = await lstat(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 4096 ||
    stat.mode & 0o077 ||
    stat.uid !== process.getuid() ||
    (await realpath(file)) !== file
  )
    throw Error('invalid_root_approval');
  const approval = JSON.parse(await readFile(file, 'utf8')),
    plan = buildPlan(approval);
  if ((await realpath(plan.projectCwd)) !== plan.projectCwd) throw Error('invalid_root_approval');
  const head = await exec('git', ['rev-parse', 'HEAD'], { cwd: plan.projectCwd, timeout: 2000 });
  const dirty = await exec('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: plan.projectCwd, timeout: 2000 });
  if (head.stdout.trim() !== plan.sha || dirty.stdout.trim()) throw Error('source_identity_unproven');
  try {
    await lstat(`${plan.projectCwd}/web/.next`);
    throw Error('existing_build_artifacts');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const slot of BUILD_LOCKS) {
    try {
      const lock = await lstat(slot);
      if (!lock.isFile() || lock.isSymbolicLink() || lock.uid !== process.getuid()) throw Error('build_lock_unproven');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const result = await guardedBuild(approval);
  const artifact = `${APPROVAL_ROOT}/run-${Date.now()}-${process.pid}.json`;
  await mkdir(dirname(artifact), { recursive: true, mode: 0o700 });
  await writeFile(artifact, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: result.status, reason: result.reason, artifact }));
  if (result.status !== 'complete') process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--handshake-child' && process.argv.length === 4) handshakeChild(process.argv[3]);
  else
    main().catch(() => {
      console.error(JSON.stringify({ status: 'failed', reason: 'runner_precondition_failed' }));
      process.exitCode = 1;
    });
}
