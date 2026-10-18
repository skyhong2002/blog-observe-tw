/**
 * /tech/ and the profile's 使用的技術: pure helpers, the strict contracts, the
 * optional section's failure path and where the feature switch is read. What
 * the views render is checked by real server rendering in tech-render.spec.tsx;
 * the source checks here only pin wiring (flag before any read, no env on the
 * client, links through NoPrefetchLink). All payloads are synthetic.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { validPublicPayload } from '../src/lib/public-contracts.ts';
import { publicKindOf } from '../src/lib/public-paths.ts';
import { PublicGatewayError, readPublic } from '../src/lib/public-read.ts';
import { NAV_GROUPS, navGroupsFor } from '../src/lib/site-nav.ts';
import {
  blogTechApiPath,
  canonicalBlogPath,
  confidenceLabel,
  coverageNote,
  errorLabel,
  explicitVersions,
  externalHref,
  isHistorical,
  isInfra,
  isTechBaseline,
  isTechId,
  observedBlogs,
  share,
  shownVersion,
  sourceTypeText,
  statusNote,
  statusText,
  TECH_STATUSES,
  techApiPath,
  techHref,
  techQueryOf,
  versionLabel,
} from '../src/lib/tech.ts';
import { EMPTY, notObservedBlog, techMethod } from './public-payloads.ts';

const SRC = new URL('../src/', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, SRC), 'utf8');
const params = (search: string) => new URLSearchParams(search);

// Source checks read the syntax tree, so comments (trivia, never nodes) cannot pass or fail them.
const parse = (path: string) =>
  ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
function nodes(root: ts.Node): ts.Node[] {
  const all: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    all.push(node);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  return all;
}
/** Every module a file loads, statically or dynamically; a computed specifier is '<dynamic>'. */
const importsOf = (file: ts.SourceFile) =>
  nodes(file).flatMap((node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
      return [ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '<dynamic>'];
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      return node.arguments.map((arg) => (ts.isStringLiteralLike(arg) ? arg.text : '<dynamic>'));
    return [];
  });
const processUses = (file: ts.SourceFile) => nodes(file).filter((node) => ts.isIdentifier(node) && node.text === 'process').length;
const defaultFunction = (file: ts.SourceFile) =>
  file.statements.find(
    (s): s is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(s) && !!ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword),
  );

/* Feature switch ------------------------------------------------------------ */

test('flag: only the server runtime env BLOG_TECH_PUBLIC_ENABLED === "true", in a server-only module', () => {
  const flag = parse('lib/tech-flag.ts');
  assert.deepEqual(importsOf(flag), ['server-only']);
  assert.equal(processUses(flag), 1);
  const text = flag.statements.map((s) => s.getText()).join('\n');
  assert.match(text, /^export const techPublicEnabled = \(\) => process\.env\.BLOG_TECH_PUBLIC_ENABLED === 'true';$/m);
  assert.doesNotMatch(text, /NEXT_PUBLIC_/);
});

test('flag: /tech/ is a 404 while off, before the gateway is read', () => {
  const page = parse('app/tech/page.tsx');
  const body = defaultFunction(page)?.body;
  assert.ok(body);
  const [off, read, mismatch] = body.statements.map((s) => s.getText());
  assert.equal(off, 'if (!techPublicEnabled()) notFound();');
  assert.equal(read, 'const baseline = await publicJsonOrNull<TechStats>(techApiPath());');
  // The gateway's own 404 while the site is on is said on the page, not turned into a 404 or an empty result.
  assert.equal(mismatch, 'if (!baseline) return <TechUnavailable />;');
  assert.match(source('app/tech/page.tsx'), /^export const dynamic = 'force-dynamic';$/m);
  assert.match(source('app/tech/page.tsx'), /^export const metadata = staticPageMetadata\('\/tech\/'\);$/m);
});

test('flag: the profile section is rendered, and read, only while on, in its own Suspense', () => {
  const profile = source('app/blogs/[slug]/page.tsx');
  assert.match(
    profile,
    /\{techPublicEnabled\(\) && \(\s*<Suspense fallback=\{<BlogTechPending \/>\}>\s*<BlogTech slug=\{blog\.slug\} \/>\s*<\/Suspense>\s*\)\}/,
  );
  assert.equal(profile.match(/<BlogTech\b/g)?.length, 1);
});

