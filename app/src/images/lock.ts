import { spawn } from 'node:child_process';
/** Kernel lock, retained inode. Holder exits on stdin EOF, including gateway/CLI death. */
export async function imageWriterLock(path: string): Promise<null | (() => Promise<void>)> {
  return new Promise((resolve) => {
    const child = spawn(
      '/usr/bin/flock',
      [
        '--no-fork',
        '--exclusive',
        '--nonblock',
        path,
        process.execPath,
        '-e',
        "process.stdout.write('locked');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));",
      ],
      { stdio: ['pipe', 'pipe', 'ignore'], env: {} },
    );
    let settled = false;
    const closed = new Promise<void>((done) => child.once('close', () => done()));
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      resolve(null);
    };
    const timer = setTimeout(fail, 2000);
    child.once('error', fail);
    child.stdin.on('error', () => {});
    child.once('close', fail);
    child.stdout.once('data', (data: Buffer) => {
      if (settled || data.toString() !== 'locked') {
        fail();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(async () => {
        child.stdin.end();
        const kill = setTimeout(() => child.kill('SIGKILL'), 1000);
        await closed;
        clearTimeout(kill);
      });
    });
  });
}
