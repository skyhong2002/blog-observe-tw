import * as cheerio from 'cheerio';
import {
  type DetectorInput,
  type SafeTechEvidence,
  TECH_LIMITS,
  TECH_RULE_VERSION,
  type TechCategory,
  type TechDetection,
  type TechObservation,
} from './contracts.ts';
import { matchInputOf } from './wappalyzer/input.ts';
import { matchTech, type RuleKind } from './wappalyzer/matcher.ts';
import { activeWappalyzerRules, type WappalyzerRules } from './wappalyzer/rules.ts';

const products: Record<string, { name: string; category: TechCategory }> = {
  wordpress: { name: 'WordPress', category: 'cms' },
  blogger: { name: 'Blogger', category: 'cms' },
  hugo: { name: 'Hugo', category: 'cms' },
  jekyll: { name: 'Jekyll', category: 'cms' },
  ghost: { name: 'Ghost', category: 'cms' },
  hexo: { name: 'Hexo', category: 'cms' },
  next: { name: 'Next.js', category: 'framework' },
  nuxt: { name: 'Nuxt', category: 'framework' },
  ga: { name: 'Google Analytics', category: 'analytics' },
  gtm: { name: 'Google Tag Manager', category: 'analytics' },
  matomo: { name: 'Matomo', category: 'analytics' },
  plausible: { name: 'Plausible', category: 'analytics' },
  cloudflare: { name: 'Cloudflare', category: 'cdn' },
  vercel: { name: 'Vercel', category: 'hosting' },
  netlify: { name: 'Netlify', category: 'hosting' },
  githubpages: { name: 'GitHub Pages', category: 'hosting' },
};
const themes: Record<string, string> = {
  astra: 'Astra',
  generatepress: 'GeneratePress',
  kadence: 'Kadence',
  oceanwp: 'OceanWP',
  neve: 'Neve',
  twentytwenty: 'Twenty Twenty',
  twentytwentyone: 'Twenty Twenty-One',
  twentytwentytwo: 'Twenty Twenty-Two',
  twentytwentythree: 'Twenty Twenty-Three',
  twentytwentyfour: 'Twenty Twenty-Four',
  twentytwentyfive: 'Twenty Twenty-Five',
};
const plugins: Record<string, string> = {
  'wordpress-seo': 'Yoast SEO',
  jetpack: 'Jetpack',
  elementor: 'Elementor',
  'contact-form-7': 'Contact Form 7',
  'wpforms-lite': 'WPForms Lite',
  woocommerce: 'WooCommerce',
  'wp-rocket': 'WP Rocket',
  'litespeed-cache': 'LiteSpeed Cache',
  'all-in-one-seo-pack': 'All in One SEO',
};
for (const [id, name] of Object.entries(themes)) products[`wp-theme:${id}`] = { name, category: 'theme' };
for (const [id, name] of Object.entries(plugins)) products[`wp-plugin:${id}`] = { name, category: 'plugin' };

/** Source location only: never credentials, query/hash values, mail addresses, or tracking IDs in paths. */
export function safeTechSourceUrl(raw: string): string | null {
  try {
    if (raw.length > 4096) return null;
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port)))
      return null;
    if (/[\p{Cc}\p{Cf}]/u.test(raw)) return null;
    let redactNext = false;
    const safePath = url.pathname
      .split('/')
      .map((part) => {
        let decoded: string;
        try {
          decoded = decodeURIComponent(part);
        } catch {
          return 'redacted';
        }
        const sensitive = /^(?:token|secret|api[-_]?key|password|reset|auth|session|email)$/i.test(decoded);
        const omit = redactNext;
        redactNext = sensitive;
        return omit ||
          sensitive ||
          /@.*\.|(?:GTM-|G-|UA-)\w|[a-f\d]{32,}/i.test(decoded) ||
          /^[A-Za-z0-9_-]{25,}$/.test(decoded) ||
          decoded.length > 180
          ? 'redacted'
          : part;
      })
      .join('/');
    return `${url.origin}${safePath}`.slice(0, 1024);
  } catch {
    return null;
  }
}
function header(input: DetectorInput, name: string): string {
  if (input.headers instanceof Headers) return input.headers.get(name) ?? '';
  const match = Object.entries(input.headers ?? {}).find(([key]) => key.toLowerCase() === name);
  return typeof match?.[1] === 'string' ? match[1].slice(0, 512) : '';
}
const confidenceRank = { high: 0.95, medium: 0.7, low: 0.3 };
const VERSION = /^\d{1,3}(?:\.\d{1,3}){0,3}(?:-(?:alpha|beta|rc)\d{0,3})?$/;

