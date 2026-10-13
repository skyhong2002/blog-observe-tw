import { describe, expect, it } from 'vitest';
import { TOPIC_FINGERPRINT_VERSION, topicFingerprintSql } from './provenance-fingerprint-sql.ts';

describe('pure versioned SQL fingerprints', () => {
  it('independent fixed domains and stable field order, not cross-domain equality', () => {
    const r = topicFingerprintSql();
    expect(r.version).toBe(TOPIC_FINGERPRINT_VERSION);
    expect(Object.isFrozen(r)).toBe(true);
    expect(r.metadataSql).toContain(
      "JSON_ARRAY('topic-post-fingerprint-v1',p.id,p.blog_id,b.id,b.url,p.url,SHA2(CONVERT(p.title USING utf8mb4),256),SHA2(CONVERT(p.summary USING utf8mb4),256),p.content_hash,DATE_FORMAT(p.published_at,'%Y-%m-%dT%H:%i:%s.%fZ'))",
    );
    expect(r.bodySql).toContain(
      "JSON_ARRAY('topic-body-fingerprint-v1',cb.post_id,cb.blog_id,cb.status,cb.content_hash,cb.revision,cb.source_kind,cb.source_url,cb.article_url,cb.adapter_id,cb.adapter_version,cb.rule_revision,",
    );
    expect(r.bodySql).toContain('OCTET_LENGTH(cb.body_text),OCTET_LENGTH(cb.body_html)');
    expect(r.bodySql).not.toContain('SHA2(CONVERT(cb.body_text');
    expect(r.metadataSql).not.toContain('COALESCE');
  });
  it('fixed aliases substitute only approved identifiers', () => {
    const r = topicFingerprintSql({ post: 'p2', blog: 'b2', body: 'cb2' });
    expect(r.metadataSql).toContain('p2.id,p2.blog_id,b2.id,b2.url');
    expect(r.bodySql).toContain('cb2.post_id');
  });
  it('unknown/proto/symbol/partial/injection values rejected', () => {
    for (const raw of [
      null,
      [],
      Object.create(null),
      { post: 'p' },
      { post: 'p', blog: 'b', body: 'cb', extra: true },
      { post: 'p;DROP TABLE posts', blog: 'b', body: 'cb' },
      Object.assign(Object.create({ secret: true }), { post: 'p', blog: 'b', body: 'cb' }),
      { post: 'p', blog: 'b', body: 'cb', [Symbol('x')]: true },
    ])
      expect(() => topicFingerprintSql(raw as never)).toThrow('invalid-fingerprint-aliases');
  });
  it('getter and Proxy rejected without invocation', () => {
    let invoked = 0;
    const getter = Object.defineProperty({ blog: 'b', body: 'cb' }, 'post', {
      enumerable: true,
      get() {
        invoked++;
        return 'p';
      },
    });
    expect(() => topicFingerprintSql(getter as never)).toThrow();
    const proxy = new Proxy(
      { post: 'p', blog: 'b', body: 'cb' },
      {
        getPrototypeOf() {
          invoked++;
          throw Error('trap');
        },
      },
    );
    expect(() => topicFingerprintSql(proxy as never)).toThrow();
    expect(invoked).toBe(0);
  });
  it('bounded expressions, no publication/DB operations', () => {
    const r = topicFingerprintSql();
    expect(r.metadataSql.length + r.bodySql.length).toBeLessThan(2048);
    expect(Object.keys(r)).toEqual(['version', 'metadataSql', 'bodySql']);
    expect(r.metadataSql).not.toMatch(/SELECT|JOIN|UPDATE/);
  });
});

it('SQL fingerprint is not an existence/public predicate; absent body still has JSON domain', () => {
  const r = topicFingerprintSql();
  expect(r.bodySql).toContain("JSON_ARRAY('topic-body-fingerprint-v1',cb.post_id");
  expect(r.bodySql).not.toContain('CASE WHEN cb.post_id');
  expect(r.metadataSql).not.toContain('b.status');
  expect(r.metadataSql).not.toContain('UTC_TIMESTAMP');
  expect(r.bodySql).not.toContain('IS NOT NULL');
});
