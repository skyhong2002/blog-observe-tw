import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { schemaErrors } from '../../../tools/check-openapi.ts';
import { generateApiDocs, renderApiMarkdown, renderOpenApiJson } from '../../../tools/gen-api-docs.ts';
import { PUBLIC_PATHS } from '../public-api/contract.ts';
import { API_INTRO, buildOpenApi, ENDPOINTS } from './openapi.ts';

describe('single-source public API contract', () => {
  it('documents exactly the public route contract including GET and HEAD', () => {
    const spec = buildOpenApi();
    const expected = PUBLIC_PATHS.map((path) => path.replace(/:(\w+)/g, '{$1}')).sort();
    expect(Object.keys(spec.paths).sort()).toEqual(expected);
    for (const path of Object.values(spec.paths)) {
      expect(path.get.responses['200'].content['application/json'].schema).toBeDefined();
      expect(path.head.responses['200']).not.toHaveProperty('content');
      expect(path.get.security).toEqual([{}, { personalApiKey: [] }]);
      expect(path.get.responses).toHaveProperty('429');
    }
  });
  it('keeps generated markdown and frontend JSON synchronized with the specification', () => {
    expect(() => generateApiDocs(true)).not.toThrow();
    expect(readFileSync(new URL('../../../docs/api.md', import.meta.url), 'utf8')).toBe(renderApiMarkdown());
    expect(readFileSync(new URL('../../../data/openapi.json', import.meta.url), 'utf8')).toBe(renderOpenApiJson());
  });
  it('rejects response drift for required fields, nullability and excerpt limits', () => {
    const schema = {
      type: 'object',
      required: ['at', 'summary'],
      properties: { at: { type: ['string', 'null'], format: 'date-time' }, summary: { type: 'string', maxLength: 500 } },
    };
    expect(schemaErrors({ at: null, summary: 'hello' }, schema)).toEqual([]);
    expect(schemaErrors({ at: '2026-10-12T00:00:00.000Z', summary: 'hello' }, schema)).toEqual([]);
    expect(schemaErrors({ at: '2026-10-12', summary: 'x'.repeat(501) }, schema)).toHaveLength(2);
    expect(schemaErrors({}, schema)).toHaveLength(2);
  });
  it('resolves every schema reference and has unique operation IDs', () => {
    const spec = buildOpenApi();
    const refs = [...JSON.stringify(spec).matchAll(/"\$ref":"#\/components\/schemas\/([^"/]+)"/g)];
    for (const [, name] of refs) expect(spec.components.schemas).toHaveProperty(name);
    const ids = Object.values(spec.paths).flatMap((path) => [path.get.operationId, path.head.operationId]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ENDPOINTS.every((endpoint) => endpoint.summary && endpoint.tag)).toBe(true);
  });
  it('exposes only public read operations, short excerpts, and optional header keys', () => {
    const spec = buildOpenApi();
    expect(Object.values(spec.paths).every((path) => Object.keys(path).every((method) => ['get', 'head'].includes(method)))).toBe(true);
    expect(Object.keys(spec.paths).some((path) => /\/admin|\/me|\/auth/.test(path))).toBe(false);
    const article = spec.components.schemas.Article.properties as Record<string, unknown>;
    expect(article).not.toHaveProperty('body');
    expect(article).not.toHaveProperty('content');
    expect(article.summary).toMatchObject({ maxLength: 500 });
    expect(spec.components.securitySchemes.personalApiKey).toMatchObject({ in: 'header', name: 'x-api-key' });
    expect(API_INTRO.quickstart.filter((example) => example.lang === 'sh').length).toBeGreaterThanOrEqual(3);
    expect(API_INTRO.quickstart.some((example) => example.lang === 'js' && example.code.includes('nextCursor'))).toBe(true);
  });
});
