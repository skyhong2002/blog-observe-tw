import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runInSandbox, sandboxArgs } from './sandbox.ts';

const available = existsSync(process.env.BLOG_SCRAPER_BWRAP || '/usr/bin/bwrap');
const page = { url: 'https://quill.test/', html: '<ul><li><a href="/p/1">One</a></li><li><a href="p/2">Two</a></li></ul>' };
const run = (code: string) =>
  runInSandbox(code, 'listPosts', page).then(
    (value) => ({ value }),
    (error: Error) => ({ error: error.message }),
  );
/** The outer layers alone (bwrap + node --permission), with a probe instead of the runner. */
function probe(script: string) {
  const { command, args } = sandboxArgs();
  const node = args.slice(0, args.lastIndexOf('/sandbox/runner.mjs'));
  return spawnSync(command, [...node, '--input-type=module', '--eval', script], { encoding: 'utf8', timeout: 10000, env: {} });
}

describe.skipIf(!available)('generated scraper sandbox', () => {
  it('runs page parsing with cheerio and URL', async () => {
    const code = `function listPosts({ url, $ }) {
      return { posts: $('a').map((i, a) => ({ url: new URL($(a).attr('href'), url).href, title: $(a).text() })).get(), next: null };
    }`;
    expect(await run(code)).toEqual({
      value: {
        posts: [
          { url: 'https://quill.test/p/1', title: 'One' },
          { url: 'https://quill.test/p/2', title: 'Two' },
        ],
        next: null,
      },
    });
  });
  it('refuses string code generation, including the realm escape through $', async () => {
    for (const code of [
      'function listPosts() { return eval("1") }',
      'function listPosts() { return new Function("return 1")() }',
      'function listPosts({ $ }) { return $.constructor.constructor("return process")().env }',
      'function listPosts({ $ }) { return Object.getPrototypeOf($).constructor("return process")().pid }',
    ])
      expect((await run(code)) as { error: string }).toMatchObject({
        error: expect.stringMatching(/^scraper_code_error: .*(?:disallowed|not defined)/),
      });
  });
  it('has no require, process, fetch or timers in scope', async () => {
    for (const name of ['require', 'process', 'fetch', 'setTimeout', 'globalThis.process'])
      expect(await run(`function listPosts() { return typeof ${name} }`)).toEqual({ value: 'undefined' });
  });
  it('kills endless loops, runaway output and memory bombs', async () => {
    expect(await run('function listPosts() { for (;;) {} }')).toEqual({ error: expect.stringContaining('timed out') });
    expect(await run('function listPosts() { return "x".repeat(3e6) }')).toEqual({ error: 'scraper_output_too_large' });
    // The 128 MB heap or the wall, whichever comes first.
    expect(await run('function listPosts() { const a = []; for (;;) a.push(new Array(1e6).fill(1)) }')).toMatchObject({
      error: expect.stringMatching(/^scraper_(?:sandbox_crashed|sandbox_timeout|code_error)/),
    });
  }, 20000);
  it('outer layers: no network, no secrets, no home, no child processes', () => {
    const result = probe(`
      const net = process.getBuiltinModule('net');
      const out = { env: Object.keys(process.env).sort() };
      try { process.getBuiltinModule('fs').readdirSync('/home'); out.home = 'readable'; } catch (e) { out.home = e.code; }
      try { process.getBuiltinModule('fs').readFileSync('/etc/hostname'); out.etc = 'readable'; } catch (e) { out.etc = e.code; }
      try { process.getBuiltinModule('child_process').execSync('id'); out.exec = 'ran'; } catch (e) { out.exec = e.code; }
      let pending = 2;
      for (const host of ['127.0.0.1', '172.17.0.1'])
        net.connect(8317, host).on('connect', () => { out[host] = 'connected'; done(); }).on('error', (e) => { out[host] = e.code; done(); });
      function done() { if (--pending === 0) console.log(JSON.stringify(out)); }
    `);
    const out = JSON.parse(result.stdout);
    expect(out.env).toEqual(['PATH', 'PWD']);
    expect(out.home).toBe('ERR_ACCESS_DENIED');
    expect(out.etc).toBe('ERR_ACCESS_DENIED');
    expect(out.exec).toBe('ERR_ACCESS_DENIED');
    expect(out['127.0.0.1']).not.toBe('connected');
    expect(out['172.17.0.1']).not.toBe('connected');
  });
});
