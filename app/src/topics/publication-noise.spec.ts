import type { Pool } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { topicDetail } from '../public-api/topics.ts';
import { exclusionReason, MATCHER_VERSION, POLICY_VERSION, projectTopicTerms } from './policy.ts';
import { publicationExclusionReason, publicationLabelSql } from './publication-noise.ts';
import { evidence, resolveTopic, topicEvidenceDetail } from './routes.ts';

const noise = [
  '',
  ' ',
  '\t\n',
  '\u3000',
  '""',
  "''",
  '「」',
  '！？',
  '…—',
  '___',
  '::',
  '\\/',
  '+-×÷',
  '$€',
  '♥★',
  '😀',
  '™',
  '㍿',
  '\u0301',
];
const meaningful = ['C++', 'C#', 'AI', '台灣', 'ＡＩ', '日本語', 'café', '한국어', 'العربية', '3C', '2026', '½'];
const id = `tag:${'a'.repeat(64)}`;

describe('publication-time empty and punctuation exclusions', () => {
  it('rejects Unicode punctuation, whitespace and symbols; retains real mixed tokens', () => {
    for (const label of noise) expect(publicationExclusionReason(label), JSON.stringify(label)).not.toBeNull();
    for (const label of meaningful) expect(publicationExclusionReason(label), label).toBeNull();
    expect(publicationExclusionReason('\u3000')).toBe('empty-label');
    expect(publicationExclusionReason('""')).toBe('punctuation-only');
    for (const label of ['C++', 'C#', 'AI']) expect(exclusionReason(label), label).toBeNull();
    // Existing crowdsource no-equal policy is unchanged; 台灣 is not punctuation.
    expect(exclusionReason('台灣')).toBe('no-equal');
    expect(exclusionReason('2026')).toBe('pure-number');
  });
  it('keeps raw rows and aliases, recording the reason in future projections', () => {
    const raw = noise.map((label, i) => ({ id: String(i), label, payload: { articleCount: 10 } }));
    const before = structuredClone(raw),
      projected = projectTopicTerms(raw);
    expect(raw).toEqual(before);
    expect(projected.aliases).toHaveLength(raw.length);
    expect(projected.terms.every((t) => ['empty-label', 'punctuation-only'].includes(t.exclusionReason ?? ''))).toBe(true);
    expect(exclusionReason('""', { noise: true })).toBe('upstream-noise');
  });
  it('does not invalidate existing matcher or projection version hashes', () => {
    expect(POLICY_VERSION).toBe('topic-policy-v3:25670024a3b758518aa0895b6ca6ebc0d1a4e6540a48380d0aeade56fe703475');
    expect(MATCHER_VERSION).toBe('topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5');
  });
  it('uses mode-independent UTF-8 PCRE property literals with no interpolated input', () => {
    const sql = publicationLabelSql('t.label');
    const encoded = /0x([a-f0-9]+)/.exec(sql)![1];
    const pattern = Buffer.from(encoded, 'hex').toString('utf8');
    expect(pattern).toBe('[\\p{L}\\p{N}]');
    const expression = new RegExp(pattern, 'u');
    for (const label of noise) expect(expression.test(label), label).toBe(false);
    for (const label of meaningful) expect(expression.test(label), label).toBe(true);
    expect(sql).toContain('CONVERT(');
    expect(sql.match(/COLLATE utf8mb4_bin/g)).toHaveLength(2);
    expect(sql).not.toContain('\\');
    expect(() => publicationLabelSql('label); DROP TABLE blogs;--')).toThrow('invalid_publication_label_column');
    expect(evidence()).toContain(sql);
    expect(evidence(true)).toContain(sql);
  });
  it('retained old canonical records are immediately excluded in detail without fetching article evidence', async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT t.id,t.label'))
          return [[{ id: 'a'.repeat(64), label: '""', exclusion_reason: null, inactive_reason: null, article_count: 20 }]];
        if (sql.includes('SELECT f.high_frequency')) return [[]];
        throw Error('noise must not fetch public article evidence');
      },
    } as unknown as Pool;
    const resolved = await resolveTopic(pool, id);
    expect(resolved).toMatchObject({ id, label: '""', matchingStatus: 'excluded', excludedReason: 'punctuation-only' });
    const detail = await topicEvidenceDetail(pool, id, 30);
    expect(detail).toMatchObject({ topic: { excludedReason: 'punctuation-only' }, articles: [], blogs: [], truncated: false });
    expect(queries.some((sql) => sql.includes('WITH scoped_posts'))).toBe(false);
  });
  it('RSS aliases use the same live exclusion even without a vocabulary entry', async () => {
    const pool = {
      query: async (sql: string) => (sql.startsWith('SELECT label FROM tags') ? [[{ label: '！？' }]] : [[]]),
    } as unknown as Pool;
    expect(await resolveTopic(pool, 'rss:12')).toMatchObject({
      canonicalId: null,
      matchingStatus: 'excluded',
      excludedReason: 'punctuation-only',
    });
  });
  it('public v1 topic detail retains diagnostic reason but never publishes noisy evidence', async () => {
    const pool = {
      query: async (sql: string) => {
        if (sql.includes('SELECT t.id,t.label'))
          return [[{ id: 'a'.repeat(64), label: '""', exclusion_reason: null, inactive_reason: null, article_count: 3 }]];
        return [[]];
      },
    } as unknown as Pool;
    expect(await topicDetail(pool, id, 720)).toMatchObject({ topic: { excludedReason: 'punctuation-only' }, articles: [], blogs: [] });
  });
});
