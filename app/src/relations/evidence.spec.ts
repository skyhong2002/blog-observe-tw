import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { aliasesFromStoredEvidence, type StoredAliasEvidence } from './alias-evidence.ts';
import { countDirectMentionEvidence, projectRelationEvidence } from './evidence.ts';
import { compilePublicationAliases } from './identity.ts';
import { PARSER_VERSION, parseArticleLinks } from './parser.ts';
import { loadAliases } from './store.ts';

const now = new Date('2026-10-13T00:00:00Z');
const aliases = [
  { blogId: 39, url: 'https://gogojp.tw/' },
  { blogId: 40, url: 'https://bobowin.blog/' },
];
const record = (patch: Partial<StoredAliasEvidence> = {}): StoredAliasEvidence => ({
  kind: 'redirect',
  from: 'https://gojp.tw/r/123?article=7',
  to: 'https://gogojp.tw/post',
  sourceUrl: 'https://gojp.tw/r/123?article=7',
  observedAt: '2026-10-12T00:00:00Z',
  verified: true,
  ...patch,
});
describe('offline stored alias evidence', () => {
  it('loads registered publication homes and exact redirect records only from current verified sources', async () => {
    const query = vi.fn(async (_sql: string) => [
      [
        { blogId: 39, url: 'https://gogojp.tw/', scope: 'publication-prefix' },
        { blogId: 39, url: record().from, scope: 'exact-url' },
      ],
    ]);
    const loaded = await loadAliases({ query } as unknown as Pool);
    const sql = query.mock.calls[0][0];
    expect(sql.match(/b.status='verified'/g)).toHaveLength(2);
    expect(sql).toContain("ELSE 'exact-url' END scope");
    const resolver = compilePublicationAliases(loaded);
    expect(resolver.resolve(record().from)).toBe(39);
    expect(resolver.resolve('https://gojp.tw/unobserved')).toBeNull();
  });
  it('never guesses gojp from gogojp or merges the registered bobowin publication', () => {
    const resolver = compilePublicationAliases(aliases);
    expect(resolver.resolve('https://gojp.tw/post')).toBeNull();
    expect(resolver.resolve('https://www.gogojp.tw/post')).toBe(39);
    expect(resolver.resolve('https://bobowin.blog/post')).toBe(40);
    expect(aliasesFromStoredEvidence([record({ from: 'https://gogojp.tw/', to: 'https://bobowin.blog/' })], aliases, now)).toEqual([]);
  });
  it('a stored redirect resolves only its exact URL, not every URL on that host', () => {
    const evidence = aliasesFromStoredEvidence([record()], aliases, now);
    expect(evidence).toEqual([{ blogId: 39, url: record().from, scope: 'exact-url' }]);
    const resolver = compilePublicationAliases([...aliases, ...evidence]);
    expect(resolver.resolve(record().from + '&utm_source=test#fragment')).toBe(39);
    expect(resolver.resolve('https://gojp.tw/r/123?article=8')).toBeNull();
    expect(resolver.resolve('https://gojp.tw/r/123/other?article=7')).toBeNull();
    expect(resolver.resolve('https://gojp.tw/')).toBeNull();
  });
  it('keeps Gamer exact redirects distinct by article path and sn, not just owner', () => {
    const from = 'https://home.gamer.com.tw/creationDetail.php?owner=alice&sn=1';
    const second = 'https://home.gamer.com.tw/creationDetail.php?owner=alice&sn=2';
    const evidence = aliasesFromStoredEvidence(
      [record({ from, sourceUrl: from }), record({ from: second, sourceUrl: second, to: 'https://bobowin.blog/post' })],
      aliases,
      now,
    );
    expect(evidence).toHaveLength(2);
    const resolver = compilePublicationAliases([...aliases, ...evidence]);
    expect(resolver.resolve(from)).toBe(39);
    expect(resolver.resolve(second)).toBe(40);
    expect(resolver.resolve(from + '&utm_source=test#fragment')).toBe(39);
    expect(resolver.resolve(from.replace('sn=1', 'sn=3'))).toBeNull();
    expect(resolver.resolve(from.replace('creationDetail.php', 'homeindex.php'))).toBeNull();
    expect(resolver.resolve(from.replace('owner=alice', 'owner=bob'))).toBeNull();
    expect(resolver.resolve(from.replace('https:', 'http:'))).toBeNull();
  });
  it('retains Gamer publication-prefix ownership and conflicts with only the exact redirected article', () => {
    const from = 'https://home.gamer.com.tw/creationDetail.php?owner=alice&sn=1';
    const resolver = compilePublicationAliases([
      ...aliases,
      { blogId: 41, url: 'https://home.gamer.com.tw/homeindex.php?owner=alice', scope: 'publication-prefix' },
      { blogId: 39, url: from, scope: 'exact-url' },
    ]);
    expect(resolver.resolve(from)).toBeNull();
    expect(resolver.resolve(from.replace('sn=1', 'sn=2'))).toBe(41);
    expect(resolver.resolve('https://home.gamer.com.tw/homeindex.php?owner=alice')).toBe(41);
    expect(resolver.resolve(from.replace('owner=alice', 'owner=bob'))).toBeNull();
  });

  it('explicit stored ownership may prove a home, while owner/article paths stay bounded', () => {
    const evidence = aliasesFromStoredEvidence([record({ kind: 'ownership', from: 'https://gojp.tw/' })], aliases, now);
    expect(compilePublicationAliases([...aliases, ...evidence]).resolve('https://gojp.tw/post')).toBe(39);
    expect(aliasesFromStoredEvidence([record({ kind: 'ownership', from: 'https://gojp.tw/article' })], aliases, now)).toEqual([]);
    expect(aliasesFromStoredEvidence([record({ kind: 'ownership', from: 'https://medium.com/' })], aliases, now)).toEqual([]);
  });
  it.each([
    { verified: false },
    { to: 'https://unregistered.example/' },
    { observedAt: '2026-10-14T00:00:00Z' },
    { sourceUrl: 'http://127.0.0.1/' },
    { from: 'https://user:password@gojp.tw/r' },
  ])('rejects missing/unsafe/unknown proof %j', (patch) => {
    expect(aliasesFromStoredEvidence([{ ...record(), ...patch } as StoredAliasEvidence], aliases, now)).toEqual([]);
  });
  it('conflicting exact redirects remain unresolved', () => {
    const evidence = aliasesFromStoredEvidence([record(), record({ to: 'https://bobowin.blog/post' })], aliases, now);
    expect(compilePublicationAliases([...aliases, ...evidence]).resolve(record().from)).toBeNull();
  });
  it('exact redirect observations cannot override a registered or ambiguous publication owner', () => {
    for (const current of [aliases, [...aliases, { blogId: 41, url: 'https://gogojp.tw/' }]]) {
      const resolver = compilePublicationAliases([...current, { blogId: 40, url: 'https://gogojp.tw/post', scope: 'exact-url' }]);
      expect(resolver.resolve('https://gogojp.tw/post')).toBeNull();
    }
  });
});

