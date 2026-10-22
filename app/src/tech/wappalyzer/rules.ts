/**
 * Loads the pinned Wappalyzer rule data (GPL-3.0, community fork enthec/webappanalyzer) from a directory outside the
 * repository and compiles only the technologies /tech/ publishes. The repository stays MIT: the data is downloaded at
 * deploy time by tools/fetch-wappalyzer-rules.ts, checked against data/wappalyzer-pin.json, and never committed.
 *
 * Compiling just the published vocabulary keeps the third-party regular expressions we run on untrusted pages to a few
 * dozen reviewed at pin time (tests run every one of them against adversarial input).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type CompiledTech, compileTech } from './matcher.ts';

/** Our product id → the Wappalyzer names that identify it (the data names a few products twice). */
export const WAPPALYZER_NAMES: Record<string, string[]> = {
  wordpress: ['WordPress'],
  blogger: ['Blogger'],
  hugo: ['Hugo'],
  jekyll: ['Jekyll'],
  ghost: ['Ghost'],
  hexo: ['Hexo'],
  next: ['Next.js'],
  nuxt: ['Nuxt.js'],
  ga: ['Google Analytics'],
  gtm: ['Google Tag Manager'],
  matomo: ['Matomo Analytics'],
  plausible: ['Plausible'],
  cloudflare: ['Cloudflare'],
  vercel: ['Vercel'],
  netlify: ['Netlify'],
  githubpages: ['GitHub Pages'],
  'wp-theme:astra': ['Astra'],
  'wp-theme:generatepress': ['GeneratePress'],
  'wp-theme:kadence': ['Kadence WP Kadence'],
  'wp-theme:oceanwp': ['OceanWP'],
  'wp-theme:neve': ['Neve'],
  'wp-theme:twentytwenty': ['Twenty Twenty'],
  'wp-theme:twentytwentyone': ['Twenty Twenty-One'],
  'wp-theme:twentytwentytwo': ['Twenty Twenty-Two'],
  'wp-theme:twentytwentythree': ['Twenty Twenty-Three'],
  'wp-theme:twentytwentyfour': ['Twenty Twenty-Four'],
  'wp-theme:twentytwentyfive': ['Twenty Twenty-Five'],
  'wp-plugin:wordpress-seo': ['Yoast SEO'],
  'wp-plugin:jetpack': ['Jetpack'],
  'wp-plugin:elementor': ['Elementor'],
  'wp-plugin:contact-form-7': ['Contact Form 7'],
  'wp-plugin:wpforms-lite': ['WPForms'],
  'wp-plugin:woocommerce': ['WooCommerce'],
  'wp-plugin:wp-rocket': ['WP Rocket'],
  'wp-plugin:litespeed-cache': ['LiteSpeed Cache', 'Litespeed Cache'],
  'wp-plugin:all-in-one-seo-pack': ['All in One SEO', 'All in One SEO Pack'],
};

export type WappalyzerPin = { repository: string; commit: string; license: string; pinnedAt: string; files: Record<string, string> };
export type WappalyzerRules = {
  /** Stored as the observation's rule version: changes whenever the pinned data changes. */
  version: string;
  commit: string;
  /** product id → every compiled Wappalyzer entry for it */
  products: Map<string, CompiledTech[]>;
  /** Mapped names the data no longer has (a renamed technology): reported by tools/fetch-wappalyzer-rules.ts --check. */
  missing: string[];
};

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const PIN_PATH = new URL('../../../../data/wappalyzer-pin.json', import.meta.url);

export const defaultRulesDirectory = () => process.env.BLOG_WAPPALYZER_RULES_DIR || join(homedir(), '.local/share/blog-observe/wappalyzer');

export function readPin(path: URL | string = PIN_PATH): WappalyzerPin {
  const pin = JSON.parse(readFileSync(path, 'utf8')) as WappalyzerPin;
  if (!/^[0-9a-f]{40}$/.test(pin.commit) || typeof pin.files !== 'object') throw new Error('invalid wappalyzer pin');
  return pin;
}

/** Reads and verifies the pinned files under `<directory>/<commit>/`; throws on a missing or altered file. */
export function loadWappalyzerRules(directory = defaultRulesDirectory(), pin: WappalyzerPin = readPin()): WappalyzerRules {
  const root = join(directory, pin.commit);
  const technologies: Record<string, unknown> = {};
  for (const [file, expected] of Object.entries(pin.files)) {
    const path = join(root, file);
    if (!existsSync(path)) throw new Error(`wappalyzer rules incomplete: ${file}`);
    const data = readFileSync(path);
    if (sha256(data) !== expected) throw new Error(`wappalyzer rules altered: ${file}`);
    if (file.startsWith('technologies/')) Object.assign(technologies, JSON.parse(data.toString('utf8')));
  }
  return compileVocabulary(technologies, pin.commit);
}

/** The vocabulary's technologies out of a name → rule table. Exported so tests can use a small fixture table. */
export function compileVocabulary(technologies: Record<string, unknown>, commit: string): WappalyzerRules {
  const products = new Map<string, CompiledTech[]>();
  const missing: string[] = [];
  for (const [id, names] of Object.entries(WAPPALYZER_NAMES)) {
    const compiled: CompiledTech[] = [];
    for (const name of names) {
      if (Object.hasOwn(technologies, name)) compiled.push(compileTech(name, technologies[name]));
      else missing.push(name);
    }
    if (compiled.length) products.set(id, compiled);
  }
  return { version: `wappalyzer-${commit.slice(0, 12)}`, commit, products, missing };
}

let cached: WappalyzerRules | null | undefined;
let warned = false;
/**
 * The rules this process uses, loaded once. null when the data is not installed (development, tests): callers then
 * fall back to the built-in conservative detection and the observation says so in its rule version.
 */
export function activeWappalyzerRules(): WappalyzerRules | null {
  if (cached !== undefined) return cached;
  // Tests are hermetic: the machine's installed rules are used only when a test points the variable at a directory.
  if (process.env.NODE_ENV === 'test' && !process.env.BLOG_WAPPALYZER_RULES_DIR) {
    cached = null;
    return cached;
  }
  try {
    cached = loadWappalyzerRules();
  } catch (error) {
    cached = null;
    if (!warned && process.env.NODE_ENV !== 'test') {
      warned = true;
      console.warn(JSON.stringify({ wappalyzerRules: 'unavailable', reason: error instanceof Error ? error.message : 'unknown' }));
    }
  }
  return cached;
}
/** Test seam: install a rules table (or null to force the fallback). */
export function setWappalyzerRulesForTest(rules: WappalyzerRules | null | undefined) {
  cached = rules;
}
