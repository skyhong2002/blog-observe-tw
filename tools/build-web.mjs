import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assertLargeWriteSpace } from './disk-space.mjs';

// Next's standalone tracing may retain files from an earlier build. Never
// publish a new source commit with an old standalone HTML/JavaScript artifact.
const web = fileURLToPath(new URL('../web/', import.meta.url));
await assertLargeWriteSpace();
await rm(new URL('../web/.next/', import.meta.url), { recursive: true, force: true });
const processBuild = spawn('npm', ['run', 'build'], { cwd: web, stdio: 'inherit', env: process.env });
const code = await new Promise((resolve, reject) => {
  processBuild.once('error', reject);
  processBuild.once('exit', resolve);
});
if (code !== 0) process.exit(typeof code === 'number' ? code : 1);
for (const file of ['BUILD_ID', 'server/app/api.html', 'server/app/api/status.html']) {
  const [original, packaged] = await Promise.all([
    readFile(new URL(`../web/.next/${file}`, import.meta.url)),
    readFile(new URL(`../web/.next/standalone/web/.next/${file}`, import.meta.url)),
  ]);
  if (!original.equals(packaged)) throw Error(`standalone_artifact_mismatch: ${file}`);
}
console.log('Standalone build ID and API HTML artifacts match the clean build.');