test('flag: the layout passes a boolean down; client files never read the env or the flag module', () => {
  assert.match(source('app/layout.tsx'), /<SiteHeader techEnabled=\{techPublicEnabled\(\)\} \/>/);
  // GA and the rest of the layout are untouched.
  assert.match(source('app/layout.tsx'), /<SiteAnalytics \/>/);
  for (const path of [
    'components/SiteHeader.tsx',
    'components/SiteNavigation.tsx',
    'components/public/TechStats.tsx',
    'components/FooterMethod.tsx',
    'lib/tech.ts',
    'lib/site-nav.ts',
  ]) {
    const file = parse(path);
    assert.equal(processUses(file), 0, path);
    for (const specifier of importsOf(file))
      assert.doesNotMatch(specifier, /(^|\/)(tech-flag|server-only|public-api)(\.ts)?$|^<dynamic>$/, `${path} imports ${specifier}`);
  }
  assert.match(source('components/SiteHeader.tsx'), /<SiteNavigation techEnabled=\{techEnabled\} \/>/);
  assert.match(source('components/SiteHeader.tsx'), /\{ techEnabled = false \}/);
  assert.match(source('components/SiteNavigation.tsx'), /\{ techEnabled = false \}/);
  assert.match(source('components/SiteNavigation.tsx'), /const groups = navGroupsFor\(\{ tech: techEnabled \}\);/);
});

test('nav: 使用的技術 sits in 看部落格 and shows only when the feature is exactly on', () => {
  const group = NAV_GROUPS.find((g) => g.label === '看部落格');
  assert.ok(group?.links.some((link) => link.href === '/tech/' && link.feature === 'tech'));
  const hrefs = (features?: { tech?: boolean }) => navGroupsFor(features).flatMap((g) => g.links.map((link) => link.href));
  assert.ok(hrefs({ tech: true }).includes('/tech/'));
  for (const off of [undefined, {}, { tech: false }]) assert.ok(!hrefs(off).includes('/tech/'), JSON.stringify(off));
  // Nothing else changes with the switch.
  assert.deepEqual(
    hrefs({ tech: false }),
    hrefs({ tech: true }).filter((href) => href !== '/tech/'),
  );
});

test('views: internal links go through NoPrefetchLink; nothing is kept between reads; no real sites', () => {
  for (const path of ['components/public/TechStats.tsx', 'components/BlogTech.tsx']) {
    const text = source(path);
    assert.match(text, /^import Link from '@\/components\/NoPrefetchLink';$/m, path);
    assert.doesNotMatch(text, /next\/link|prefetch|localStorage|sessionStorage|revalidate|force-cache/, path);
    // A request-local Map only deduplicates evidence; a module-level store would retain data across reads.
    assert.doesNotMatch(text, /^(?:export )?(?:const|let|var) \w+\s*=\s*new Map/m, path);
  }
  for (const path of ['components/public/TechStats.tsx', 'components/BlogTech.tsx', 'lib/tech.ts', 'app/tech/page.tsx'])
    assert.doesNotMatch(source(path), /timdream|Alina|Carol|\b\d+\.\d+\.\d+\b/i, path);
});

/* Pure helpers ------------------------------------------------------------- */

test('statuses: five states read as four labels, none of which claims a technology is absent', () => {
  assert.deepEqual(TECH_STATUSES, ['detected', 'unknown', 'failed', 'blocked', 'not-observed']);
  assert.equal(new Set(TECH_STATUSES.map((s) => statusText[s])).size, 4);
  assert.equal(statusText['not-observed'], statusText.unknown);
  assert.notEqual(statusNote['not-observed'], statusNote.unknown);
  for (const state of TECH_STATUSES) assert.doesNotMatch(statusNote[state], /沒有使用(?!任何技術)|未使用(?!」)/, state);
});

