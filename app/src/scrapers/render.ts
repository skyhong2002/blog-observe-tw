import { spawnSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright-core';
import { type FeedCrawlerOptions, isAllowedCrawlUrl, isBlockedAddress, MAX_RESPONSE_BYTES } from '../crawl/feed.ts';
import { fetchHtml } from './pages.ts';
import type { SandboxPage } from './sandbox.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const scopeWrapper = fileURLToPath(new URL('./render-scope.sh', import.meta.url));
const PAGE_MS = 20000;
const SETTLE_MS = 4000;
const IDLE_CLOSE_MS = 60000;

/** Playwright's own headless shell for the installed playwright-core (or BLOG_SCRAPER_CHROME). */
function headlessShell(): string | null {
  if (process.env.BLOG_SCRAPER_CHROME) return existsSync(process.env.BLOG_SCRAPER_CHROME) ? process.env.BLOG_SCRAPER_CHROME : null;
  try {
    const browsers = JSON.parse(readFileSync(join(root, 'node_modules/playwright-core/browsers.json'), 'utf8')).browsers;
    const revision = browsers.find((b: { name: string }) => b.name === 'chromium-headless-shell')?.revision;
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache/ms-playwright');
    const path = join(cache, `chromium_headless_shell-${revision}`, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    return revision && existsSync(path) ? path : null;
  } catch {
    return null;
  }
}
let available: boolean | null = null;
let scoped = false;
/** Rendering is optional: without playwright-core or its browser, scrapers read raw HTML only. */
export function renderAvailable() {
  if (available === null) {
    available = process.env.BLOG_SCRAPER_RENDER !== 'false' && existsSync(join(root, 'node_modules/playwright-core')) && !!headlessShell();
    // Its own systemd scope keeps the browser's memory off the worker's 768M budget; else it runs as a plain child.
    scoped =
      available &&
      spawnSync('systemd-run', ['--user', '--scope', '--quiet', '--collect', '--', 'true'], { stdio: 'ignore', timeout: 5000 }).status ===
        0;
  }
  return available;
}

let browser: Promise<Browser> | null = null;
let idle: NodeJS.Timeout | null = null;
let queue: Promise<unknown> = Promise.resolve();
function launch() {
  browser ??= import('playwright-core').then(({ chromium }) =>
    chromium
      .launch({
        executablePath: scoped ? scopeWrapper : headlessShell()!,
        env: { ...process.env, BLOG_SCRAPER_CHROME: headlessShell()! },
        headless: true,
        chromiumSandbox: true,
        timeout: 15000,
      })
      .then((b) => {
        b.on('disconnected', () => {
          browser = null;
        });
        return b;
      }),
  );
  browser.catch(() => {
    browser = null;
  });
  return browser;
}
export async function closeRenderer() {
  if (idle) clearTimeout(idle);
  const open = browser;
  browser = null;
  await (await open?.catch(() => null))?.close().catch(() => {});
}

const hosts = new Map<string, boolean>();
/** The page's own subrequests get the crawler's public-address rule; checked per host, before each request. */
async function publicHost(hostname: string) {
  const known = hosts.get(hostname);
  if (known !== undefined) return known;
  let ok = false;
  try {
    const addresses = await lookup(hostname, { all: true });
    ok = addresses.length > 0 && addresses.every((a) => !isBlockedAddress(a.address));
  } catch {
    ok = false;
  }
  if (hosts.size > 2000) hosts.clear();
  hosts.set(hostname, ok);
  return ok;
}

/** Renders a page the trusted fetcher already allowed (robots, public address, HTML). Renders run one at a time;
 * images, media and fonts are skipped, and the main frame cannot navigate off the page's own site. */
export function renderVetted(url: string, userAgent?: string): Promise<SandboxPage> {
  const run = queue.then(async () => {
    if (idle) clearTimeout(idle);
    const b = await launch();
    const context = await b.newContext({ userAgent, serviceWorkers: 'block', acceptDownloads: false, javaScriptEnabled: true });
    const site = new URL(url).hostname.replace(/^www\./, '');
    try {
      const page = await context.newPage();
      await context.route('**/*', async (route) => {
        const request = route.request();
        if (['image', 'media', 'font'].includes(request.resourceType())) return route.abort();
        let target: URL;
        try {
          target = new URL(request.url());
        } catch {
          return route.abort();
        }
        if (target.protocol === 'data:' || target.protocol === 'blob:') return route.continue();
        if (!isAllowedCrawlUrl(target.href) || !(await publicHost(target.hostname.replace(/^\[|\]$/g, ''))))
          return route.abort('blockedbyclient');
        if (request.isNavigationRequest() && request.frame() === page.mainFrame() && target.hostname.replace(/^www\./, '') !== site)
          return route.abort('blockedbyclient');
        return route.continue();
      });
      await page.goto(url, { waitUntil: 'load', timeout: PAGE_MS });
      await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => {});
      const html = await page.content();
      if (Buffer.byteLength(html) > MAX_RESPONSE_BYTES) throw Error('render_response_too_large');
      return { url: page.url() || url, html };
    } finally {
      await context.close().catch(() => {});
      idle = setTimeout(() => void closeRenderer(), IDLE_CLOSE_MS);
      idle.unref();
    }
  });
  queue = run.catch(() => {});
  return run.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '';
    throw Error(/render_response_too_large/.test(message) ? message : /timeout/i.test(message) ? 'render_timeout' : 'render_failed');
  });
}
/** Raw fetch first (robots, address, content type, host delay), then the same page rendered. XML is never rendered. */
export async function fetchRendered(url: string, options: FeedCrawlerOptions, allowXml = false): Promise<SandboxPage> {
  const raw = await fetchHtml(url, options, allowXml);
  if (raw.xml) return raw;
  return renderVetted(raw.url, options.userAgent);
}
