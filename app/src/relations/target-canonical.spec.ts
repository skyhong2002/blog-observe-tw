import { describe, expect, it } from 'vitest';
import { resolveTargetCanonical } from './target-canonical.ts';

const now = new Date('2026-10-13T00:00:00.000Z');
const source = {
  articleId: 10,
  blogId: 5,
  url: 'https://source.test/post',
  publishedAt: '2017-01-01T00:00:00.000Z',
  status: 'public',
  ownerVerified: true,
};
const post = {
  articleId: 20,
  blogId: 6,
  url: 'https://target.test/post',
  publishedAt: '2018-02-01T00:00:00.000Z',
  status: 'public',
  ownerVerified: true,
};
const registry = [
  { blogId: 5, url: 'https://source.test/', status: 'verified' },
  { blogId: 6, url: 'https://target.test/', status: 'verified' },
];
const fixture = () => ({
  originalTargetUrl: post.url,
  expectedTargetBlogId: null,
  registry,
  postCandidates: [post],
  savedObservations: [] as unknown[],
  sourceArticle: source,
  location: 'body',
});
const hop = (fromUrl: string, toUrl: string, patch: Record<string, unknown> = {}) => ({
  kind: 'redirect',
  fromUrl,
  toUrl,
  status: 301,
  fetchId: 'stored-fetch-1',
  sourceFetchUrl: 'https://old-target.test/post',
  observedAt: '2026-10-12T00:00:00.000Z',
  safe: true,
  robotsAllowed: true,
  ownerVerified: true,
  ownerBindingVerified: true,
  fromOwnerBlogId: null,
  toOwnerBlogId: 6,
  ...patch,
});
describe('stored assertions target resolver, no network/proof-storage', () => {
  it('known current exact post fills ID, retaining source/target independent dates and body/nonbody location', () => {
    for (const location of ['body', 'blogroll', 'sidebar', 'comment']) {
      const r = resolveTargetCanonical({ ...fixture(), location }, now);
      expect(r).toMatchObject({
        status: 'resolved',
        sourceArticle: { articleId: 10, publishedAt: source.publishedAt },
        targetArticle: { articleId: 20, publishedAt: post.publishedAt },
        location,
        observedAt: null,
      });
    }
    const missing = resolveTargetCanonical({ ...fixture(), postCandidates: [] }, now);
    expect(missing).toMatchObject({ status: 'unresolved', targetBlogId: 6, sourceArticle: { articleId: 10 } });
  });
  it('saved exact redirect assertions resolve only that original URL, not another path or missing hop', () => {
    const f = {
      ...fixture(),
      originalTargetUrl: 'https://old-target.test/post',
      expectedTargetBlogId: 6,
      savedObservations: [hop('https://old-target.test/post', post.url)],
    };
    const r = resolveTargetCanonical(f, now);
    expect(r).toMatchObject({
      status: 'resolved',
      originalTargetUrl: f.originalTargetUrl,
      targetArticle: { articleId: 20 },
      observedAt: '2026-10-12T00:00:00.000Z',
    });
    expect(resolveTargetCanonical({ ...f, originalTargetUrl: 'https://old-target.test/another' }, now).status).toBe('unresolved');
    expect(
      resolveTargetCanonical({ ...f, savedObservations: [{ verified: true, from: f.originalTargetUrl, to: post.url }] }, now).status,
    ).toBe('unresolved');
  });
  it('continuity requires the same saved fetch and each hop; scheme changes require actual hop assertions', () => {
    const from = 'https://old-target.test/post',
      middle = 'http://target.test/post';
    const f = {
      ...fixture(),
      originalTargetUrl: from,
      savedObservations: [hop(from, middle), hop(middle, post.url, { fromOwnerBlogId: 6 })],
    };
    expect(resolveTargetCanonical(f, now).status).toBe('resolved');
    expect(
      resolveTargetCanonical(
        { ...f, savedObservations: [hop(from, middle), hop('https://target.test/post', post.url, { fromOwnerBlogId: 6 })] },
        now,
      ).status,
    ).toBe('unresolved');
    expect(
      resolveTargetCanonical(
        { ...f, savedObservations: [hop(from, middle), hop(middle, post.url, { fromOwnerBlogId: 6, fetchId: 'other' })] },
        now,
      ).reason,
    ).toBe('fetch-identity-mismatch');
  });
  it('unknown barecanonical/alias/finalURL cannot become article proof; sameowner savedcanonical is terminal', () => {
    const from = 'https://target.test/old';
    const f = {
      ...fixture(),
      originalTargetUrl: from,
      savedObservations: [hop(from, post.url, { kind: 'canonical', status: 200, sourceFetchUrl: from, fromOwnerBlogId: 6 })],
    };
    expect(resolveTargetCanonical(f, now)).toMatchObject({ status: 'resolved', reason: 'stored-same-owner-canonical' });
    expect(resolveTargetCanonical({ ...f, savedObservations: [{ kind: 'canonical', fromUrl: from, toUrl: post.url }] }, now).status).toBe(
      'unresolved',
    );
    expect(
      resolveTargetCanonical(
        {
          ...f,
          originalTargetUrl: 'https://old-target.test/post',
          savedObservations: [hop('https://old-target.test/post', post.url, { kind: 'canonical', status: 200 })],
        },
        now,
      ).reason,
    ).toBe('foreign-canonical');
  });
  it.each([
    { safe: false },
    { robotsAllowed: false },
    { ownerVerified: false },
    { ownerBindingVerified: false },
    { observedAt: '2027-01-01T00:00:00.000Z' },
    { status: 200 },
    { toOwnerBlogId: 999 },
    { fromOwnerBlogId: 999 },
    { sourceFetchUrl: 'https://other.test/post' },
  ])('rejects incomplete/current-invalid hop %j', (patch) => {
    const from = 'https://old-target.test/post';
    expect(
      resolveTargetCanonical({ ...fixture(), originalTargetUrl: from, savedObservations: [hop(from, post.url, patch)] }, now).status,
    ).toBe('unresolved');
  });
  it('cannot override known registered owner; candidate conflicting IDs do not silently select a post', () => {
    expect(
      resolveTargetCanonical(
        {
          ...fixture(),
          originalTargetUrl: source.url,
          savedObservations: [hop(source.url, post.url, { sourceFetchUrl: source.url, fromOwnerBlogId: null })],
          postCandidates: [post],
        },
        now,
      ).reason,
    ).toBe('conflicting-owner');
    expect(resolveTargetCanonical({ ...fixture(), postCandidates: [post, { ...post, articleId: 21 }] }, now).status).toBe('unresolved');
  });
  it('Gamer sn/query/path remain article-specific and platform root is rejected', () => {
    const home = 'https://home.gamer.com.tw/homeindex.php?owner=alice',
      url = 'https://home.gamer.com.tw/creationDetail.php?owner=alice&sn=1';
    const f = {
      ...fixture(),
      originalTargetUrl: url,
      registry: [registry[0], { blogId: 6, url: home, status: 'verified' }],
      postCandidates: [{ ...post, url }],
    };
    expect(resolveTargetCanonical(f, now).status).toBe('resolved');
    for (const other of [url.replace('sn=1', 'sn=2'), url.replace('creationDetail', 'other'), url.replace('alice', 'bob')])
      expect(resolveTargetCanonical({ ...f, originalTargetUrl: other }, now).status).toBe('unresolved');
    expect(resolveTargetCanonical({ ...fixture(), originalTargetUrl: 'https://medium.com/' }, now)).toMatchObject({
      status: 'unresolved',
      reason: 'unsafe-url',
      originalTargetUrl: null,
    });
  });
  it('private/credentials/token/encodedreader URLs cannot leak through public DTO', () => {
    for (const url of [
      'http://127.0.0.1/post',
      'http://192.168.1.1/post',
      'https://user:SECRET@target.test/post',
      'https://target.test/post?access_token=SECRET',
      'https://target.test/post#access_token=SECRET',
      'https://target.test/%72eader/private',
      'https://target.test/ADMIN/private',
    ]) {
      const r = resolveTargetCanonical({ ...fixture(), originalTargetUrl: url }, now);
      expect(r.status).toBe('unresolved');
      expect(r.originalTargetUrl).toBeNull();
      expect(r.sourceArticle?.articleId).toBe(10);
      expect(JSON.stringify(r)).not.toContain('SECRET');
    }
  });
  it('hidden/rejected/moved/future/deleted/ownerchanged rows remain unresolved, null publication date is not observation date', () => {
    for (const status of ['hidden', 'rejected', 'moved'])
      expect(resolveTargetCanonical({ ...fixture(), registry: [registry[0], { ...registry[1], status }] }, now).status).toBe('unresolved');
    for (const candidate of [
      { ...post, status: 'hidden' },
      { ...post, publishedAt: '2027-01-01T00:00:00.000Z' },
      { ...post, blogId: 7 },
      { ...post, ownerVerified: false },
    ])
      expect(resolveTargetCanonical({ ...fixture(), postCandidates: [candidate] }, now).status).toBe('unresolved');
    expect(
      resolveTargetCanonical({ ...fixture(), postCandidates: [{ ...post, publishedAt: null }] }, now).targetArticle?.publishedAt,
    ).toBeNull();
  });
  it('strict bounded input, accessor/iterator side effects skipped, and no extra secret fields spread', () => {
    const f = fixture();
    let reads = 0;
    Object.defineProperty(f, 'registry', {
      get() {
        reads++;
        throw Error('PRIVATE');
      },
    });
    expect(resolveTargetCanonical(f, now).status).toBe('unresolved');
    expect(reads).toBe(0);
    const rows = [...registry];
    Object.defineProperty(rows, Symbol.iterator, {
      value: () => {
        throw Error('ITERATOR');
      },
    });
    expect(
      resolveTargetCanonical(
        { ...fixture(), registry: rows, secret: 'PRIVATE', postCandidates: [{ ...post, body: 'PRIVATE', header: 'PRIVATE' }] },
        now,
      ).status,
    ).toBe('resolved');
    expect(JSON.stringify(resolveTargetCanonical({ ...fixture(), secret: 'PRIVATE' }, now))).not.toContain('PRIVATE');
    expect(resolveTargetCanonical({ ...fixture(), registry: Array(4097).fill(registry[0]) }, now).status).toBe('unresolved');
    expect(resolveTargetCanonical({ ...fixture(), postCandidates: Array(11).fill(post) }, now).status).toBe('unresolved');
    expect(resolveTargetCanonical({ ...fixture(), savedObservations: Array(11).fill({}) }, now).status).toBe('unresolved');
  });
  it('savedhop limit5 and cycle rejected without authorizing synthetic gojp migration', () => {
    const start = 'https://old-target.test/post';
    const urls = [start, ...Array.from({ length: 4 }, (_, i) => `https://target.test/hop${i}`), post.url];
    const hops = urls.slice(0, -1).map((url, i) => hop(url, urls[i + 1], { fromOwnerBlogId: i ? 6 : null }));
    expect(resolveTargetCanonical({ ...fixture(), originalTargetUrl: start, savedObservations: hops }, now).status).toBe('resolved');
    expect(
      resolveTargetCanonical(
        {
          ...fixture(),
          originalTargetUrl: start,
          savedObservations: [...hops, hop(post.url, 'https://target.test/extra', { fromOwnerBlogId: 6 })],
        },
        now,
      ).status,
    ).toBe('unresolved');
    expect(
      resolveTargetCanonical(
        {
          ...fixture(),
          originalTargetUrl: start,
          savedObservations: [hop(start, 'https://target.test/middle'), hop('https://target.test/middle', start, { fromOwnerBlogId: 6 })],
        },
        now,
      ).reason,
    ).toBe('redirect-cycle');
  });
});
