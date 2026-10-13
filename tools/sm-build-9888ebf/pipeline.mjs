import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const CWD = '/home/deck/.cache/blog-release-source-9888ebf36229400c2323ae12334d72280cbe699a';
export async function pipeline(cwd, deps = {}) {
  const io = { lstat, realpath, spawn, ...deps };
  if (cwd !== CWD || await io.realpath(cwd) !== cwd) throw Error('fixed_fresh_checkout_required');
  for (const name of ['node_modules', 'web/node_modules', 'web/.next']) {
    try { await io.lstat(`${cwd}/${name}`); throw Error('existing_owned_output_preserved'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  const commands = [
    ['npm', ['ci', '--no-audit', '--no-fund']],
    ['npm', ['--prefix', 'web', 'ci', '--no-audit', '--no-fund']],
    [process.execPath, [`${cwd}/tools/build-web.mjs`]],
  ];
  for (const [command, args] of commands) {
    const child = io.spawn(command, args, {cwd, detached:false, shell:false, stdio:'inherit', env:{...process.env,NEXT_TELEMETRY_DISABLED:'1',CI:'1'}});
    const code = await new Promise((done, reject) => { child.once('error',reject); child.once('exit',done); });
    if (code !== 0) throw Error('fixed_pipeline_step_failed');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw Error('fixed_fresh_checkout_required');
  pipeline(process.argv[2]).catch(() => { console.error('fixed_pipeline_failed'); process.exitCode=1; });
}