/** What a matched Wappalyzer rule may say as evidence: a fixed phrase per rule kind, never the page's own text. */
const RULE_EVIDENCE: Record<Exclude<RuleKind, 'meta'>, SafeTechEvidence> = {
  url: { kind: 'marker', value: 'URL rule' },
  html: { kind: 'marker', value: 'page markup rule' },
  dom: { kind: 'marker', value: 'page markup rule' },
  scripts: { kind: 'marker', value: 'inline script rule' },
  scriptSrc: { kind: 'asset', value: 'script URL rule' },
  headers: { kind: 'header', value: 'response header rule' },
};
const META_EVIDENCE: SafeTechEvidence = { kind: 'marker', value: 'meta tag rule' };
const RULE_MARKERS = new Set(['URL rule', 'page markup rule', 'inline script rule', 'meta tag rule']);

/**
 * Detection by the pinned Wappalyzer rules (wappalyzer/rules.ts), limited to the products /tech/ publishes. The input
 * is one whole response of the blog's own site; a version is read only from an explicit `meta generator`.
 */
function detectWithRules(
  rules: WappalyzerRules,
  input: DetectorInput,
  html: string,
  observation: TechObservation,
  at: string,
): TechObservation {
  const { input: matchInput, inspectedNodes } = matchInputOf(input.url, html, input.headers);
  observation.coverage.inspectedNodes = inspectedNodes;
  const found: TechDetection[] = [];
  for (const [id, entries] of rules.products) {
    const product = products[id];
    if (!product) continue;
    let confidence = 0;
    let generator = false;
    const versions = new Set<string>();
    const kinds = new Set<RuleKind>();
    for (const entry of entries) {
      const result = matchTech(entry, matchInput);
      if (!result) continue;
      confidence = Math.max(confidence, result.confidence);
      generator ||= result.generator;
      for (const version of result.generatorVersions) if (VERSION.test(version)) versions.add(version);
      for (const kind of result.matched) kinds.add(kind);
    }
    if (confidence <= 0) continue;
    // Conflicting explicit versions prove the product but not which one is running.
    const version = versions.size === 1 ? [...versions][0] : 'unknown';
    const evidence: SafeTechEvidence[] = [];
    if (generator) evidence.push({ kind: 'generator', value: `${product.name}${version === 'unknown' ? '' : ` ${version}`}` });
    else if (kinds.has('meta')) evidence.push(META_EVIDENCE);
    for (const kind of kinds) {
      if (kind === 'meta') continue;
      const item = RULE_EVIDENCE[kind];
      if (!evidence.some((e) => e.kind === item.kind && e.value === item.value)) evidence.push(item);
    }
    if (!evidence.length) continue;
    found.push({
      id,
      ...product,
      // Hosting and CDN signals are hints, never ownership.
      confidence: ['hosting', 'cdn'].includes(product.category) ? Math.min(0.4, confidence / 100) : confidence / 100,
      version,
      ruleId: `wappalyzer:${id}`,
      ruleVersion: rules.version,
      observedAt: at,
      evidence: evidence.slice(0, TECH_LIMITS.evidencePerDetection),
    });
  }
  observation.ruleVersion = rules.version;
  observation.detections = found.sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id)).slice(0, TECH_LIMITS.detections);
  observation.detections.sort((a, b) => a.id.localeCompare(b.id));
  observation.status = observation.detections.length ? 'detected' : 'unknown';
  return observation;
}

