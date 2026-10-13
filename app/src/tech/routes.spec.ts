import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { detectTechnology } from './detector.ts';
import { projectTechScan, publicTechBlogUrl, registerTechRoutes, techFilters } from './routes.ts';

function row() {
  const o = detectTechnology({ url: 'https://example.com/', html: '<meta name="generator" content="WordPress 6.8">' });
  return {
    status: o.status,
    detections: o.detections,
    coverage: o.coverage,
    source_url: o.sourceUrl,
    source_type: o.sourceType,
    observed_at: o.observedAt,
    last_attempt_at: o.lastAttemptAt,
    rule_version: o.ruleVersion,
    last_error_code: null,
  };
}
describe('technology read projection', () => {
  it('keeps valid successful evidence separate from a later failure and excludes extra properties', () => {
    const value = row();
    value.detections[0] = Object.assign(value.detections[0], { rawHeaders: { authorization: 'secret' } });
    const result = projectTechScan({ ...value, status: 'failed', last_error_code: 'timeout', last_attempt_at: new Date().toISOString() });
    expect(result.status).toBe('failed');
    expect(result.detections[0].id).toBe('wordpress');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.observedAt).toBe(value.observed_at);
  });
  it('masks untrusted evidence, malformed JSON and missing provenance join results', () => {
    const value = row();
    value.detections[0].evidence[0].value = 'https://example.com/?token=secret';
    expect(projectTechScan(value).status).toBe('not-observed');
    expect(projectTechScan({ ...row(), detections: '{' }).status).toBe('not-observed');
    expect(projectTechScan({ status: null }).detections).toEqual([]);
    expect(projectTechScan({ ...row(), status: 'unknown' }).status).toBe('not-observed');
    expect(projectTechScan({ ...row(), detections: [] }).status).toBe('not-observed');
  });
  it('bounds and validates query parameters without SQL or regular expression interpolation', () => {
    expect(techFilters({ limit: '100', q: "' OR 1=1", cursor: '123' })).toMatchObject({ limit: 100, cursor: 123 });
    for (const technology of ['wordpress', 'wp-theme:astra', 'wp-plugin:elementor'])
      expect(techFilters({ technology })?.technology).toBe(technology);
    for (const bad of [
      { technology: 'arbitrary:plugin' },
      { technology: 'wp-plugin:x/y' },
      { technology: 'wp-theme:x:token' },
      { limit: '101' },
      { cursor: 'NaN' },
      { q: 'x'.repeat(101) },
      { status: 'seed' },
      { technology: 'a/b' },
      { q: ['a', 'b'] },
    ])
      expect(techFilters(bad)).toBeNull();
  });
  it('projects only safe source URLs without credentials, query or fragment', () => {
    expect(publicTechBlogUrl('https://user:credential@example.com/')).toBeNull();
    expect(publicTechBlogUrl('javascript:alert(1)')).toBeNull();
    expect(publicTechBlogUrl('https://example.com/?token=credential#secret')).toBe('https://example.com/');
    expect(publicTechBlogUrl('https://medium.com/@author')).toBe('https://medium.com/@author');
    expect(publicTechBlogUrl(null)).toBeNull();
  });
  it('returns no-store 404 for GET and HEAD while disabled without accessing the DB', async () => {
    const app = Fastify();
    const query = vi.fn();
    registerTechRoutes(app, { query } as unknown as Pool, { enabled: false });
    try {
      for (const url of ['/api/tech', '/api/blogs/example/tech'])
        for (const method of ['GET', 'HEAD'] as const) {
          const response = await app.inject({ url, method });
          expect(response.statusCode).toBe(404);
          expect(response.headers['cache-control']).toContain('no-store');
        }
      expect(query).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
