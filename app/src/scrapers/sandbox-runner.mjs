// Runs inside bwrap (no network, no home, empty env) under `node --permission`; see sandbox.ts.
// vm is not the boundary: it only keeps generated code away from module loading by accident.
import vm from 'node:vm';
import { load } from 'cheerio';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { code, task, url, html, xml } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
let reply;
try {
  if (task !== 'listPosts' && task !== 'parsePost') throw Error('unknown task');
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: 'afterEvaluate',
  });
  context.__page = Object.freeze({ url, html, $: load(html, { xml: xml === true }) });
  context.URL = URL;
  context.URLSearchParams = URLSearchParams;
  // Serialize inside the context so no getter or proxy from generated code runs after the timeout.
  const value = vm.runInContext(`${code}\n;JSON.stringify(${task}(__page))`, context, {
    timeout: 2000,
    filename: 'generated-scraper.js',
  });
  reply = { ok: true, value: typeof value === 'string' ? JSON.parse(value) : null };
} catch (error) {
  reply = { ok: false, error: String(error?.message ?? error).slice(0, 300) };
}
process.stdout.write(JSON.stringify(reply));
