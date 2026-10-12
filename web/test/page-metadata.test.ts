import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { publicPageType } from '../src/lib/analytics-consent.mts';
import { privatePageMetadata, SEARCH_URL_TEMPLATE, STATIC_PAGES, siteSchema, staticPageMetadata } from '../src/lib/seo.ts';

const APP = fileURLToPath(new URL('../src/app/', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function pages(dir = APP): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === 'page.tsx' ? [path] : [];
  });
}
/** /blogs/[slug]/page.tsx -> /blogs/[slug]/ */
const routeOf = (file: string) => `/${relative(APP, file).replace(/page\.tsx$/, '')}`;
const source = (file: string) => readFileSync(file, 'utf8');

const PRIVATE_ROUTES = ['/my/', '/login/', '/admin/', '/observe/opt-out/'];
const REDIRECT_ROUTES = ['/admin/discovery/'];
const DYNAMIC_PUBLIC = ['/blogs/[slug]/', '/topics/[id]/'];

test('every static public page has a unique title, description and trailing-slash self canonical', () => {
  const titles = new Set<string>();
  const descriptions = new Set<string>();
  for (const path of Object.keys(STATIC_PAGES) as Array<keyof typeof STATIC_PAGES>) {
    const meta = staticPageMetadata(path);
    assert.equal(meta.alternates.canonical, `https://blog.observe.tw${path}`);
    assert.match(meta.alternates.canonical, /\/$/);
    assert.ok(!meta.alternates.canonical.includes('?'));
    assert.equal(meta.openGraph.url, meta.alternates.canonical);
    assert.ok(!titles.has(meta.title.absolute), meta.title.absolute);
    assert.ok(!descriptions.has(meta.description), meta.description);
    titles.add(meta.title.absolute);
    descriptions.add(meta.description);
    // Every canonical public page is also measurable by analytics.
    assert.ok(publicPageType(path, 'https://blog.observe.tw'), path);
  }
});

test('every page route is either a known public page or a noindexed private one', () => {
  const routes = pages().map(routeOf).sort();
  const known = [...Object.keys(STATIC_PAGES), ...DYNAMIC_PUBLIC, ...PRIVATE_ROUTES, ...REDIRECT_ROUTES].sort();
  assert.deepEqual(routes, known);
  for (const route of Object.keys(STATIC_PAGES)) {
    const text = source(join(APP, route.slice(1), 'page.tsx'));
    assert.ok(text.includes(`staticPageMetadata('${route}')`), `${route} uses its STATIC_PAGES metadata`);
  }
  for (const route of DYNAMIC_PUBLIC) {
    const text = source(join(APP, route.slice(1), 'page.tsx'));
    // The registry's canonicalPath (readable URL), resolved through the page API, with ordinary public metadata.
    assert.match(text, /generateMetadata[\s\S]*pageMetadata\(\s*page\.canonicalPath,/, route);
    assert.match(text, /getPublicPage\('(blog|topic)', \(await params\)\.(slug|id)\)/, route);
    assert.ok(!/decodeParam|decodeURIComponent/.test(text), `${route} never decodes the param a second time`);
    assert.ok(!/(blogPath|topicPath)\(/.test(text), `${route} uses canonicalPath, not the legacy URL`);
  }
  for (const route of PRIVATE_ROUTES) {
    const text = source(join(APP, route.slice(1), 'page.tsx'));
    assert.match(text, /privatePageMetadata\(|robots: \{ index: false/, route);
    assert.ok(!text.includes('alternates'), `${route} has no canonical`);
  }
});

test('private page metadata is noindex without a canonical', () => {
  const meta = privatePageMetadata('登入') as Record<string, unknown>;
  assert.deepEqual(meta.robots, { index: false, follow: false });
  assert.equal(meta.alternates, undefined);
});

test('server pages and the layout never read cookies, headers or searchParams; ISR pages keep 120 s', () => {
  for (const file of [...pages(), join(APP, 'layout.tsx')]) {
    const text = source(file);
    if (text.startsWith("'use client'")) continue;
    assert.ok(!/\bcookies\(|\bheaders\(|searchParams/.test(text), relative(APP, file));
    const revalidate = /export const revalidate = (\d+)/.exec(text);
    if (revalidate) assert.equal(revalidate[1], '120', relative(APP, file));
  }
});

test('the emergency sitemap static pages keep valid canonicals', () => {
  const sitemap = source(join(ROOT, 'app/src/seo/routes.ts'));
  const listed = JSON.parse(`[${/const staticPages = \[([^\]]*)\]/.exec(sitemap)![1].replace(/'/g, '"')}]`) as string[];
  assert.ok(listed.length > 0);
  for (const path of listed) {
    assert.ok(path in STATIC_PAGES, path);
    assert.equal(staticPageMetadata(path as keyof typeof STATIC_PAGES).alternates.canonical, `https://blog.observe.tw${path}`);
  }
});

test('WebSite SearchAction points at the working header search (GET /articles/?q=)', () => {
  const search = source(join(APP, '../components/SiteSearch.tsx'));
  assert.match(search, /action="\/articles\/"/);
  assert.match(search, /name="q"/);
  assert.equal(SEARCH_URL_TEMPLATE, 'https://blog.observe.tw/articles/?q={search_term_string}');
  const site = siteSchema()['@graph'][0] as Record<string, unknown>;
  assert.deepEqual(site.potentialAction, {
    '@type': 'SearchAction',
    target: { '@type': 'EntryPoint', urlTemplate: SEARCH_URL_TEMPLATE },
    'query-input': 'required name=search_term_string',
  });
  assert.ok(!JSON.stringify(siteSchema()).includes('"Article"'));
});

test('the home page keeps one accessible h1', () => {
  const masthead = source(join(APP, '_home/MastheadCloud.tsx'));
  const logo = source(join(APP, '../components/Logo.tsx'));
  assert.equal(masthead.match(/<h1\b/g)?.length, 1);
  assert.match(logo, /role="img" aria-label="部落格觀察"/);
});

test('the footer links the opt-out page and the layout mounts SiteAnalytics', () => {
  assert.match(source(join(APP, '../components/SiteFooter.tsx')), /href: '\/observe\/opt-out\/'/);
  assert.match(source(join(APP, 'layout.tsx')), /<SiteAnalytics \/>/);
});
