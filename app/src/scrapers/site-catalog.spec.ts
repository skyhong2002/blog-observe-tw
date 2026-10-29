import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkedSiteDefinition } from './site-catalog.ts';

const now = Date.parse('2026-10-29T08:00:00Z');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
function fixture() {
  const definition = {
    version: 1,
    blogId: 42,
    home: 'https://catalog.example/writer/',
    authoredBy: 'gpt-6.1-sol',
    scraper: {
      listUrls: ['https://catalog.example/writer/feed.xml'],
      maxPages: 1,
      code: 'function listPosts({url,$}) { return {posts:[],next:null}; }\nfunction parsePost({url,$}) { return {title:$("h1").text(),bodyHtml:$("article").html()}; }',
      render: true,
      noArticles: false,
      needsRender: false,
      notes: 'Operator checked article pages',
    },
  };
  const validation = {
    blogId: definition.blogId,
    home: definition.home,
    codeSha256: sha(definition.scraper.code),
    definitionSha256: sha(JSON.stringify(definition)),
    checkedAt: new Date(now).toISOString(),
    passed: true,
    report: {
      policy: 'generated-scraper-v1',
      listUrl: definition.scraper.listUrls[0],
      listed: 1,
      nextPage: null,
      samples: [{ url: `${definition.home}post`, title: 'Actual article', publishedAt: null, author: null, tags: 0, bodyChars: 12 }],
      problems: [] as { stage: string; url: string | null; reason: string }[],
    },
  };
  return { definition, validation };
}

describe('checkedSiteDefinition', () => {
  it('accepts fresh evidence bound to the exact definition and preserves rendering', () => {
    const { definition, validation } = fixture();
    expect(checkedSiteDefinition(definition, validation, now)).toEqual({ definition, validation });
  });

  it.each(['notes', 'code', 'home', 'blogId'] as const)('rejects replacement of definition %s after validation', (field) => {
    const { definition, validation } = fixture();
    if (field === 'notes') definition.scraper.notes = 'changed definition';
    if (field === 'code') definition.scraper.code += '\n// changed parser';
    if (field === 'home') definition.home = 'https://catalog.example/another-writer/';
    if (field === 'blogId') definition.blogId++;
    expect(() => checkedSiteDefinition(definition, validation, now)).toThrow('fresh_matching_validation_required');
  });

  it.each(['codeSha256', 'definitionSha256', 'home', 'blogId'] as const)('rejects replacement of report %s', (field) => {
    const { definition, validation } = fixture();
    if (field === 'blogId') validation.blogId++;
    else validation[field] = field === 'home' ? 'https://foreign.example/' : '0'.repeat(64);
    expect(() => checkedSiteDefinition(definition, validation, now)).toThrow('fresh_matching_validation_required');
  });

  it.each([
    { checkedAt: new Date(now - 86400001).toISOString() },
    { checkedAt: new Date(now + 86400001).toISOString() },
    { checkedAt: 'invalid-date' },
    { passed: false },
  ])('rejects stale, future, malformed, or failed validation: %j', (change) => {
    const { definition, validation } = fixture();
    expect(() => checkedSiteDefinition(definition, { ...validation, ...change }, now)).toThrow('fresh_matching_validation_required');
  });

  it.each(['empty', 'insufficient', 'failed', 'unlisted', 'malformed'] as const)('rejects %s article evidence', (kind) => {
    const { definition, validation } = fixture();
    if (kind === 'empty') validation.report.samples = [];
    if (kind === 'insufficient') validation.report.listed = 3;
    if (kind === 'unlisted') validation.report.listed = 0;
    if (kind === 'failed') validation.report.problems.push({ stage: 'post', url: null, reason: 'post_missing_title_or_body' });
    const report = kind === 'malformed' ? { listed: 1, samples: null, problems: [] } : validation.report;
    expect(() => checkedSiteDefinition(definition, { ...validation, report }, now)).toThrow('passing_validation_required');
  });

  it.each([
    { listUrls: [] },
    { noArticles: true },
    { code: '' },
    { code: 'function listPosts() { return fetch("https://foreign.example"); } function parsePost() {}' },
  ])('rejects unusable definitions before trusting any report: %j', (change) => {
    const { definition, validation } = fixture();
    Object.assign(definition.scraper, change);
    validation.definitionSha256 = sha(JSON.stringify(definition));
    validation.codeSha256 = sha(definition.scraper.code);
    expect(() => checkedSiteDefinition(definition, validation, now)).toThrow('unusable_site_definition');
  });

  it.each([{ version: 2 }, { blogId: 0 }, { blogId: 1.5 }, { authoredBy: 'untrusted-author' }, { home: 'http://127.0.0.1/private' }])(
    'rejects invalid identity or provenance: %j',
    (change) => {
      const { definition, validation } = fixture();
      expect(() => checkedSiteDefinition({ ...definition, ...change }, validation, now)).toThrow('invalid_site_definition');
    },
  );
});
