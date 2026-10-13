import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILD_LOCKS,
  buildOptions,
  buildPlan,
  claimBuildSlot,
  detachBuild,
  gateReason,
  guardedBuild,
  HOMES,
  isBuildCommand,
  ownedGroup,
  scanProcessPid,
} from './guarded-build-blue.mjs';

const approval = {
  kind: 'root-approved-web-build-v1',
  cwd: '/home/deck/.cache/blog-release-source-9888ebf36229400c2323ae12334d72280cbe699a',
  sha: '9888ebf36229400c2323ae12334d72280cbe699a',
  estimatedGiB: 8,
  expiresAt: '2099-01-01T00:00:00Z',
  gatewayInternalUrl: 'http://127.0.0.1:18174',
};
const healthy = { available: 60 * 1024 ** 3, load1: 1, otherBuilds: 0, memoryAvailable: 4 * 1024 ** 3 };
const homes = HOMES.map(({ site }) => ({
  site,
  status: 200,
  totalMs: 100,
  complete: true,
  headers: { authorization: 'NEVER_LOG' },
  body: 'NEVER_LOG',
}));
function fixture(patch = {}) {
  const calls = [],
    child = {
      pid: 1001,
      exited: false,
      code: null,
      detach: () => calls.push(['detach']),
      cancel: () => calls.push(['cancel']),
      go: async () => {
        calls.push(['GO']);
        return true;
      },
    };
  const identity = { pid: 1001, pgid: 1001, session: 1001, ppid: 123, startTicks: '987654', state: 'S' };
  let tick = 0;
  const deps = {
    resources: async () => ({ ...healthy }),
    probes: async () => homes,
    spawn: (plan) => {
      calls.push(['spawn', plan]);
      return child;
    },
    identity: async () => identity,
    signal: (pid, signal) => calls.push(['signal', pid, signal]),
    wait: async () => {
      child.exited = true;
      child.code = 0;
    },
    now: () => new Date(0).toISOString(),
    parentPid: 123,
    monotonic: () => (tick += 10000),
    ...patch,
  };
  return { calls, child, identity, deps };
}
test('fixed argv/priority/flock/blue gateway; no arbitrary shell or active gateway', () => {
  const plan = buildPlan(approval);
  assert.equal(plan.command, '/usr/bin/nice');
  assert.deepEqual(BUILD_LOCKS, ['/home/deck/.cache/observe-build-0.lock']);
  assert.ok(plan.args.includes('19'));
  assert.ok(plan.args.includes('/usr/bin/ionice'));
  assert.equal(plan.args.at(-2), '--handshake-child');
  assert.equal(plan.cwd, approval.cwd);
  const options = buildOptions(plan, {
    BLOG_GATEWAY_INTERNAL_URL: 'http://127.0.0.1:18160',
    CIRCLE_NODE_TOTAL: '99',
    DUMMY_PRIVATE: 'NEVER_LOG',
  });
  assert.equal(options.shell, false);
  assert.equal(options.detached, true);
  assert.equal(options.env.BLOG_GATEWAY_INTERNAL_URL, 'http://127.0.0.1:18174');
  assert.equal(options.env.CIRCLE_NODE_TOTAL, '2');
  assert.equal(options.env.RAYON_NUM_THREADS, '2');
  assert.equal(options.env.UV_THREADPOOL_SIZE, '2');
  assert.deepEqual(options.stdio, ['pipe', 'ignore', 'ignore']);
  for (const value of [
    { gatewayInternalUrl: 'http://127.0.0.1:18160' },
    { cwd: '/home/deck/releases/existing' },
    { cwd: '/home/deck/x/../y' },
    { estimatedGiB: 0 },
    { sha: 'no' },
    { expiresAt: '2000-01-01' },
  ])
    assert.throws(() => buildPlan({ ...approval, ...value }));
});
test('start floor/reserved estimate and runtime floor are distinct; complete body not TTFB', () => {
  assert.equal(gateReason({ ...healthy, available: 48 * 1024 ** 3 }, homes, 8 * 1024 ** 3, 'start'), null);
  assert.equal(gateReason({ ...healthy, available: 47 * 1024 ** 3 }, homes, 8 * 1024 ** 3, 'start'), 'disk');
  assert.equal(gateReason({ ...healthy, available: 30 * 1024 ** 3 }, homes, 0, 'monitor'), null);
  assert.equal(gateReason({ ...healthy, available: 29 * 1024 ** 3 }, homes, 0, 'monitor'), 'disk');
  assert.equal(gateReason(healthy, [{ ...homes[0], totalMs: 6171 }, ...homes.slice(1)], 0, 'start'), 'homepage');
  assert.equal(gateReason(healthy, [{ ...homes[0], status: 103 }, ...homes.slice(1)], 0, 'start'), 'homepage');
  assert.equal(gateReason(healthy, [{ ...homes[0], complete: false }, ...homes.slice(1)], 0, 'start'), 'homepage');
});
test('initial bad resource does not probe or spawn; initial full homepage failure never starts', async () => {
  let probes = 0;
  const f = fixture({
    resources: async () => ({ ...healthy, load1: 13 }),
    probes: async () => {
      probes++;
      return homes;
    },
  });
  assert.equal((await guardedBuild(approval, f.deps)).status, 'blocked');
  assert.equal(probes, 0);
  assert.equal(f.calls.length, 0);
  const g = fixture({ probes: async () => [{ ...homes[0], totalMs: 6171 }, ...homes.slice(1)] });
  assert.equal((await guardedBuild(approval, g.deps)).reason, 'homepage');
  assert.equal(g.calls.length, 0);
});
test('monitor low disk/load/other build pauses only its own detached group, no CONT and safe artifact', async () => {
  for (const change of [{ available: 29 * 1024 ** 3 }, { load1: 13 }, { otherBuilds: 1 }]) {
    let count = 0;
    const f = fixture({ resources: async () => ({ ...healthy, ...(++count >= 4 ? change : {}) }) });
    const result = await guardedBuild(approval, f.deps);
    assert.equal(result.status, 'paused');
    assert.equal(result.autoResume, false);
    assert.deepEqual(
      f.calls.find((c) => c[0] === 'signal'),
      ['signal', -1001, 'SIGSTOP'],
    );
    assert.equal(f.calls.filter((c) => c[0] === 'signal').length, 1);
    assert.ok(!JSON.stringify(result).includes('NEVER_LOG'));
  }
});
test('monitor slow/non200/incomplete homepage stops own group', async () => {
  for (const change of [{ totalMs: 6171 }, { status: 503 }, { complete: false }]) {
    let count = 0;
    const f = fixture({ probes: async () => (++count === 1 ? homes : [{ ...homes[0], ...change }, ...homes.slice(1)]) });
    assert.equal((await guardedBuild(approval, f.deps)).status, 'paused');
    assert.deepEqual(
      f.calls.find((c) => c[0] === 'signal'),
      ['signal', -1001, 'SIGSTOP'],
    );
  }
});
test('PID reuse or unproven ownership never sends a signal to another group', async () => {
  let count = 0;
  const f = fixture({ resources: async () => ({ ...healthy, ...(++count >= 4 ? { load1: 13 } : {}) }) });
  let identities = 0;
  f.deps.identity = async () => ({ ...f.identity, startTicks: ++identities === 1 ? '987654' : 'DIFFERENT' });
  assert.equal((await guardedBuild(approval, f.deps)).reason, 'ownership_unproven');
  assert.ok(!f.calls.some((c) => c[0] === 'signal'));
  assert.equal(ownedGroup(f.identity, { ...f.identity, ppid: 1 }, 123), false);
  assert.equal(ownedGroup(f.identity, { ...f.identity, pgid: 500 }, 123), false);
});
test('monitor I/O failure pauses proven owned group, flock conflict and normal exit are explicit', async () => {
  let count = 0;
  const f = fixture({
    resources: async () => {
      if (++count >= 4) throw Error('NEVER_LOG');
      return healthy;
    },
  });
  const paused = await guardedBuild(approval, f.deps);
  assert.equal(paused.reason, 'monitor_unproven');
  assert.ok(!JSON.stringify(paused).includes('NEVER_LOG'));
  const g = fixture();
  assert.equal((await guardedBuild(approval, g.deps)).status, 'complete');
  assert.ok(!g.calls.some((c) => c[0] === 'signal'));
  const h = fixture();
  h.child.exited = true;
  h.child.code = 73;
  assert.equal((await guardedBuild(approval, h.deps)).reason, 'flock_busy');
});
test('other Next/Docker commands recognized; ordinary servers ignored', () => {
  for (const argv of [
    ['node', '/a/node_modules/next/dist/bin/next', 'build'],
    ['docker', 'build', '.'],
    ['docker', 'compose', 'build'],
    ['docker', '--context', 'local', 'build', '.'],
    ['docker', 'buildx', 'build', '.'],
    ['buildctl', 'build'],
    ['flock', 'lock', 'node', '/a/tools/build-web.mjs'],
  ])
    assert.equal(isBuildCommand(argv), true);
  for (const argv of [
    ['node', 'server.js'],
    ['docker', 'ps'],
    ['node', '/a/node_modules/next/dist/bin/next', 'start'],
  ])
    assert.equal(isBuildCommand(argv), false);
});