/** Pure bounded parser. No fetch, DNS, filesystem, cookies, or external lookups. */
export function detectTechnology(input: DetectorInput): TechObservation {
  const at =
    input.observedAt instanceof Date && Number.isFinite(input.observedAt.getTime())
      ? input.observedAt.toISOString()
      : new Date().toISOString();
  const sourceType = input.sourceType ?? (typeof input.html === 'string' ? 'html' : 'header');
  const buffer = Buffer.from((input.html ?? '').slice(0, TECH_LIMITS.htmlBytes), 'utf8');
  const html = buffer.subarray(0, TECH_LIMITS.htmlBytes).toString('utf8');
  const observation: TechObservation = {
    status: 'unknown',
    sourceUrl: safeTechSourceUrl(input.url),
    sourceType,
    coverage: {
      partial: true,
      method: 'passive-existing-response',
      sourceType,
      htmlTruncated: (input.html?.length ?? 0) > TECH_LIMITS.htmlBytes || buffer.length > TECH_LIMITS.htmlBytes,
      inspectedNodes: 0,
    },
    detections: [],
    ruleVersion: TECH_RULE_VERSION,
    lastAttemptAt: at,
    observedAt: at,
    errorCode: null,
  };
  const stop = (status: 'failed' | 'blocked', errorCode: TechObservation['errorCode']) => ({
    ...observation,
    status,
    observedAt: null,
    errorCode,
  });
  const challenge =
    header(input, 'cf-mitigated').toLowerCase() === 'challenge' ||
    /(?:\/cdn-cgi\/challenge-platform\/|\bcf-chl-[\w-]+|<title[^>]*>\s*(?:Just a moment|Attention Required!\s*\|\s*Cloudflare))/i.test(
      html,
    ) ||
    /<title[^>]*>\s*(?:Access Denied|Request blocked|Security verification)/i.test(html);
  if (input.blockedReason || [401, 403, 429].includes(input.httpStatus ?? 200) || challenge)
    return stop('blocked', input.blockedReason ?? (input.httpStatus === 429 ? 'rate-limit' : 'waf'));
  if (input.failureReason) return stop('failed', input.failureReason);
  if (!observation.sourceUrl || (input.httpStatus !== undefined && (input.httpStatus < 200 || input.httpStatus >= 300)))
    return stop('failed', 'http-error');
  if (input.html === undefined && input.headers === undefined) return stop('failed', 'invalid-response');
  // A stored post body is the author's text without the page's head: what it mentions says nothing about the site,
  // so only whole responses go through the Wappalyzer rules.
  const rules = sourceType === 'body-fragment' ? null : activeWappalyzerRules();
  if (rules) return detectWithRules(rules, input, html, observation, at);
  const found = new Map<string, TechDetection>();
  const declaredVersions = new Map<string, Set<string>>();
  const add = (id: string, confidence: keyof typeof confidenceRank, evidence: SafeTechEvidence, version = 'unknown') => {
    const product = products[id];
    if (!product) return;
    // A page can retain stale/duplicated generator tags. Conflicting explicit
    // versions prove the product, but cannot establish which version is running.
    const versions = declaredVersions.get(id) ?? new Set<string>();
    if (version !== 'unknown') versions.add(version);
    declaredVersions.set(id, versions);
    const resolvedVersion = versions.size === 1 ? [...versions][0] : 'unknown';
    const generatorEvidence = `${product.name}${resolvedVersion === 'unknown' ? '' : ` ${resolvedVersion}`}`;
    if (evidence.kind === 'generator') evidence = { kind: 'generator', value: generatorEvidence };
    const previous = found.get(id);
    if (previous) {
      if (confidenceRank[confidence] > previous.confidence) previous.confidence = confidenceRank[confidence];
      previous.version = resolvedVersion;
      previous.evidence = previous.evidence.map((e) => (e.kind === 'generator' ? { kind: 'generator', value: generatorEvidence } : e));
      if (!previous.evidence.some((e) => e.kind === evidence.kind && e.value === evidence.value)) {
        if (previous.evidence.length < TECH_LIMITS.evidencePerDetection) previous.evidence.push(evidence);
        // If asset/marker hints filled the evidence budget, retain the declaration
        // before exposing its version. Never infer a version from asset hints.
        else if (evidence.kind === 'generator') previous.evidence[previous.evidence.length - 1] = evidence;
      }
      return;
    }
    if (found.size < TECH_LIMITS.detections)
      found.set(id, {
        id,
        ...product,
        confidence: confidenceRank[confidence],
        version: resolvedVersion,
        ruleId: `passive:${id}`,
        ruleVersion: TECH_RULE_VERSION,
        observedAt: at,
        evidence: [evidence],
      });
  };
  const $ = cheerio.load(html);
  $('meta[name="generator" i],script,link[href]')
    .slice(0, TECH_LIMITS.nodes)
    .each((_index, element) => {
      observation.coverage.inspectedNodes++;
      const el = $(element);
      if (element.tagName === 'meta') {
        const content = el.attr('content')?.trim() ?? '';
        // Only an exact generator declaration may establish a version. Never ?ver=, headers, or asset filenames.
        const generator =
          /^(WordPress|Blogger|Hugo|Jekyll|Ghost|Hexo|Next(?:\.js)?|Nuxt(?:\.js)?)(?:\s+(?:v)?(\d{1,3}(?:\.\d{1,3}){0,3}(?:-(?:alpha|beta|rc)\d{0,3})?))?(?:\s*;?\s*(?:https?:\/\/[^\s]+|www\.[^\s]+))?$/i.exec(
            content,
          );
        if (generator) {
          const id = generator[1].toLowerCase().replace('.js', '');
          add(
            id,
            'high',
            { kind: 'generator', value: `${products[id]?.name}${generator[2] ? ` ${generator[2]}` : ''}` },
            generator[2] ?? 'unknown',
          );
        }
      }
      if (element.tagName === 'script') {
        const id = el.attr('id');
        if (id === '__NEXT_DATA__') add('next', 'high', { kind: 'marker', value: '__NEXT_DATA__' });
        if (id === '__NUXT_DATA__') add('nuxt', 'high', { kind: 'marker', value: '__NUXT_DATA__' });
        const text = el.html()?.slice(0, 65536) ?? '';
        if (/\bgtag\(\s*['"]config['"]\s*,\s*['"](?:G-|UA-)/.test(text)) add('ga', 'medium', { kind: 'marker', value: 'gtag config' });
        if (/googletagmanager\.com\/gtm\.js/.test(text)) add('gtm', 'medium', { kind: 'marker', value: 'GTM bootstrap' });
      }
      const raw = el.attr(element.tagName === 'script' ? 'src' : 'href');
      if (!raw || raw.length > 4096) return;
      let asset: URL;
      try {
        asset = new URL(raw, input.url);
      } catch {
        return;
      }
      if (!['http:', 'https:'].includes(asset.protocol) || asset.username || asset.password) return;
      const path = asset.pathname;
      const host = asset.hostname.toLowerCase();
      if (/\/wp-(?:includes|content)\//.test(path))
        add('wordpress', 'medium', { kind: 'asset', value: /\/wp-includes\//.test(path) ? '/wp-includes/' : '/wp-content/' });
      const wp = /\/wp-content\/(themes|plugins)\/([a-z0-9-]+)\//.exec(path);
      if (wp && (wp[1] === 'themes' ? themes : plugins)[wp[2]])
        add(`wp-${wp[1] === 'themes' ? 'theme' : 'plugin'}:${wp[2]}`, 'medium', { kind: 'asset', value: `/wp-content/${wp[1]}/${wp[2]}/` });
      if (/\/_next\/static\//.test(path)) add('next', 'medium', { kind: 'asset', value: '/_next/static/' });
      if (/\/_nuxt\//.test(path)) add('nuxt', 'medium', { kind: 'asset', value: '/_nuxt/' });
      if (host === 'www.blogger.com' && /^\/static\/v1\/(?:widgets|jsbin)\//.test(path))
        add('blogger', 'medium', { kind: 'asset', value: 'www.blogger.com/static/v1/widgets/' });
      if (host === 'www.googletagmanager.com' && path === '/gtag/js')
        add('ga', 'medium', { kind: 'asset', value: 'www.googletagmanager.com/gtag/js' });
      if (host === 'www.google-analytics.com' && ['/analytics.js', '/ga.js'].includes(path))
        add('ga', 'high', { kind: 'asset', value: `www.google-analytics.com${path}` });
      if (host === 'www.googletagmanager.com' && path === '/gtm.js')
        add('gtm', 'high', { kind: 'asset', value: 'www.googletagmanager.com/gtm.js' });
      if (host === 'plausible.io' && /^\/js\/(?:script|plausible)(?:\.[a-z-]+)*\.js$/.test(path))
        add('plausible', 'medium', { kind: 'asset', value: 'plausible.io/js/script.js' });
      if (/\/(?:matomo|piwik)\.js$/.test(path)) add('matomo', 'low', { kind: 'asset', value: '/matomo.js' });
    });
  // Infrastructure headers are hints, not origin ownership or a hosting guarantee. Values/versions never leave this function.
  if (header(input, 'server').toLowerCase() === 'cloudflare' || header(input, 'cf-ray'))
    add('cloudflare', 'low', { kind: 'header', value: 'Cloudflare response marker' });
  if (header(input, 'x-vercel-id')) add('vercel', 'low', { kind: 'header', value: 'x-vercel-id present' });
  if (header(input, 'x-nf-request-id')) add('netlify', 'low', { kind: 'header', value: 'x-nf-request-id present' });
  if (header(input, 'server').toLowerCase() === 'github.com')
    add('githubpages', 'low', { kind: 'header', value: 'GitHub Pages response marker' });
  if (/^next\.js$/i.test(header(input, 'x-powered-by'))) add('next', 'medium', { kind: 'header', value: 'Next.js response marker' });
  observation.detections = [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
  observation.status = observation.detections.length ? 'detected' : 'unknown';
  return observation;
}

const assets: Record<string, string[]> = {
  wordpress: ['/wp-includes/', '/wp-content/'],
  next: ['/_next/static/'],
  nuxt: ['/_nuxt/'],
  blogger: ['www.blogger.com/static/v1/widgets/'],
  ga: ['www.googletagmanager.com/gtag/js', 'www.google-analytics.com/analytics.js', 'www.google-analytics.com/ga.js'],
  gtm: ['www.googletagmanager.com/gtm.js'],
  plausible: ['plausible.io/js/script.js'],
  matomo: ['/matomo.js'],
};
const markers: Record<string, string[]> = { next: ['__NEXT_DATA__'], nuxt: ['__NUXT_DATA__'], ga: ['gtag config'], gtm: ['GTM bootstrap'] };
const headers: Record<string, string[]> = {
  cloudflare: ['Cloudflare response marker'],
  vercel: ['x-vercel-id present'],
  netlify: ['x-nf-request-id present'],
  githubpages: ['GitHub Pages response marker'],
  next: ['Next.js response marker'],
};
const WAPPALYZER_RULE = /^wappalyzer-[0-9a-f]{12}$/;
function allowedEvidence(d: TechDetection, e: SafeTechEvidence, byRules: boolean): boolean {
  if (e.kind === 'generator')
    return ['cms', 'framework'].includes(d.category) && e.value === `${d.name}${d.version === 'unknown' ? '' : ` ${d.version}`}`;
  if (byRules) {
    if (e.kind === 'marker') return RULE_MARKERS.has(e.value);
    if (e.kind === 'header') return e.value === RULE_EVIDENCE.headers.value;
    return e.kind === 'asset' && e.value === RULE_EVIDENCE.scriptSrc.value;
  }
  if (e.kind === 'marker') return markers[d.id]?.includes(e.value) ?? false;
  if (e.kind === 'header') return headers[d.id]?.includes(e.value) ?? false;
  if (e.kind !== 'asset') return false;
  if (d.id.startsWith('wp-theme:')) return e.value === `/wp-content/themes/${d.id.slice(9)}/`;
  if (d.id.startsWith('wp-plugin:')) return e.value === `/wp-content/plugins/${d.id.slice(10)}/`;
  return assets[d.id]?.includes(e.value) ?? false;
}

/** Defense at the persistence boundary: only bounded detector-owned vocabulary/evidence may be serialized. */
export function validTechObservation(value: TechObservation): boolean {
  // Built-in detection carries TECH_RULE_VERSION; Wappalyzer-rule detection carries the pinned data's version.
  const byRules = typeof value?.ruleVersion === 'string' && WAPPALYZER_RULE.test(value.ruleVersion);
  if (
    !value ||
    (!byRules && value.ruleVersion !== TECH_RULE_VERSION) ||
    !['detected', 'unknown', 'failed', 'blocked'].includes(value.status)
  )
    return false;
  if (!['html', 'body-fragment', 'header'].includes(value.sourceType) || value.sourceUrl !== safeTechSourceUrl(value.sourceUrl ?? ''))
    return false;
  if (!Array.isArray(value.detections) || value.detections.length > TECH_LIMITS.detections) return false;
  if (!Number.isFinite(Date.parse(value.lastAttemptAt)) || Date.parse(value.lastAttemptAt) > Date.now() + 300_000) return false;
  if (['detected', 'unknown'].includes(value.status) ? value.observedAt !== value.lastAttemptAt : value.observedAt !== null) return false;
  if (value.status === 'detected' ? !value.detections.length : value.detections.length !== 0) return false;
  if (
    value.coverage?.partial !== true ||
    value.coverage.method !== 'passive-existing-response' ||
    value.coverage.sourceType !== value.sourceType ||
    typeof value.coverage.htmlTruncated !== 'boolean' ||
    !Number.isInteger(value.coverage.inspectedNodes) ||
    value.coverage.inspectedNodes < 0 ||
    value.coverage.inspectedNodes > TECH_LIMITS.nodes
  )
    return false;
  if (
    value.errorCode !== null &&
    !['robots', 'waf', 'rate-limit', 'http-error', 'timeout', 'network', 'invalid-response'].includes(value.errorCode)
  )
    return false;
  const seen = new Set<string>();
  for (const d of value.detections) {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    if (
      !products[d.id] ||
      d.name !== products[d.id].name ||
      d.category !== products[d.id].category ||
      d.ruleId !== `${byRules ? 'wappalyzer' : 'passive'}:${d.id}` ||
      d.ruleVersion !== value.ruleVersion ||
      d.observedAt !== value.observedAt
    )
      return false;
    if (
      !Number.isFinite(d.confidence) ||
      d.confidence < 0 ||
      d.confidence > 1 ||
      (['hosting', 'cdn'].includes(d.category) && d.confidence > 0.4)
    )
      return false;
    if (d.version !== 'unknown' && !VERSION.test(d.version)) return false;
    if (!Array.isArray(d.evidence) || !d.evidence.length || d.evidence.length > TECH_LIMITS.evidencePerDetection) return false;
    for (const e of d.evidence)
      if (!allowedEvidence(d, e, byRules) || typeof e.value !== 'string' || e.value.length > 100 || !/^[a-zA-Z0-9 /.\-_:]+$/.test(e.value))
        return false;
    if (d.version !== 'unknown' && !d.evidence.some((e) => e.kind === 'generator' && e.value === `${d.name} ${d.version}`)) return false;
  }
  return Buffer.byteLength(JSON.stringify(value)) <= TECH_LIMITS.payloadBytes;
}
