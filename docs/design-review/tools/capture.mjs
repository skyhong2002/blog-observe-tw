// Photograph every state in states.mjs at both sizes, one browser, one page at a time.
//   NODE_PATH=<dir with playwright> node capture.mjs site http://127.0.0.1:WEB http://127.0.0.1:GATEWAY OUT_DIR [id-filter]
//   NODE_PATH=<dir with playwright> node capture.mjs references OUT_DIR
// Env: ONLY_SIZE=desktop|mobile, ASSETS=<cache dir>, OFFLINE=1 (never fetch a missing asset).
//
// Site mode only talks to the local Next server. Every other request (blog
// favicons, article thumbnails, tag.observe.tw tag visuals) is answered from
// ASSETS, fetched once on first sight; analytics are blocked.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { NOW, REFERENCES, SIZES, STATES } from './states.mjs';

const require = createRequire(join(process.env.NODE_PATH ?? process.cwd(), 'noop.js'));
const { chromium } = require('playwright');
const [mode, ...rest] = process.argv.slice(2);
const ASSETS = process.env.ASSETS ?? '/home/sky/.cache/weblog-ui-hill-climb/assets';
mkdirSync(ASSETS, { recursive: true });
const BLOCK = /google-analytics\.com|googletagmanager\.com|doubleclick\.net|analytics\.google\.com/;
const sizes = Object.entries(SIZES).filter(([name]) => !process.env.ONLY_SIZE || name === process.env.ONLY_SIZE);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
// Host gate: never start a shot while load1 > 10 (shared host with tag-db).
async function loadGate() {
  for (;;) {
    const load1 = Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
    if (load1 <= 10) return;
    console.log(`${new Date().toISOString()} waiting: load1=${load1}`);
    await pause(30000);
  }
}

async function cachedAsset(route) {
  const request = route.request();
  const url = request.url();
  if (BLOCK.test(url)) return route.abort();
  if (request.method() !== 'GET') return route.abort();
  const file = join(ASSETS, `${createHash('sha256').update(url).digest('hex').slice(0, 32)}.json`);
  if (!existsSync(file)) {
    if (process.env.OFFLINE) return route.fulfill({ status: 404, body: '' });
    let saved;
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 weblog-design-review/1', DNT: '1' }, signal: AbortSignal.timeout(10000) });
      saved = { url, status: response.status, type: response.headers.get('content-type') ?? '', body: Buffer.from(await response.arrayBuffer()).toString('base64') };
    } catch (error) {
      saved = { url, status: 404, type: 'text/plain', body: '', error: String(error.message) };
    }
    writeFileSync(file, JSON.stringify(saved));
  }
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  return route.fulfill({
    status: saved.status,
    headers: { 'content-type': saved.type || 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
    body: Buffer.from(saved.body, 'base64'),
  });
}

async function settle(page, maxHeight) {
  // Walk the page so lazy images load, then return to the top.
  const height = Math.min(await page.evaluate(() => document.documentElement.scrollHeight), maxHeight + 900);
  for (let y = 0; y < height; y += 600) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(100);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.evaluate(() =>
    Promise.all(
      [...document.images].filter((img) => !img.complete).map((img) => new Promise((done) => { img.onload = img.onerror = done; setTimeout(done, 4000); })),
    ),
  );
  await page.waitForTimeout(800);
}

async function shoot(page, file, size, { anchor, viewportOnly } = {}) {
  let top = 0;
  if (anchor) {
    top = await page.evaluate((selector) => {
      const node = document.querySelector(selector);
      const header = document.querySelector('[data-site-header]');
      const sticky = header && ['sticky', 'fixed'].includes(getComputedStyle(header).position) ? header.offsetHeight : 0;
      return node ? Math.round(Math.max(0, node.getBoundingClientRect().top + window.scrollY - 24 - sticky)) : 0;
    }, anchor);
  }
  if (viewportOnly) return page.screenshot({ path: file, animations: 'disabled', caret: 'hide', timeout: 120000 });
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  const height = Math.max(size.height, Math.min(full - top, size.maxHeight));
  // Grow the viewport to the shot instead of a full-page capture: a 1,000-post page
  // would otherwise be rasterised whole and can take the browser down.
  await page.setViewportSize({ width: size.width, height: Math.round(height) });
  await page.waitForTimeout(800);
  await page.evaluate((y) => window.scrollTo(0, y), top);
  await page.waitForTimeout(400);
  return page.screenshot({ path: file, animations: 'disabled', caret: 'hide', timeout: 120000 });
}