test('versions: only an explicit version with evidence is shown; confidence buckets follow the gateway', () => {
  const evidence = [{ kind: 'generator' as const, value: 'WordPress 6.4' }];
  assert.equal(shownVersion({ version: '6.4', evidence }), '6.4');
  assert.equal(shownVersion({ version: '6.4', evidence: [] }), null);
  assert.equal(shownVersion({ version: 'unknown', evidence }), null);
  assert.equal(shownVersion({ version: '', evidence }), null);
  assert.equal(versionLabel('unknown'), '未知');
  assert.equal(versionLabel(null), '未知');
  assert.deepEqual(
    explicitVersions({
      id: 'wordpress',
      name: 'WordPress',
      category: 'cms',
      blogs: 2,
      versions: [
        { version: 'unknown', blogs: 1 },
        { version: '6.4', blogs: 1 },
      ],
    }),
    [{ version: '6.4', blogs: 1 }],
  );
  assert.equal(confidenceLabel(0.95), '高');
  assert.equal(confidenceLabel(0.7), '中');
  assert.equal(confidenceLabel(0.3), '低');
  assert.equal(confidenceLabel(Number.NaN), '未記錄');
});

test('categories: hosting and CDN are infrastructure, never software', () => {
  assert.ok(isInfra('hosting') && isInfra('cdn'));
  for (const category of ['cms', 'framework', 'theme', 'plugin', 'analytics']) assert.equal(isInfra(category), false, category);
});

test('history: failed / blocked with kept detections are the last success, not the current answer', () => {
  const detection = { id: 'wordpress' } as never;
  assert.equal(isHistorical({ status: 'failed', detections: [detection] }), true);
  assert.equal(isHistorical({ status: 'blocked', detections: [detection] }), true);
  assert.equal(isHistorical({ status: 'failed', detections: [] }), false);
  assert.equal(isHistorical({ status: 'detected', detections: [detection] }), false);
  assert.equal(errorLabel('robots'), 'robots.txt 不允許');
  assert.equal(errorLabel(null), '原因未記錄');
  assert.equal(errorLabel('something-new'), '原因未記錄');
});

test('coverage: a body fragment is never the whole site; shares need a denominator', () => {
  const base = { partial: true, method: 'passive-existing-response', htmlTruncated: false, inspectedNodes: 10 } as const;
  assert.match(coverageNote({ ...base, sourceType: 'body-fragment' }), /部分覆蓋，不代表已掃描全站/);
  assert.match(coverageNote({ ...base, sourceType: 'html', htmlTruncated: true }), /只看了前段/);
  // An html snapshot may be an article page the crawler read, so it is never called the home page alone.
  assert.equal(coverageNote({ ...base, sourceType: 'html' }), '檢查既有的公開 HTML 回應（首頁或文章）。');
  assert.equal(sourceTypeText.html, '公開 HTML（首頁或文章）');
  assert.equal(coverageNote(null), '沒有觀測範圍紀錄。');
  assert.equal(share(1, 4), '25%');
  assert.equal(share(1, 3), '33.3%');
  assert.equal(share(0, 0), '—');
  assert.equal(
    observedBlogs({ totalBlogs: 9, scannedBlogs: 9, truncated: false, detected: 1, unknown: 2, failed: 3, blocked: 1, notObserved: 2 }),
    7,
  );
});

test('links: the canonical page comes from the payload url, never built from the slug', () => {
  assert.equal(canonicalBlogPath('https://blog.observe.tw/blogs/example.com/'), '/blogs/example.com/');
  for (const bad of [null, '', 'javascript:alert(1)', 'https://blog.observe.tw/blogs/a/?x=1', 'https://blog.observe.tw/topics/rss%3A1/'])
    assert.equal(canonicalBlogPath(bad), null, String(bad));
  assert.equal(externalHref('https://a.example/'), 'https://a.example/');
  assert.equal(externalHref('javascript:alert(1)'), null);
});