describe('raw links and distinct article counts', () => {
  it('keeps different articles/anchors/contexts while counting one body mention per source article and target', () => {
    const parsed = parseArticleLinks(
      `<article>
      <p>第一段<a href="https://bobowin.blog/a">旅行</a></p>
      <p>第二段<a href="https://bobowin.blog/b">飲食</a></p>
      <p>第三段<a href="https://bobowin.blog/a">旅行</a></p>
      <div class="blogroll"><a href="https://bobowin.blog/">友站</a></div>
    </article>`,
      'https://gogojp.tw/post',
      39,
      aliases,
    );
    expect(parsed.links).toHaveLength(4);
    expect(parsed.links.slice(0, 3).map((link) => link.targetUrl)).toEqual([
      'https://bobowin.blog/a',
      'https://bobowin.blog/b',
      'https://bobowin.blog/a',
    ]);
    expect(parsed.links[0].context).not.toBe(parsed.links[2].context);
    const raw = parsed.links.map((link) => ({ ...link, sourcePostId: 1, sourceBlogId: 39 }));
    const counts = countDirectMentionEvidence([...raw, { ...raw[0], sourcePostId: 2 }]);
    expect(counts).toEqual([
      { sourceBlogId: 39, targetBlogId: 40, location: 'body', count: 2 },
      { sourceBlogId: 39, targetBlogId: 40, location: 'blogroll', count: 1 },
    ]);
    expect(parsed.links).toHaveLength(4);
  });
  it('unresolved and self-targets never become confirmed counts', () => {
    expect(
      countDirectMentionEvidence([
        { sourcePostId: 1, sourceBlogId: 39, targetBlogId: null, location: 'body' },
        { sourcePostId: 1, sourceBlogId: 39, targetBlogId: 39, location: 'body' },
      ]),
    ).toEqual([]);
  });
});

