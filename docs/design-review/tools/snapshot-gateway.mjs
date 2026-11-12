// Read-only stand-in for the blog gateway, for design-review screenshots.
//
//   node docs/design-review/tools/snapshot-gateway.mjs --port 18391 --store DIR [--record]
//
// Replay (default): answers every GET from DIR, recorded once from the public
// site. Nothing reaches the shared database. A path that was never recorded
// answers 404 and is listed in DIR/misses.txt.
// --record: a path missing from DIR is fetched once from https://weblog.tw,
// strictly one request at a time and at least 2 s apart, then stored. Only
// cookie-free public GETs (web/src/lib/public-paths.ts) and icon assets are
// ever forwarded; /auth, /api/me and every write are answered locally.
//
// Scenario, switched by the capture script between states (one browser at a
// time, so a single global value is enough):
//   GET /__state?data=normal|empty|error|loading&session=out|in
// empty  : every public read answers its valid no-rows payload (test/public-payloads.ts EMPTY)
// error  : every public read answers 503
// loading: every public read is held until the next /__state call
// session: in = a fictional signed-in reader with three follows and one API key
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const port = Number(opt('port', '18391'));
const store = resolve(opt('store', '/home/sky/.cache/weblog-ui-hill-climb/snapshot'));
const record = args.includes('--record');
const UPSTREAM = 'https://weblog.tw';
const SPACING_MS = 2000;
const web = resolve(dirname(fileURLToPath(import.meta.url)), '../../../web');
const { publicKindOf } = await import(join(web, 'src/lib/public-paths.ts'));
const { EMPTY } = await import(join(web, 'test/public-payloads.ts'));
mkdirSync(join(store, 'responses'), { recursive: true });

let scenario = { data: 'normal', session: 'out' };
let held = [];

const SIGNED_IN_USER = { id: 4242, email: 'reader@example.com', name: '林小美', picture: null, role: 'reader' };
const ICON_PATH = /^\/(?:api\/icons(?:\/|$)|icons\/|favicons\/)/;

function key(url) {
  return createHash('sha256').update(url).digest('hex').slice(0, 32);
}

function load(url) {
  const file = join(store, 'responses', `${key(url)}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

let queue = Promise.resolve();
let last = 0;
function fetchUpstream(url) {
  const run = queue.then(async () => {
    const wait = last + SPACING_MS - Date.now();
    if (wait > 0) await new Promise((done) => setTimeout(done, wait));
    last = Date.now();
    const response = await fetch(UPSTREAM + url, {
      headers: { DNT: '1', 'user-agent': 'weblog-design-review-snapshot/1 (one-time read-only capture)' },
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });
    const body = Buffer.from(await response.arrayBuffer());
    const saved = {
      url,
      status: response.status,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      location: response.headers.get('location'),
      recordedAt: new Date().toISOString(),
      body: body.toString('base64'),
    };
    if (response.status < 500 && response.status !== 429) writeFileSync(join(store, 'responses', `${key(url)}.json`), JSON.stringify(saved));
    appendFileSync(join(store, 'recorded.txt'), `${saved.recordedAt} ${response.status} ${url}\n`);
    return saved;
  });
  queue = run.catch(() => {});
  return run;
}

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'private, no-store', ...extra });
  res.end(body);
}
const json = (res, status, value) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));

// Three real public blogs from the snapshot, chosen once (store/follows.json).
const followsFile = join(store, 'follows.json');
const FOLLOWS = existsSync(followsFile) ? JSON.parse(readFileSync(followsFile, 'utf8')) : [];

function privateAnswer(req, res, path) {
  const signedIn = scenario.session === 'in';
  if (path === '/auth/me') return json(res, 200, { enabled: true, user: signedIn ? SIGNED_IN_USER : null });
  if (path.startsWith('/auth/me/api-keys')) {
    if (!signedIn) return json(res, 401, { error: 'login required' });
    return json(res, 200, {
      csrfToken: 'preview',
      max: 3,
      keys: [{ id: '7', label: '個人閱讀器', prefix: 'wb_live_3f9a', createdAt: '2026-10-30T02:14:00.000Z', lastUsedAt: '2026-11-12T09:40:00.000Z' }],
    });
  }
  if (path === '/auth/google' || path.startsWith('/auth/google?')) return send(res, 302, 'text/plain', '', { location: '/login/' });
  if (path === '/api/me/capabilities') return signedIn ? json(res, 200, { admin: false }) : json(res, 401, { error: 'login required' });
  if (path === '/api/me/follows') return signedIn ? json(res, 200, { follows: FOLLOWS }) : json(res, 401, { error: 'login required' });
  if (path.startsWith('/api/me/sites')) return signedIn ? json(res, 200, { sites: [], challenges: [] }) : json(res, 401, { error: 'login required' });
  return json(res, signedIn ? 404 : 401, { error: 'not available in the design-review snapshot' });
}

createServer(async (req, res) => {
  const url = req.url ?? '/';
  const path = url;
  try {
    if (path.startsWith('/__state')) {
      const params = new URL(url, 'http://x').searchParams;
      scenario = { data: params.get('data') ?? 'normal', session: params.get('session') ?? 'out' };
      for (const r of held) if (!r.writableEnded) json(r, 503, { error: 'released' });
      held = [];
      return json(res, 200, scenario);
    }
    if (path === '/healthz') return send(res, 200, 'text/plain', 'ok');
    if (/^\/(?:auth|me)(?:[/?]|$)|^\/api\/(?:me|admin|reader|auth)(?:[/?]|$)/.test(path)) return privateAnswer(req, res, path);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'read-only snapshot' });
    const kind = publicKindOf(path);
    if (kind && scenario.data === 'loading') return void held.push(res);
    if (kind && scenario.data === 'error') return json(res, 503, { error: 'Service unavailable' });
    if (kind && scenario.data === 'empty' && kind !== 'collectionCount') {
      if (EMPTY[kind] !== undefined) return json(res, 200, EMPTY[kind]);
    }
    if (kind && scenario.data === 'empty' && kind === 'collectionCount') return json(res, 200, { blogs: 0 });
    let saved = load(url);
    if (!saved && record && (kind || ICON_PATH.test(path) || path === '/api/status')) saved = await fetchUpstream(url);
    if (!saved) {
      appendFileSync(join(store, 'misses.txt'), `${new Date().toISOString()} ${url}\n`);
      return json(res, 404, { error: 'not in snapshot' });
    }
    const headers = saved.location ? { location: saved.location } : {};
    return send(res, saved.status, saved.contentType, Buffer.from(saved.body, 'base64'), headers);
  } catch (error) {
    appendFileSync(join(store, 'misses.txt'), `${new Date().toISOString()} ERROR ${url} ${error.message}\n`);
    if (!res.headersSent) json(res, 502, { error: 'snapshot gateway error' });
  }
}).listen(port, '127.0.0.1', () => console.log(`snapshot gateway on 127.0.0.1:${port} (${record ? 'record' : 'replay'}) store=${store}`));