test('query: ids are URL-encoded; what the gateway would refuse is dropped, not sent; paths are public', () => {
  assert.equal(techHref({}), '/tech/');
  assert.equal(techHref({ technology: 'wp-theme:astra' }), '/tech/?technology=wp-theme%3Aastra');
  assert.equal(techApiPath({ technology: 'wp-plugin:elementor', cursor: '120' }), '/api/tech?technology=wp-plugin%3Aelementor&cursor=120');
  assert.equal(techApiPath(), '/api/tech');
  assert.equal(blogTechApiPath('a b'), '/api/blogs/a%20b/tech');
  assert.equal(publicKindOf(techApiPath({ q: '咖啡', technology: 'wp-plugin:elementor', status: 'not-observed', cursor: '9' })), 'tech');
  assert.equal(publicKindOf(blogTechApiPath('example.com')), 'blogTech');
  assert.equal(publicKindOf('/api/tech?secret=1'), null);
  assert.equal(publicKindOf('/api/blogs/a/tech?days=7'), null);

  for (const id of ['wordpress', 'wp-theme:astra', 'wp-plugin:elementor', 'google-analytics']) assert.ok(isTechId(id), id);
  for (const id of ['WordPress', 'wp-x:astra', ':astra', '-a', 'a b', 'a'.repeat(65)]) assert.equal(isTechId(id), false, id);
  assert.deepEqual(techQueryOf(params('technology=wp-theme%3Aastra&status=not-observed&q=%20x%20&cursor=12')), {
    query: { q: 'x', technology: 'wp-theme:astra', status: 'not-observed', cursor: '12' },
    ignored: false,
  });
  assert.deepEqual(techQueryOf(params('technology=Bad&status=gone&cursor=-1')), { query: {}, ignored: true });
  assert.deepEqual(techQueryOf(params(`q=${'a'.repeat(101)}`)), { query: {}, ignored: true });
  assert.ok(isTechBaseline(techQueryOf(params('')).query));
  assert.equal(isTechBaseline({ status: 'unknown' }), false);
});

/* Contracts (synthetic payloads) -------------------------------------------- */

const detection = {
  id: 'wp-plugin:elementor',
  name: 'Elementor',
  category: 'plugin',
  version: 'unknown',
  confidence: 0.7,
  ruleId: 'wp-plugin-asset',
  ruleVersion: 'passive-tech-v1',
  observedAt: '2026-10-12T00:00:00.000Z',
  evidence: [{ kind: 'asset', value: '/wp-content/plugins/elementor/' }],
};
const coverage = { partial: true, method: 'passive-existing-response', sourceType: 'html', htmlTruncated: false, inspectedNodes: 120 };
const observed = {
  ...notObservedBlog,
  status: 'detected',
  observedAt: '2026-10-12T00:00:00.000Z',
  lastAttemptAt: '2026-10-12T00:00:00.000Z',
  evidenceSourceUrl: 'https://a.example/',
  coverage,
  detections: [detection],
};
const blogTech = (blog: Record<string, unknown>, method: unknown = techMethod) => ({
  generatedAt: '2026-10-12T00:00:00.000Z',
  method,
  blog,
});
const counts = (patch: Record<string, unknown> = {}) => ({
  totalBlogs: 1,
  scannedBlogs: 1,
  truncated: false,
  detected: 0,
  unknown: 0,
  failed: 0,
  blocked: 0,
  notObserved: 1,
  ...patch,
});
const stats = (patch: Record<string, unknown>) => ({ ...(EMPTY.tech as object), coverage: counts(), ...patch });

test('contracts: every state projectTechScan can answer is valid, in the profile and the list', () => {
  const states: Record<string, Record<string, unknown>> = {
    detected: observed,
    unknown: { ...observed, status: 'unknown', detections: [] },
    'failed with retained detections': { ...observed, status: 'failed', lastAttemptAt: '2026-10-13T00:00:00.000Z', errorCode: 'timeout' },
    'blocked with a retained unknown': { ...observed, status: 'blocked', errorCode: 'robots', detections: [] },
    'failed without a success': { ...notObservedBlog, status: 'failed', lastAttemptAt: '2026-10-13T00:00:00.000Z' },
    'not-observed': notObservedBlog,
  };
  for (const [name, blog] of Object.entries(states)) {
    assert.equal(validPublicPayload('blogTech', blogTech(blog)), true, name);
    assert.equal(validPublicPayload('tech', stats({ items: [blog], pagination: { limit: 50, nextCursor: null, total: 1 } })), true, name);
  }
  assert.equal(validPublicPayload('tech', EMPTY.tech), true);
  // Partial scan: counts are of the scanned blogs, the total is larger and `truncated` says so.
  assert.equal(
    validPublicPayload('tech', stats({ coverage: counts({ totalBlogs: 2400, scannedBlogs: 2000, truncated: true, notObserved: 2000 }) })),
    true,
  );
});

