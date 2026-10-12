import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { wrapperExitCode } from './deployment.ts';
import { readSlot } from './slot.ts';
import { SLOTS, slotOf } from './state.ts';

const [role, name] = process.argv.slice(2);
if (role !== 'gateway' && role !== 'web') throw Error('invalid_role');
const slot = slotOf(name);
const { release } = await readSlot(slot);
const ports = SLOTS[slot];
const child = spawn(process.execPath, [role === 'gateway' ? 'app/src/server.js' : 'server.js'], {
  cwd: role === 'gateway' ? release : join(release, 'web/.next/standalone/web'),
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOSTNAME: '127.0.0.1',
    PORT: String(ports[role]),
    BLOG_UI_ORIGIN: `http://127.0.0.1:${ports.web}`,
    BLOG_GATEWAY_INTERNAL_URL: `http://127.0.0.1:${ports.gateway}`,
  },
});
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
