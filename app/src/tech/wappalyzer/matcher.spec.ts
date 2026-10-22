import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { matchInputOf } from './input.ts';
import { compileTech, MATCH_BUDGET_MS, type MatchInput, matchTech, parsePattern } from './matcher.ts';

const page = (html: string, headers: Record<string, string> = {}, url = 'https://blog.example/'): MatchInput =>
  matchInputOf(url, html, headers).input;

describe('Wappalyzer pattern syntax', () => {
  it('reads the confidence and version of a pattern, and an empty pattern as "exists"', () => {
    expect(parsePattern('^Hugo ([\\d.]+)?\\;version:\\1')).toMatchObject({ version: '\\1', confidence: 100 });
    expect(parsePattern('text\\;confidence:40')).toMatchObject({ confidence: 40 });
    expect(parsePattern('')).toEqual({ regex: null, version: '', confidence: 100 });
  });
  it('drops what cannot be run safely: bad regular expressions, oversized patterns, non-text, out-of-range confidence', () => {
    expect(parsePattern('(unclosed')).toBeNull();
    expect(parsePattern('a'.repeat(601))).toBeNull();
    expect(parsePattern(42)).toBeNull();
    expect(parsePattern('x\\;confidence:900')).toMatchObject({ confidence: 100 });
  });
});

describe('Wappalyzer rule matching', () => {
  const tech = compileTech('Example CMS', {
    meta: { generator: 'Example CMS ?([\\d.]+)?\\;version:\\1' },
    scriptSrc: ['/example-cms/js/'],
    headers: { 'X-Example': '' },
    html: ['<!-- built with example cms -->\\;confidence:50'],
    dom: { "a[href*='example-cms.']": { attributes: { href: 'example-cms\\.org\\;confidence:0' }, text: 'Example CMS\\;confidence:99' } },
    js: { exampleGlobal: '' },
    cookies: { example_session: '' },
    implies: ['PHP'],
  });
  it('captures a version only from a meta generator', () => {
    const result = matchTech(tech, page('<meta name="generator" content="Example CMS 4.2">'));
    expect(result).toMatchObject({ confidence: 100, generator: true, generatorVersions: ['4.2'], matched: ['meta'] });
    expect(matchTech(tech, page('<meta name="generator" content="Example CMS">'))?.generatorVersions).toEqual([]);
  });
  it('adds the confidence of every matched rule and caps it at 100', () => {
    const result = matchTech(
      tech,
      page('<!-- built with example cms --><script src="/example-cms/js/app.js"></script>', { 'x-example': '1' }),
    );
    expect(result?.confidence).toBe(100);
    expect(result?.matched.sort()).toEqual(['headers', 'html', 'scriptSrc']);
    expect(matchTech(tech, page('<!-- built with example cms -->'))?.confidence).toBe(50);
  });
  it('ignores what needs a browser, cookies or the text of a page, so mentioning the product proves nothing', () => {
    expect(matchTech(tech, page('<p>I wrote this with <a href="https://example-cms.org/">Example CMS</a>.</p>'))).toBeNull();
    expect(matchTech(tech, page('<p>nothing</p>'))).toBeNull();
  });
  it('reads script addresses against the page, and header names case-insensitively', () => {
    expect(matchTech(tech, page('<script src="/example-cms/js/a.js"></script>'))?.matched).toEqual(['scriptSrc']);
    expect(matchTech(tech, page('', { 'X-EXAMPLE': 'yes' }))?.matched).toEqual(['headers']);
  });
  it('treats an unsupported selector as no match instead of throwing', () => {
    const odd = compileTech('Odd', { dom: ['div[[[invalid', "meta[name='x']"] });
    expect(matchTech(odd, page('<meta name="x" content="1">'))?.matched).toEqual(['dom']);
    expect(matchTech(odd, { ...page(''), dom: cheerio.load('') })).toBeNull();
  });
});

describe('bounded matching on untrusted pages', () => {
  const quadratic = compileTech('Slow', { html: ['<link rel=["\']stylesheet["\'] [^>]+/wp-(?:content|includes)/'] });
  it('finds a match anywhere in a long page, but only where an anchor can hold', () => {
    const padding = '<p>text</p>'.repeat(5000);
    const link = '<link rel="stylesheet" href="/wp-content/a.css">';
    expect(matchTech(quadratic, page(padding + link + padding))?.matched).toEqual(['html']);
    const start = compileTech('Start', { html: ['^<!doctype html>'] });
    expect(matchTech(start, page(`<!doctype html>${padding}`))).not.toBeNull();
    expect(matchTech(start, page(`${padding}<!doctype html>${padding}`))).toBeNull();
    const end = compileTech('End', { html: ['</html>$'] });
    expect(matchTech(end, page(`${padding}</html>`))).not.toBeNull();
    expect(matchTech(end, page(`${padding}</html>${padding}`))).toBeNull();
  });
  it('stops at the page budget instead of backtracking for seconds', () => {
    const hostile = '<link rel="stylesheet" '.repeat(22_000);
    const started = performance.now();
    expect(matchTech(quadratic, page(hostile))).toBeNull();
    expect(performance.now() - started).toBeLessThan(MATCH_BUDGET_MS * 4);
  });
  it('runs no rule once the budget is spent', () => {
    expect(
      matchTech(compileTech('Any', { meta: { generator: '' } }), { ...page('<meta name="generator" content="x">'), deadline: -1 }),
    ).toBeNull();
  });
});
