import { afterEach, describe, expect, it } from 'vitest';
import { TECH_RULE_VERSION } from '../contracts.ts';
import { detectTechnology, validTechObservation } from '../detector.ts';
import { documentPlatform } from '../platform.ts';
import { compileVocabulary, setWappalyzerRulesForTest } from './rules.ts';

// Rules in the Wappalyzer format, written for these tests.
const fixture = compileVocabulary(
  {
    WordPress: {
      meta: { generator: '^WordPress(?: ([\\d.]+))?\\;version:\\1' },
      dom: ["link[rel=stylesheet][href*='/wp-content/']"],
      scriptSrc: ['/wp-(?:content|includes)/'],
    },
    Hugo: { meta: { generator: 'Hugo ([\\d.]+)?\\;version:\\1' } },
    Ghost: { meta: { generator: 'Ghost(?: ([\\d.]+))?\\;version:\\1' }, headers: { 'X-Ghost-Cache-Status': '' } },
    Cloudflare: { headers: { 'cf-ray': '' } },
    Netlify: { url: ['^https?://[^/]+\\.netlify\\.app/'] },
  },
  'b'.repeat(40),
);
const at = new Date('2026-01-02T03:04:05.006Z');
const detect = (html: string, extra = {}) => detectTechnology({ url: 'https://blog.example/', html, observedAt: at, ...extra });
afterEach(() => setWappalyzerRulesForTest(null));

describe('detection by Wappalyzer rules', () => {
  it('stamps the pinned rule version and rule ids, and passes the persistence check', () => {
    setWappalyzerRulesForTest(fixture);
    const result = detect('<meta name="generator" content="Hugo 0.161.1">');
    expect(result.ruleVersion).toBe('wappalyzer-bbbbbbbbbbbb');
    expect(result.detections).toEqual([
      expect.objectContaining({
        id: 'hugo',
        version: '0.161.1',
        confidence: 1,
        ruleId: 'wappalyzer:hugo',
        ruleVersion: 'wappalyzer-bbbbbbbbbbbb',
        evidence: [{ kind: 'generator', value: 'Hugo 0.161.1' }],
      }),
    ]);
    expect(validTechObservation(result)).toBe(true);
  });
  it('does not call a Hugo site WordPress because a post shows an image or markup from a WordPress site', () => {
    setWappalyzerRulesForTest(fixture);
    const html = `<meta name="generator" content="Hugo 0.161.1"><article>
      <img src="https://game.example/wp-content/uploads/2018/12/shot.png">
      <a href="https://game.example/wp-content/">a WordPress site</a></article>`;
    expect(detect(html).detections.map((d) => d.id)).toEqual(['hugo']);
  });
  it('detects WordPress from its own head assets and keeps the version unknown without an explicit declaration', () => {
    setWappalyzerRulesForTest(fixture);
    const result = detect('<link rel="stylesheet" href="/wp-content/themes/x/style.css"><script src="/wp-includes/js/jquery.js"></script>');
    expect(result.detections).toEqual([
      expect.objectContaining({
        id: 'wordpress',
        version: 'unknown',
        evidence: [
          { kind: 'asset', value: 'script URL rule' },
          { kind: 'marker', value: 'page markup rule' },
        ],
      }),
    ]);
    expect(validTechObservation(result)).toBe(true);
  });
  it('returns unknown for conflicting generator versions and still proves the product', () => {
    setWappalyzerRulesForTest(fixture);
    const result = detect('<meta name="generator" content="Ghost 5.1"><meta name="generator" content="Ghost 6.2">');
    expect(result.detections[0]).toMatchObject({ id: 'ghost', version: 'unknown', evidence: [{ kind: 'generator', value: 'Ghost' }] });
    expect(validTechObservation(result)).toBe(true);
  });
  it('keeps CDN and hosting signals low confidence, from response headers or the address', () => {
    setWappalyzerRulesForTest(fixture);
    const result = detect('', { headers: { 'CF-Ray': 'abc-HKG' } });
    expect(result.detections).toEqual([expect.objectContaining({ id: 'cloudflare', confidence: 0.4 })]);
    expect(validTechObservation(result)).toBe(true);
    expect(detect('', { url: 'https://me.netlify.app/' }).detections[0]).toMatchObject({ id: 'netlify', confidence: 0.4 });
  });
  it('rejects rule-mode evidence that is not one of the fixed phrases', () => {
    setWappalyzerRulesForTest(fixture);
    const result = detect('<meta name="generator" content="Hugo 0.161.1"><script src="/x"></script>', { headers: { 'cf-ray': '1' } });
    expect(validTechObservation(result)).toBe(true);
    const forged = structuredClone(result);
    forged.detections[0].evidence = [{ kind: 'marker', value: 'https://tracking.example/?id=1' }];
    expect(validTechObservation(forged)).toBe(false);
    const wrongVersion = structuredClone(result);
    wrongVersion.ruleVersion = 'wappalyzer-nothex';
    expect(validTechObservation(wrongVersion)).toBe(false);
  });
  it('leaves a stored post body to the built-in detection, and works without the rules installed', () => {
    setWappalyzerRulesForTest(fixture);
    const body = detect('<meta name="generator" content="Hugo 0.161.1">', { sourceType: 'body-fragment' });
    expect(body.ruleVersion).toBe(TECH_RULE_VERSION);
    expect(body.detections[0].ruleId).toBe('passive:hugo');
    setWappalyzerRulesForTest(null);
    const builtIn = detect('<meta name="generator" content="Hugo 0.161.1">');
    expect(builtIn.ruleVersion).toBe(TECH_RULE_VERSION);
    expect(validTechObservation(builtIn)).toBe(true);
  });
});

describe('platform of a page', () => {
  const home = 'https://blog.example/';
  it.each([
    ['with the rules', fixture],
    ['without the rules', null],
  ])('names the platform from the page itself %s', (_label, rules) => {
    setWappalyzerRulesForTest(rules);
    expect(documentPlatform(home, '<meta name="generator" content="Hugo 0.161.1">')).toBe('hugo');
    expect(documentPlatform(home, '<link rel="stylesheet" href="/wp-content/themes/x/s.css">')).toBe('wordpress');
    expect(documentPlatform(home, '<article><img src="https://game.example/wp-content/uploads/a.png"></article>')).toBeNull();
    expect(documentPlatform(home, '<p>plain page</p>')).toBeNull();
  });
  it('lets an explicit generator beat a weaker hint, and gives up when two platforms tie', () => {
    setWappalyzerRulesForTest(fixture);
    expect(documentPlatform(home, '<meta name="generator" content="Hugo 0.161.1"><script src="/wp-content/plugins/x/a.js"></script>')).toBe(
      'hugo',
    );
    expect(documentPlatform(home, '<meta name="generator" content="Hugo 0.1"><meta name="generator" content="Ghost 5.0">')).toBeNull();
  });
});
