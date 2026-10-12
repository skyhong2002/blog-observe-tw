import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { projectPublicTraffic, registerSimilarwebTraffic } from './similarweb-routes.ts';

const secret = 'do-not-publish-service-secret';
function row(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'writer',
    name: '作者部落格',
    url: 'https://writer.com/blog/',
    canonicalHost: 'writer.com',
    status: 'verified',
    lastErrorCode: null,
    result: {
      domain: 'writer.com',
      source: 'similarweb-extension',
      fetchedAt: '2026-10-12T00:00:00.000Z',
      requests: [
        { kind: 'similar_sites', status: 'ok', requestedAt: '2026-10-01T00:00:00Z', attempts: 1, nextAttemptAt: null, token: secret },
      ],
      similarSites: ['private-candidate.com'],
      headers: { authorization: secret },
      token: secret,
      traffic: {
        monthly: [{ month: '202609', visits: 1234, token: secret }],
        globalRank: 123,
        countryRank: { code: 'TW', rank: 45, token: secret },
        category: 'blogs',
        topCountries: [{ code: 'TW', share: 0.7, headers: { cookie: secret } }],
        password: secret,
      },
    },
    ...overrides,
  };
}
describe('public Similarweb traffic projection', () => {
  it('preserves exact units but publishes only traffic fields for approved domain-matched blogs', () => {
    const data = projectPublicTraffic([row()]);
    expect(data).toEqual([
      {
        slug: 'writer',
        name: '作者部落格',
        domain: 'writer.com',
        status: 'ready',
        fetchedAt: '2026-10-12T00:00:00.000Z',
        traffic: {
          monthly: [{ month: '202609', visits: 1234 }],
          globalRank: 123,
          countryRank: { code: 'TW', rank: 45 },
          category: 'blogs',
          topCountries: [{ code: 'TW', share: 0.7 }],
        },
      },
    ]);
    const serialized = JSON.stringify(data);
    for (const omitted of [secret, 'requests', 'similarSites', 'authorization', 'private-candidate.com', 'password'])
      expect(serialized).not.toContain(omitted);
  });
  it('excludes unapproved, mismatched, moved and shared-platform domain totals', () => {
    const data = projectPublicTraffic([
      row({ status: 'candidate' }),
      row({ status: 'moved' }),
      row({ canonicalHost: 'someone-else.com' }),
      row({ url: 'https://medium.com/@writer', canonicalHost: 'medium.com' }),
      row({ url: 'https://pixnet.net/blog', canonicalHost: 'pixnet.net' }),
    ]);
    expect(data).toEqual([]);
  });
  it('never assigns one shared domain total to two distinct approved blogs', () => {
    expect(projectPublicTraffic([row(), row({ slug: 'other-author', url: 'https://writer.com/other/' })])).toEqual([]);
  });
  it('separates awaiting, no-data and blocked outcomes without filling absent traffic with zero', () => {
    expect(projectPublicTraffic([row({ result: null })])[0]).toMatchObject({ status: 'pending', traffic: null, fetchedAt: null });
    expect(projectPublicTraffic([row({ result: null, lastErrorCode: 'blocked' })])[0]).toMatchObject({ status: 'blocked', traffic: null });
    const candidate = row({
      result: {
        ...row().result,
        traffic: null,
        requests: [
          {
            kind: 'similar_sites',
            status: 'no-data',
            requestedAt: '2026-10-01T00:00:00Z',
            attempts: 1,
            nextAttemptAt: null,
            token: secret,
          },
        ],
      },
    });
    expect(projectPublicTraffic([candidate])[0]).toMatchObject({ status: 'no-data', traffic: null });
  });
  it('labels retained data as pending while a request is waiting', () => {
    const candidate = row();
    candidate.result.requests[0].status = 'pending';
    expect(projectPublicTraffic([candidate])[0]).toMatchObject({
      status: 'pending',
      traffic: { monthly: [{ month: '202609', visits: 1234 }] },
    });
  });
  it('does not leak malformed evidence or database details from the route', async () => {
    const app = Fastify();
    const query = vi.fn().mockRejectedValue(new Error(secret));
    registerSimilarwebTraffic(app, { query } as unknown as Pick<Pool, 'query'>);
    const response = await app.inject('/api/traffic');
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'traffic unavailable' });
    expect(response.body).not.toContain(secret);
    await app.close();
  });
  it('serves a read-only filtered projection and explicit source/scope/limitations', async () => {
    const app = Fastify();
    const query = vi.fn().mockResolvedValue([[row()], []]);
    registerSimilarwebTraffic(app, { query } as unknown as Pick<Pool, 'query'>);
    const response = await app.inject('/api/traffic?blog=writer');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      source: 'similarweb-extension',
      scope: 'domain',
      blogs: [{ slug: 'writer', status: 'ready' }],
    });
    expect(response.body).not.toContain(secret);
    expect(query.mock.calls[0][0]).toContain("WHERE b.status='verified'");
    const absent = await app.inject('/api/traffic?blog=private-candidate');
    expect(absent.json().blogs).toEqual([]);
    const invalid = await app.inject(`/api/traffic?blog=${'x'.repeat(256)}`);
    expect(invalid.statusCode).toBe(400);
    expect(query).toHaveBeenCalledTimes(2);
    await app.close();
  });
});