test('early ownership failure closes handshake without GO or builder initiation', async () => {
  const f = fixture({
    identity: async () => {
      throw Error('unproven');
    },
  });
  const result = await guardedBuild(approval, f.deps);
  assert.equal(result.reason, 'ownership_unproven');
  assert.ok(f.calls.some((c) => c[0] === 'cancel'));
  assert.ok(!f.calls.some((c) => c[0] === 'GO' || c[0] === 'signal'));
});
test('single participant slot retains its winning FD; conflict does not try a second slot', async () => {
  const closed = [],
    opened = [];
  const slot = await claimBuildSlot(
    async (path) => {
      opened.push(path);
      return { fd: 3, close: async () => closed.push(3) };
    },
    async () => 0,
  );
  assert.equal(slot.slot, BUILD_LOCKS[0]);
  assert.deepEqual(opened, BUILD_LOCKS);
  assert.deepEqual(closed, []);
  await slot.handle.close();
  assert.deepEqual(closed, [3]);
  const rejected = await claimBuildSlot(
    async (path) => {
      opened.push(path);
      return { fd: 4, close: async () => closed.push(4) };
    },
    async () => 73,
  );
  assert.equal(rejected, null);
  assert.deepEqual(opened, [BUILD_LOCKS[0], BUILD_LOCKS[0]]);
  assert.deepEqual(closed, [3, 4]);
});
test('any other build closes start and runtime gates; homepage limits remain blog 6.17s and tag/youtube 2s', () => {
  assert.equal(gateReason({ ...healthy, otherBuilds: 1 }, homes, 8 * 1024 ** 3, 'start'), 'other_build');
  assert.equal(gateReason({ ...healthy, otherBuilds: 1 }, homes, 0, 'monitor'), 'other_build');
  for (let index = 0; index < homes.length; index++) {
    assert.equal(
      gateReason(
        healthy,
        homes.map((home, i) => ({ ...home, totalMs: i === index ? HOMES[index].limitMs : 100 })),
        0,
        'start',
      ),
      null,
    );
    assert.equal(
      gateReason(
        healthy,
        homes.map((home, i) => ({ ...home, totalMs: i === index ? HOMES[index].limitMs + 1 : 100 })),
        0,
        'start',
      ),
      'homepage',
    );
  }
});