async function newContext(browser, size, { theme, locale = 'zh-TW' } = {}) {
  return browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: size.deviceScaleFactor,
    isMobile: !!size.isMobile,
    hasTouch: !!size.hasTouch,
    colorScheme: theme === 'dark' ? 'dark' : 'light',
    locale,
    timezoneId: 'Asia/Taipei',
    reducedMotion: 'reduce',
    extraHTTPHeaders: { DNT: '1' },
  });
}

let browser = await chromium.launch();
try {
  if (mode === 'site') {
    const [base, gateway, out, filter] = rest;
    mkdirSync(out, { recursive: true });
    const setState = (data = 'normal', session = 'out') => fetch(`${gateway}/__state?data=${data}&session=${session}`).then((r) => r.json());
    const origin = new URL(base).origin;
    for (const [sizeName, size] of sizes) {
      for (const state of STATES.filter((s) => (!filter || s.id.includes(filter)) && (!s.only || s.only === sizeName))) {
        const file = `${out}/${state.id}_${sizeName}.png`;
        if (process.env.SKIP_EXISTING && existsSync(file)) continue;
        for (let attempt = 1; attempt <= 2; attempt++) {
        try {
        await loadGate();
        const context = await newContext(browser, size, state);
        await context.route((url) => url.origin !== origin, cachedAsset);
        const page = await context.newPage();
        await page.clock.setFixedTime(new Date(NOW));
        if (state.navFrom) {
          await setState('normal', state.session);
          await page.goto(base + state.navFrom, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
          await page.waitForTimeout(600);
          await setState(state.data, state.session);
          await page.evaluate((selector) => document.querySelector(selector)?.click(), state.navClick);
          await page.waitForTimeout(state.navWait ?? 1500);
        } else {
          await setState(state.data, state.session);
          await page.goto(base + state.path, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
          await page.waitForTimeout(500);
          for (const selector of state.click || []) {
            await page.locator(selector).first().click({ timeout: 5000 }).catch((error) => console.warn(state.id, 'click failed', selector, error.message.split('\n')[0]));
            await page.waitForTimeout(500);
          }
          if (!state.viewportOnly) await settle(page, size.maxHeight);
          else await page.waitForTimeout(1200);
        }
        try {
          await shoot(page, file, size, state);
          console.log(file);
        } finally {
          await setState('normal', 'out');
          await context.close();
        }
        break;
        } catch (error) {
          console.warn(`FAILED ${state.id}_${sizeName} attempt ${attempt}: ${String(error.message).split('\n')[0]}`);
          if (!browser.isConnected()) browser = await chromium.launch();
        }
        }
      }
    }
  } else if (mode === 'references') {
    const [out, filter] = rest;
    mkdirSync(out, { recursive: true });
    for (const [sizeName, size] of sizes) {
      for (const ref of REFERENCES.filter((r) => !filter || r.id.includes(filter))) {
        await loadGate();
        const context = await newContext(browser, size, { locale: ref.locale ?? 'en-US' });
        await context.route(BLOCK, (route) => route.abort());
        const page = await context.newPage();
        await page.goto(ref.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await page.waitForTimeout(6000);
        for (const name of ['Reject All', 'Reject all', 'Accept All', 'Accept all', 'Accept', 'Got it', '同意', '接受']) {
          const button = page.getByRole('button', { name, exact: true });
          if (await button.count().catch(() => 0)) {
            await button.first().click({ timeout: 2000 }).catch(() => {});
            break;
          }
        }
        await settle(page, size.maxHeight);
        const file = `${out}/${ref.id}_${sizeName}.png`;
        await shoot(page, file, size, {});
        console.log(file);
        await context.close();
        await pause(1500);
      }
    }
  }
} finally {
  await browser.close();
}
