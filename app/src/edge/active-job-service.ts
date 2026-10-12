import { spawn } from 'node:child_process';
import { activeFaviconJob } from './active-job.ts';
import { wrapperExitCode } from './deployment.ts';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) throw Error('invalid_job_arguments');
const plan = await activeFaviconJob();
if (args[0] === '--check') {
  // Only immutable release metadata; never serialize the environment or credentials.
  console.log(JSON.stringify(plan));
} else {
  console.log(JSON.stringify({ job: 'favicons', slot: plan.slot, commit: plan.commit, generation: plan.generation }));
  const child = spawn(process.execPath, plan.args, { cwd: plan.cwd, stdio: 'inherit', env: process.env });
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.on(signal, () => {
      stopping = true;
      child.kill(signal);
    });
  child.on('error', () => {
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => process.exit(wrapperExitCode(stopping, code, signal)));
}