test('paused detach unrefs child and control pipe without releasing a child-owned flock FD', () => {
  const calls = [];
  detachBuild({
    stdin: { unref: () => calls.push('pipe-unref'), end: () => calls.push('pipe-end') },
    unref: () => calls.push('child-unref'),
  });
  assert.deepEqual(calls, ['pipe-unref', 'child-unref']);
});

test('host scan excludes init but keeps all potential build processes', () => {
  assert.equal(scanProcessPid('1'), false);
  assert.equal(scanProcessPid('self'), false);
  assert.equal(scanProcessPid('2'), true);
  assert.equal(scanProcessPid('1365351'), true);
});

test('memory floor fails closed at admission and pauses owned group; Node heap cap fixed', async () => {
  assert.equal(gateReason({...healthy,memoryAvailable: undefined},homes,0,'start'),'memory_unproven');
  assert.equal(gateReason({...healthy,memoryAvailable: 3 * 1024 ** 3 - 1},homes,0,'start'),'memory');
  assert.equal(gateReason({...healthy,memoryAvailable: 768 * 1024 ** 2 - 1},homes,0,'monitor'),'memory');
  assert.equal(buildOptions(buildPlan(approval), {NODE_OPTIONS:'--inspect=0.0.0.0'}).env.NODE_OPTIONS,'--max-old-space-size=1024');
  let count=0; const f=fixture({resources:async()=>({...healthy,...(++count>=4?{memoryAvailable:100}: {})})});
  assert.equal((await guardedBuild(approval,f.deps)).reason,'memory');
  assert.deepEqual(f.calls.find(x=>x[0]==='signal'),['signal',-1001,'SIGSTOP']);
});

test('one-shot guard refuses a different valid SHA or home checkout',()=>{
 assert.throws(()=>buildPlan({...approval,sha:'a'.repeat(40)}),/invalid_root_approval/);
 assert.throws(()=>buildPlan({...approval,cwd:'/home/deck/.cache/other-fresh-checkout'}),/invalid_root_approval/);
});
