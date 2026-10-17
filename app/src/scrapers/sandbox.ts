import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type SandboxTask = 'listPosts' | 'parsePost';
/** xml: an RSS/Atom/sitemap listing, loaded in cheerio's XML mode. */
export type SandboxPage = { url: string; html: string; xml?: boolean };
export type SandboxRunner = (code: string, task: SandboxTask, page: SandboxPage) => Promise<unknown>;

const WALL_MS = 5000;
const MAX_INPUT_BYTES = 3 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const runner = fileURLToPath(new URL('./sandbox-runner.mjs', import.meta.url));

/** Layers, each required: bwrap (no network/home/env), `node --permission` (no fs beyond its code, no child
 * processes or workers), a 128 MB heap, a 2 s vm timeout and a 5 s SIGKILL wall. Generated code only ever sees
 * one page's HTML; trusted code does all fetching. Any missing layer fails closed. */
export function sandboxArgs(bwrap = process.env.BLOG_SCRAPER_BWRAP || '/usr/bin/bwrap') {
  const nodeHome = dirname(dirname(process.execPath));
  const modules = join(root, 'node_modules');
  for (const path of [bwrap, nodeHome, modules, runner]) if (!existsSync(path)) throw Error('scraper_sandbox_unavailable');
  return {
    command: bwrap,
    args: [
      '--unshare-all',
      '--die-with-parent',
      '--new-session',
      '--clearenv',
      '--setenv',
      'PATH',
      '/usr/bin',
      '--hostname',
      'sandbox',
      '--ro-bind',
      '/usr',
      '/usr',
      '--symlink',
      'usr/lib',
      '/lib',
      '--symlink',
      'usr/lib',
      '/lib64',
      '--symlink',
      'usr/bin',
      '/bin',
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      '--tmpfs',
      '/tmp',
      '--ro-bind',
      nodeHome,
      '/sandbox/node',
      '--ro-bind',
      modules,
      '/sandbox/node_modules',
      '--ro-bind',
      runner,
      '/sandbox/runner.mjs',
      '--chdir',
      '/sandbox',
      `/sandbox/node/bin/${basename(process.execPath)}`,
      '--permission',
      '--allow-fs-read=/sandbox',
      '--disallow-code-generation-from-strings',
      '--max-old-space-size=128',
      '/sandbox/runner.mjs',
    ],
  };
}

export const runInSandbox: SandboxRunner = (code, task, page) => {
  const input = JSON.stringify({ code, task, url: page.url, html: page.html, xml: page.xml === true });
  if (Buffer.byteLength(input) > MAX_INPUT_BYTES) return Promise.reject(Error('scraper_page_too_large'));
  const { command, args } = sandboxArgs();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'], env: {} });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: string | null = null;
    const timer = setTimeout(() => {
      failure = 'scraper_sandbox_timeout';
      child.kill('SIGKILL');
    }, WALL_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        failure = 'scraper_output_too_large';
        child.kill('SIGKILL');
      } else chunks.push(chunk);
    });
    child.on('error', () => {
      failure ??= 'scraper_sandbox_unavailable';
    });
    child.stdin.on('error', () => {});
    child.on('close', (status) => {
      clearTimeout(timer);
      if (failure) return reject(Error(failure));
      if (status !== 0) return reject(Error('scraper_sandbox_crashed'));
      try {
        const reply = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (reply?.ok === true) resolve(reply.value);
        else reject(Error(`scraper_code_error: ${String(reply?.error ?? '').slice(0, 300)}`));
      } catch {
        reject(Error('scraper_sandbox_output_invalid'));
      }
    });
    child.stdin.end(input);
  });
};