test('contracts: denominators must agree; a count that does not add up is a failure, never shown', () => {
  for (const [name, patch] of [
    ['counts do not sum to scanned', { notObserved: 2 }],
    ['scanned above total', { totalBlogs: 1, scannedBlogs: 2, notObserved: 2 }],
    ['truncated without a gap', { truncated: true }],
    ['a gap without truncated', { totalBlogs: 5 }],
    ['a negative count', { detected: -1, notObserved: 2 }],
    ['a fractional count', { detected: 0.5, notObserved: 0.5 }],
    ['a missing count', { blocked: undefined }],
  ] as const)
    assert.equal(validPublicPayload('tech', stats({ coverage: counts(patch) })), false, name);
  const technology = { id: 'wordpress', name: 'WordPress', category: 'cms', blogs: 2, versions: [] };
  assert.equal(validPublicPayload('tech', stats({ technologies: [technology] })), false, 'more blogs than scanned');
  assert.equal(
    validPublicPayload('tech', stats({ pagination: { limit: 50, nextCursor: null, total: 2 } })),
    false,
    'more matches than scanned',
  );
  assert.equal(
    validPublicPayload('tech', stats({ items: [notObservedBlog, notObservedBlog], pagination: { limit: 1, nextCursor: null, total: 1 } })),
    false,
    'more rows than the page asked for',
  );
  assert.equal(validPublicPayload('tech', stats({ filters: { q: '', technology: '', status: 'gone' } })), false);
  for (const method of [
    { ...techMethod, additionalRequests: true },
    { ...techMethod, partial: false },
    { ...techMethod, additionalRequests: undefined },
  ])
    assert.equal(validPublicPayload('blogTech', blogTech(notObservedBlog, method)), false, JSON.stringify(method));
});

test('contracts: a malformed coverage, detection, evidence or impossible state is a failure, never a default', () => {
  const without = (value: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));
  const bad: Record<string, Record<string, unknown>> = {
    'coverage {}': { ...observed, coverage: {} },
    'coverage with an unknown sourceType': { ...observed, coverage: { ...coverage, sourceType: 'rss' } },
    'coverage not partial': { ...observed, coverage: { ...coverage, partial: false } },
    'detection without version': { ...observed, detections: [without(detection, 'version')] },
    'detection without observedAt': { ...observed, detections: [without(detection, 'observedAt')] },
    'detection with an unknown category': { ...observed, detections: [{ ...detection, category: 'other' }] },
    'evidence [{}]': { ...observed, detections: [{ ...detection, evidence: [{}] }] },
    'evidence with an unknown kind': { ...observed, detections: [{ ...detection, evidence: [{ kind: 'html', value: '<html>' }] }] },
    'blog without id': without(observed, 'id'),
    'unknown errorCode': { ...observed, status: 'failed', errorCode: 'teapot' },
    'unknown status': { ...observed, status: 'missing' },
    'detected with no detections': { ...observed, detections: [] },
    'unknown with detections': { ...observed, status: 'unknown' },
    'observedAt without coverage': { ...observed, coverage: null },
    'detections without a success': {
      ...notObservedBlog,
      status: 'failed',
      lastAttemptAt: '2026-10-13T00:00:00.000Z',
      detections: [detection],
    },
    'not-observed with an attempt': { ...notObservedBlog, lastAttemptAt: '2026-10-13T00:00:00.000Z' },
    'failed without an attempt': { ...observed, status: 'failed', lastAttemptAt: null },
  };
  for (const [name, blog] of Object.entries(bad)) {
    assert.equal(validPublicPayload('blogTech', blogTech(blog)), false, name);
    assert.equal(validPublicPayload('tech', stats({ items: [blog], pagination: { limit: 50, nextCursor: null, total: 1 } })), false, name);
  }
});

/* Optional profile section --------------------------------------------------- */

test('profile read: 5xx, network and a wrong shape are PublicGatewayError; only 404 is "not there"', async () => {
  const path = blogTechApiPath('a');
  type Fetch = (url: string, init: RequestInit) => Promise<Response>;
  const answer =
    (status: number, body: unknown): Fetch =>
    async () =>
      new Response(JSON.stringify(body), { status });
  const noWait = async () => {};
  const failures: Array<[string, Fetch]> = [
    ['500', answer(500, { error: 'x' })],
    ['coverage {}', answer(200, blogTech({ ...observed, coverage: {} }))],
    ['network', () => Promise.reject(new TypeError('fetch failed'))],
  ];
  for (const [name, fetcher] of failures)
    await assert.rejects(readPublic('http://gateway.test', path, fetcher, noWait), PublicGatewayError, name);
  assert.deepEqual(await readPublic('http://gateway.test', path, answer(404, { error: 'not_found' }), noWait), { found: false });
});
