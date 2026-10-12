import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export function validWebp(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP' &&
    bytes.readUInt32LE(4) === bytes.length - 8
  );
}
export function encodeRaster(bytes: Buffer, widths: readonly number[]): Promise<Map<number, Buffer>> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--max-old-space-size=128', fileURLToPath(new URL('./encoder.mjs', import.meta.url)), JSON.stringify(widths)],
      {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { VIPS_CONCURRENCY: '1', MALLOC_ARENA_MAX: '2' },
      },
    );
    const chunks: Buffer[] = [];
    let count = 0,
      stopped = false;
    const fail = () => {
      if (stopped) return;
      stopped = true;
      child.kill('SIGKILL');
      clearTimeout(timer);
      reject(Error('image_decode_failed'));
    };
    const timer = setTimeout(fail, 8000);
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.stdout.on('data', (chunk: Buffer) => {
      count += chunk.length;
      if (count > 8 * 1024 * 1024) fail();
      else chunks.push(chunk);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (stopped) return;
      if (code !== 0) {
        fail();
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, string>;
        const output = new Map<number, Buffer>();
        let total = 0;
        for (const width of widths) {
          const bytes = Buffer.from(parsed[width] ?? '', 'base64');
          total += bytes.length;
          if (!validWebp(bytes) || total > MAX_IMAGE_BYTES) throw Error();
          output.set(width, bytes);
        }
        stopped = true;
        resolve(output);
      } catch {
        fail();
      }
    });
    child.stdin.end(bytes);
  });
}
