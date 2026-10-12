import { execFile, spawn } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { archiveAssets } from '../app/src/edge/assets.ts';
import {
  acknowledgeEdge,
  confirmOrRestore,
  pollReadiness,
  ReadinessFailure,
  requirePrivacyRelease,
  SwitchFailure,
} from '../app/src/edge/deployment.ts';
import { verifyArchive } from '../app/src/edge/release-integrity.ts';
import { readSlot, type SlotRelease, validateRelease } from '../app/src/edge/slot.ts';
import { atomicJson, type EdgeState, parseState, SLOTS, type Slot, slotOf, stateRoot } from '../app/src/edge/state.ts';
import { assertLargeWriteSpace } from './disk-space.mjs';

const execute = promisify(execFile);
const root = stateRoot();
const activeFile = join(root, 'active.json');
async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
async function current(): Promise<EdgeState | null> {
  return (await exists(activeFile)) ? parseState(await readFile(activeFile, 'utf8')) : null;
}
async function git(release: string, ...args: string[]) {
  return (await execute('git', ['-C', release, ...args])).stdout.trim();
}
async function serviceActive(unit: string) {
  const { stdout } = await execute('systemctl', ['--user', 'show', unit, '--property=ActiveState', '--value']);
  const state = stdout.trim();
  if (['inactive', 'failed'].includes(state)) return false;
  if (['active', 'activating', 'deactivating', 'reloading', 'refreshing'].includes(state)) return true;
  throw Error('cannot_determine_service_state');
}
function unit(role: 'gateway' | 'web', slot: Slot) {
  return `blog-observe-${role}@${slot}.service`;
}
async function start(role: 'gateway' | 'web', slot: Slot) {
  await execute('systemctl', ['--user', 'start', unit(role, slot)]);
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function probe(path: string, port: number, type = 'application/json') {
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { host: 'blog.observe.tw', accept: type },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ReadinessFailure('probe_transport_unavailable', true);
  }
}
async function requireHealth(slot: Slot) {
  const response = await probe('/healthz', SLOTS[slot].gateway);
  if (!response.ok) {
    await response.body?.cancel();
    throw new ReadinessFailure('slot_health_unavailable', [502, 503, 504].includes(response.status));
  }
  const body = (await response.json()) as { ok?: boolean; port?: number };
  if (!response.ok || body.ok !== true || body.port !== SLOTS[slot].gateway) throw Error('slot_health_failed');
}
async function ready(slot: Slot) {
  await requireHealth(slot);
  for (const path of ['/', '/blogs/', '/articles/', '/api/overview', '/api/v1/openapi.json']) {
    const response = await probe(path, SLOTS[slot].gateway, path.startsWith('/api/') ? 'application/json' : 'text/html');
    const text = await response.text();
    if (response.status !== 200 || text.length < 20)
      throw new ReadinessFailure(`slot_probe_failed:${path}`, [502, 503, 504].includes(response.status));
    if (!path.startsWith('/api/') && !/<(?:html|!DOCTYPE)/i.test(text)) throw Error('slot_html_failed');
  }
  const auth = await probe('/auth/google', SLOTS[slot].gateway);
  await auth.body?.cancel();
  const location = new URL(auth.headers.get('location') ?? 'http://invalid');
  if (
    auth.status !== 302 ||
    location.hostname !== 'accounts.google.com' ||
    location.searchParams.get('redirect_uri') !== 'https://blog.observe.tw/auth/google/callback' ||
    location.searchParams.get('code_challenge_method') !== 'S256'
  )
    throw Error('slot_oauth_failed');
}
async function waitHealth(slot: Slot) {
  for (let i = 0; i < 20; i++) {
    try {
      await requireHealth(slot);
      return;
    } catch {
      await wait(500);
    }
  }
  throw Error('slot_start_timeout');
}
async function ensureStopped(slot: Slot) {
  for (const role of ['gateway', 'web'] as const)
    if (await serviceActive(unit(role, slot))) throw Error('inactive_slot_must_be_stopped_explicitly');
}
async function prepare(slot: Slot, directory: string, sourceDirectory: string) {
  const state = await current();
  if (state?.active === slot) throw Error('cannot_prepare_active_slot');
  await ensureStopped(slot);
  await assertLargeWriteSpace();
  const release = await realpath(directory);
  const source = await realpath(sourceDirectory);
  if (source === release) throw Error('source_checkout_must_not_be_release');
  await git(source, 'fetch', 'origin');
  const commit = await git(source, 'rev-parse', 'HEAD');
  if (commit !== (await git(source, 'rev-parse', 'origin/main')) || (await git(source, 'status', '--porcelain', '--untracked-files=no')))
    throw Error('clean_current_origin_main_required');
  if (state) await git(source, 'merge-base', '--is-ancestor', state.commit, commit);
  const descriptor = await validateRelease({ slot, commit, release }, slot);
  const tree = (await execute('git', ['-C', source, 'ls-tree', '-rz', '--full-tree', commit], { maxBuffer: 16 * 1024 * 1024 })).stdout;
  await verifyArchive(release, tree);
  if (await exists(join(root, 'prepared-releases', `${commit}.json`))) throw Error('previously_prepared_release_is_immutable');
  for (const other of Object.keys(SLOTS) as Slot[]) {
    const path = join(root, 'slots', `${other}.json`);
    if ((await exists(path)) && (await readSlot(other)).release === release) {
      const readyFile = join(root, 'ready', `${other}.json`);
      const wasReady = (await exists(readyFile)) && JSON.parse(await readFile(readyFile, 'utf8')).commit === commit;
      if (other !== slot || wasReady) throw Error('release_already_assigned_create_new_release');
      // A failed prepare may retry its own unserved release, after its services
      // are explicitly stopped. A ready/published release is never rebuilt.
    }
  }
  // The legacy listener may still serve an older release during first introduction.
  for (const legacy of ['blog-observe.service', 'blog-observe-gateway.service', 'blog-observe-web.service']) {
    let output: string;
    try {
      output = (await execute('systemctl', ['--user', 'show', legacy, '--property=LoadState', '--property=WorkingDirectory'])).stdout;
    } catch (error) {
      if (/^LoadState=not-found$/m.test((error as { stdout?: string }).stdout ?? '')) continue;
      throw error;
    }
    const cwd = output
      .split('\n')
      .find((line) => line.startsWith('WorkingDirectory='))
      ?.slice('WorkingDirectory='.length);
    if (cwd === release || cwd?.startsWith(`${release}/`)) throw Error('release_is_legacy_live_directory');
  }
  await atomicJson(join(root, 'slots', `${slot}.json`), descriptor);
  await start('gateway', slot);
  await waitHealth(slot);
  // This process is not a worker; there is still only one crawl/index scheduler.
  const child = spawn('npm', ['run', 'web:build'], {
    cwd: release,
    stdio: 'inherit',
    env: {
      ...process.env,
      BLOG_GATEWAY_INTERNAL_URL: `http://127.0.0.1:${SLOTS[slot].gateway}`,
      NODE_ENV: 'production',
      CIRCLE_NODE_TOTAL: '2',
    },
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0) throw Error('slot_build_failed_active_unchanged');
  await git(source, 'fetch', 'origin');
  if (commit !== (await git(source, 'rev-parse', 'origin/main'))) throw Error('main_changed_rebuild_required');
  const manifest = JSON.parse(await readFile(join(release, 'web/.next/routes-manifest.json'), 'utf8'));
  const rewrites = Array.isArray(manifest.rewrites) ? manifest.rewrites : Object.values(manifest.rewrites ?? {}).flat();
  for (const prefix of ['api', 'auth'])
    if (
      !rewrites.some(
        (route: { source?: string; destination?: string }) =>
          route.source === `/${prefix}/:path*` && route.destination === `http://127.0.0.1:${SLOTS[slot].gateway}/${prefix}/:path*`,
      )
    )
      throw Error('slot_build_origin_mismatch');
  await assertLargeWriteSpace();
  const assets = await archiveAssets(join(release, 'web/.next/static'), join(root, 'static'));
  const buildId = (await readFile(join(release, 'web/.next/BUILD_ID'), 'utf8')).trim();
  await start('web', slot);
  // A small startup allowance for transport/502/503/504 only. A bad route,
  // OAuth contract, wrong HTML, or exhausted retries keeps its real error.
  await pollReadiness(() => ready(slot));
  await atomicJson(join(root, 'ready', `${slot}.json`), { ...descriptor, source, buildId, checkedAt: new Date().toISOString() });
  await atomicJson(join(root, 'prepared-releases', `${commit}.json`), { ...descriptor, source, buildId });
  console.log(JSON.stringify({ prepared: slot, commit, assets, switched: false }));
}
async function checkPrepared(slot: Slot): Promise<SlotRelease & { source: string }> {
  const descriptor = await readSlot(slot);
  const record = JSON.parse(await readFile(join(root, 'ready', `${slot}.json`), 'utf8'));
  const buildId = (await readFile(join(descriptor.release, 'web/.next/BUILD_ID'), 'utf8')).trim();
  if (
    record.commit !== descriptor.commit ||
    record.release !== descriptor.release ||
    record.slot !== slot ||
    record.buildId !== buildId ||
    typeof record.source !== 'string'
  )
    throw Error('unverified_slot');
  await requirePrivacyRelease(descriptor.commit, (floor, target) => git(record.source, 'merge-base', '--is-ancestor', floor, target));
  await ready(slot);
  return { ...descriptor, source: record.source };
}
const acknowledge = (state: EdgeState) => acknowledgeEdge(state, probe);
async function switchSlot(slot: Slot, bootstrap: boolean, rollback: boolean) {
  const before = await current();
  if (bootstrap ? before !== null : before === null) throw Error('wrong_bootstrap_mode');
  if (before?.active === slot) throw Error('already_active');
  const descriptor = await checkPrepared(slot);
  if (!rollback) {
    await git(descriptor.source, 'fetch', 'origin');
    if (descriptor.commit !== (await git(descriptor.source, 'rev-parse', 'origin/main'))) throw Error('main_changed_do_not_switch');
  }
  if (!rollback && before) await git(descriptor.source, 'merge-base', '--is-ancestor', before.commit, descriptor.commit);
  const next: EdgeState = { active: slot, commit: descriptor.commit, generation: (before?.generation ?? 0) + 1 };
  // Rollback journal is metadata only, not a database/filesystem backup.
  await atomicJson(join(root, 'transitions', `${next.generation}.json`), { before, after: next, at: new Date().toISOString(), rollback });
  await atomicJson(activeFile, next);
  if (!bootstrap) {
    await confirmOrRestore({
      before: before!,
      next,
      acknowledge,
      checkOld: async () => {
        await checkPrepared(before!.active);
      },
      publishRollback: async (restored) => {
        await atomicJson(join(root, 'transitions', `${restored.generation}.json`), {
          before: next,
          after: restored,
          automaticRollback: true,
        });
        await atomicJson(activeFile, restored);
      },
    });
  }
  console.log(JSON.stringify({ ...next, bootstrap, listenerMigrated: !bootstrap, oldSlotStopped: false }));
}

export async function main(args: string[]) {
  if (process.env.BLOG_DEPLOY_FLOCK_HELD !== '1') throw Error('use_bash_tools_deploy_blue_green_sh');
  const [command, value, directory, source] = args;
  if (command === 'status' && args.length === 1) {
    console.log(JSON.stringify(await current()));
    return;
  }
  if (command === 'prepare' && args.length === 4) {
    await prepare(slotOf(value), directory, source);
    return;
  }
  if (command === 'archive-static' && args.length === 2) {
    const release = await realpath(value);
    await validateRelease({ slot: 'blue', release, commit: basename(release) }, 'blue');
    await assertLargeWriteSpace();
    const primary = join(release, 'web/.next/static');
    const path = (await exists(primary)) ? primary : join(release, 'web/.next/standalone/web/.next/static');
    console.log(JSON.stringify({ archivedFiles: await archiveAssets(path, join(root, 'static')), listenerChanged: false }));
    return;
  }
  if (['switch', 'bootstrap', 'rollback'].includes(command) && args.length === 2) {
    await switchSlot(slotOf(value), command === 'bootstrap', command === 'rollback');
    return;
  }
  throw Error(
    'usage: prepare SLOT ARCHIVE_RELEASE SOURCE_CHECKOUT | archive-static RELEASE | switch SLOT | rollback SLOT | bootstrap SLOT | status',
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch((error: unknown) => {
    // Stable error codes only: never print child environment, headers, or OAuth URL.
    if (error instanceof SwitchFailure) {
      console.error(JSON.stringify({ code: error.message, primaryCode: error.primaryCode, rollbackCode: error.rollbackCode }));
      process.exitCode = 1;
      return;
    }
    const message = error instanceof Error ? error.message : 'deployment_failed';
    console.error(/^[a-z_]+(?::\/[a-z0-9/.-]*)?$/.test(message) ? message : 'deployment_failed_check_local_service_status');
    process.exitCode = 1;
  });