describe('public evidence discriminator contract, not a matching engine', () => {
  const base = { sourceBlogId: 39, targetBlogId: 40, observedAt: '2026-10-12T00:00:00Z', body_text: 'PRIVATE_FULL_BODY' };
  it('direct-link retains structural location and source version without raw body', () => {
    const result = projectRelationEvidence(
      {
        ...base,
        type: 'direct-link',
        sourcePostId: 1,
        targetUrl: 'https://bobowin.blog/a?utm_source=test',
        location: 'blogroll',
        sourceVersion: PARSER_VERSION,
      },
      now,
    );
    expect(result).toMatchObject({
      type: 'direct-link',
      location: 'blogroll',
      targetUrl: 'https://bobowin.blog/a',
      sourceVersion: PARSER_VERSION,
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_FULL_BODY');
  });
  it('shared tags are their own type and never imply a direct-link or similarity score', () => {
    const result = projectRelationEvidence(
      {
        ...base,
        type: 'shared-tags',
        tags: [
          { id: 1, label: '旅遊' },
          { id: 1, label: '旅遊' },
        ],
        sourceVersion: 'tag-snapshot-v1',
      },
      now,
    );
    expect(result).toMatchObject({ type: 'shared-tags', tags: [{ id: 1, label: '旅遊' }] });
    expect(result).not.toHaveProperty('score');
    expect(result).not.toHaveProperty('targetUrl');
  });
  it('does not synthesize text similarity when no actual score/hash/version evidence exists', () => {
    expect(projectRelationEvidence({ ...base, type: 'text-similarity' }, now)).toBeNull();
    const proof = {
      ...base,
      type: 'text-similarity',
      sourcePostId: 1,
      targetPostId: 2,
      score: 0.82,
      algorithmVersion: 'existing-similarity-v1',
      sourceHash: 'a'.repeat(64),
      targetHash: 'b'.repeat(64),
    };
    expect(projectRelationEvidence(proof, now)).toMatchObject({ type: 'text-similarity', score: 0.82 });
    expect(projectRelationEvidence({ ...proof, score: NaN }, now)).toBeNull();
  });
  it('rejects future observations, self edges and oversized tag payloads', () => {
    const row = { ...base, type: 'shared-tags', tags: [{ id: 1, label: '旅遊' }], sourceVersion: 'v1' };
    expect(projectRelationEvidence({ ...row, observedAt: '2026-10-14' }, now)).toBeNull();
    expect(projectRelationEvidence({ ...row, targetBlogId: 39 }, now)).toBeNull();
    expect(projectRelationEvidence({ ...row, tags: Array(51).fill(row.tags[0]) }, now)).toBeNull();
  });
});
