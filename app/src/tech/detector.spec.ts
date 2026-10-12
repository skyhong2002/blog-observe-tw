import { describe, expect, it } from 'vitest';
import { TECH_LIMITS } from './contracts.ts';
import { detectTechnology, safeTechSourceUrl, validTechObservation } from './detector.ts';

const at = new Date('2026-01-02T03:04:05.006Z');
const detect = (html: string, extra = {}) => detectTechnology({ url: 'https://blog.example/', html, observedAt: at, ...extra });
describe('passive technology detection', () => {
  it.each(['WordPress', 'Blogger', 'Hugo', 'Jekyll', 'Ghost', 'Hexo', 'Next.js', 'Nuxt'])(
    'recognizes explicit %s generator without guessing a version',
    (name) => {
      const result = detect(`<meta name="generator" content="${name}">`);
      expect(result.status).toBe('detected');
      expect(result.detections[0].version).toBe('unknown');
      expect(validTechObservation(result)).toBe(true);
    },
  );
  it('uses a synthetic WordPress 7.1.3 fixture on any host, not a real timdream capture', () => {
    const result = detect('<meta name="generator" content="WordPress 7.1.3">', { url: 'https://timdream.org/' });
    expect(result.detections[0]).toMatchObject({ id: 'wordpress', version: '7.1.3', confidence: 0.95, observedAt: at.toISOString() });
    expect(detect('', { url: 'https://timdream.org/' }).status).toBe('unknown');
    expect(detect('<meta name="generator" content="WordPress 7.1.3">', { url: 'https://unrelated.example/' }).detections).toEqual(
      result.detections,
    );
  });
  it.each([
    ['<meta name="generator" content="WordPress"><meta name="generator" content="WordPress 6.8">', '6.8'],
    ['<meta name="generator" content="WordPress 6.8"><meta name="generator" content="WordPress">', '6.8'],
    [
      '<meta name="generator" content="WordPress 6.8"><meta name="generator" content="WordPress 6.9"><meta name="generator" content="WordPress 6.8">',
      'unknown',
    ],
  ])('consolidates declarations without guessing among conflicting versions', (html, version) => {
    const result = detect(html);
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0].version).toBe(version);
    expect(result.detections[0].evidence).toEqual([{ kind: 'generator', value: `WordPress${version === 'unknown' ? '' : ` ${version}`}` }]);
    expect(validTechObservation(result)).toBe(true);
  });
  it('retains explicit version evidence when preceding hints exhaust the evidence budget', () => {
    const result = detect(
      '<script id="__NEXT_DATA__"></script><script src="/_next/static/app.js"></script><meta name="generator" content="Next.js"><meta name="generator" content="Next.js 16.0">',
    );
    expect(result.detections[0].version).toBe('16.0');
    expect(result.detections[0].evidence.length).toBeLessThanOrEqual(TECH_LIMITS.evidencePerDetection);
    expect(result.detections[0].evidence).toContainEqual({ kind: 'generator', value: 'Next.js 16.0' });
    expect(validTechObservation(result)).toBe(true);
  });
  it('rejects duplicate product records at the persistence boundary', () => {
    const result = detect('<meta name="generator" content="WordPress">');
    result.detections.push({ ...result.detections[0] });
    expect(validTechObservation(result)).toBe(false);
  });
  it('identifies WordPress themes/plugins but never invents versions from query strings', () => {
    const result = detect(
      '<link href="/wp-content/themes/astra/style.css?ver=7.1.3&email=secret@example.com"><script src="/wp-content/plugins/elementor/a.js?token=secret"></script><script src="/wp-content/plugins/customer-private-slug/a.js"></script>',
    );
    expect(result.detections.map((d) => d.id)).toEqual(['wordpress', 'wp-plugin:elementor', 'wp-theme:astra']);
    expect(result.detections.every((d) => d.version === 'unknown')).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/secret|customer-private|7\.1\.3/);
    expect(validTechObservation(result)).toBe(true);
  });
  it('does not infer technologies from article prose, comments, usernames, or arbitrary asset hosts', () => {
    const result = detect(
      '<p>WordPress Next.js GA Hugo</p><!-- <meta name="generator" content="WordPress 9.9"> --><script src="https://evil.example/gtag/js?id=G-SECRET"></script>',
    );
    expect(result.status).toBe('unknown');
  });
  it('detects multiple frameworks and Google tools while removing account identifiers', () => {
    const result = detect(
      '<script id="__NEXT_DATA__">{"email":"user@example.com"}</script><script src="/_nuxt/a.js"></script><script src="https://www.googletagmanager.com/gtag/js?id=G-SECRET"></script><script>gtag("config","G-PRIVATE");</script><script src="https://www.googletagmanager.com/gtm.js?id=GTM-PRIVATE"></script>',
    );
    expect(result.detections.map((d) => d.id)).toEqual(['ga', 'gtm', 'next', 'nuxt']);
    expect(JSON.stringify(result)).not.toMatch(/SECRET|PRIVATE|user@example|id=/);
    expect(validTechObservation(result)).toBe(true);
  });
  it.each([
    { httpStatus: 403 },
    { httpStatus: 429 },
    { blockedReason: 'robots' },
    { html: '<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/abc"></script>' },
    { headers: { 'cf-mitigated': 'challenge' } },
  ])('blocks challenge/error evidence before CMS or hosting detection: %j', (extra) => {
    const result = detect('<meta name="generator" content="WordPress"><script src="/_next/static/a.js"></script>', {
      headers: { server: 'cloudflare' },
      ...extra,
    });
    expect(result.status).toBe('blocked');
    expect(result.observedAt).toBeNull();
    expect(result.detections).toEqual([]);
    expect(validTechObservation(result)).toBe(true);
  });
  it('uses low-confidence infrastructure hints without retaining header values/versions', () => {
    const result = detect('', {
      headers: {
        server: 'cloudflare',
        'x-vercel-id': 'private-region-request-id',
        'x-nf-request-id': 'secret',
        'set-cookie': 'private-cookie',
        authorization: 'Bearer secret',
      },
    });
    expect(result.detections.every((d) => d.confidence <= 0.4 && d.version === 'unknown')).toBe(true);
    expect(result.detections).toHaveLength(3);
    expect(JSON.stringify(result)).not.toMatch(/private|secret|cookie|Bearer/);
    expect(detect('', { headers: { server: 'nginx/9.8.7' } }).detections).toEqual([]);
  });
  it('distinguishes successfully inspected unknown from failed response, and reports partial coverage', () => {
    expect(detect('<h1>hello</h1>')).toMatchObject({ status: 'unknown', observedAt: at.toISOString(), coverage: { partial: true } });
    expect(detect('', { failureReason: 'timeout' })).toMatchObject({ status: 'failed', errorCode: 'timeout', observedAt: null });
    expect(detectTechnology({ url: 'https://blog.example/' }).status).toBe('failed');
    expect(detect('x'.repeat(TECH_LIMITS.htmlBytes + 1)).coverage.htmlTruncated).toBe(true);
  });
  it('redacts query, fragment, email and credential-like path segments', () => {
    const result = safeTechSourceUrl('https://blog.example/reset/privatevalue/hello/user%40example.com?api_key=secret#G-PRIVATE');
    expect(result).toBe('https://blog.example/redacted/redacted/hello/redacted');
    expect(safeTechSourceUrl('https://user:password@blog.example/')).toBeNull();
    expect(safeTechSourceUrl('javascript:alert(1)')).toBeNull();
  });
  it('rejects forged evidence, arbitrary fields that could smuggle values, and version claims lacking generator evidence', () => {
    const result = detect('<script src="/wp-includes/jquery.js?ver=99.99"></script>');
    result.detections[0].version = '99.99';
    expect(validTechObservation(result)).toBe(false);
    result.detections[0].version = 'unknown';
    result.detections[0].evidence[0].value = 'arbitrary-private-value';
    expect(validTechObservation(result)).toBe(false);
  });
});
