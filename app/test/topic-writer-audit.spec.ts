import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditTopicWriterTree, collectTopicWriters, writerAuditSource } from '../../tools/lib/topic-writer-audit.ts';

describe('literal SQL writer drift, not DB admission', () => {
  it('pins every current tracked literal and dynamic reference to the reviewed registry', async () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const expected = JSON.parse(await readFile(new URL('../../data/topic-writer-registry.json', import.meta.url), 'utf8'));
    expect(await auditTopicWriterTree(root)).toEqual(expected);
  });
  it('tracks quoted/schema-qualified and ON DUPLICATE writes without raw SQL output', () => {
    const source =
      'db.execute("INSERT IGNORE INTO `posts`(id) VALUES(?) ON DUPLICATE KEY UPDATE title=?"); db.query("UPDATE blog_observe.blogs SET status=?"); db.execute("DELETE FROM content_post_bodies WHERE post_id=?");';
    const r = collectTopicWriters('app/src/example.ts', source);
    expect(r.map((x) => x.tables[0]).sort()).toEqual(['blogs', 'content_post_bodies', 'posts']);
    expect(JSON.stringify(r)).not.toContain('VALUES');
    expect(JSON.stringify(r)).not.toContain('status=?');
  });
  it('records dynamic table templates as unresolved instead of assuming no writes', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: source fixture for the parser, not an interpolated SQL query.
    const r = collectTopicWriters('tools/example.ts', 'db.query(`UPDATE ${table} SET status=?`);');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ dynamic: true, tables: [] });
  });
  it('enrolls concatenation and unknown query expressions as unresolved', () => {
    const r = collectTopicWriters('tools/example.ts', 'db.query("UPDATE " + table + " SET status=?"); db.execute(sqlFromElsewhere());');
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r.every((x) => x.dynamic)).toBe(true);
  });
  it('fails closed on malformed syntax and does not ignore a normal helper containing test in its name', () => {
    expect(() => collectTopicWriters('app/src/x.ts', 'db.query("UPDATE posts SET title=?"')).toThrow('writer-audit-parse');
    expect(writerAuditSource('tools/latest-topic.ts')).toBe(true);
    expect(writerAuditSource('tools/test-topic-updater.ts')).toBe(true);
  });
  it('enrolls computed query methods and unusual DML rather than silently dropping them', () => {
    const source =
      'db["query"](externalSQL); query(otherSQL); db.query("UPDATE LOW_PRIORITY posts SET title=?"); db.query("UPDATE /* reason */ blogs SET status=?"); db["que"+"ry"](externalSQL); db[method](externalSQL);';
    const r = collectTopicWriters('app/src/x.ts', source);
    expect(r).toHaveLength(6);
    expect(r.every((x) => x.dynamic)).toBe(true);
  });
  it('marks interpolated tracked writes as dynamic even when the table itself is literal', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: parser input, never run as a query.
    const r = collectTopicWriters('app/src/x.ts', 'db.query(`UPDATE posts SET title=${value}`);');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tables: ['posts'], dynamic: true });
  });
  it('SQL changes, new paths or added duplicate writers change the metadata', () => {
    const a = collectTopicWriters('tools/a.ts', 'db.query("UPDATE posts SET title=?");');
    expect(collectTopicWriters('tools/a.ts', 'db.query("UPDATE posts SET url=?");')).not.toEqual(a);
    expect(collectTopicWriters('tools/b.ts', 'db.query("UPDATE posts SET title=?");')).not.toEqual(a);
    expect(
      collectTopicWriters('tools/a.ts', 'db.query("UPDATE posts SET title=?");db.query("UPDATE posts SET title=?");')[0].occurrences,
    ).toBe(2);
  });
  it('never treats ignored fixtures, comments and read queries as enrollment', () => {
    expect(writerAuditSource('app/src/topics/x.integration.ts')).toBe(false);
    expect(writerAuditSource('app/test/x.spec.ts')).toBe(false);
    expect(writerAuditSource('tools/test-integration.mjs')).toBe(false);
    expect(writerAuditSource('tools/.env')).toBe(false);
    expect(collectTopicWriters('app/src/x.ts', '// UPDATE posts\ndb.query("SELECT * FROM posts");')).toEqual([]);
    expect(() => collectTopicWriters('tools/.env', 'secret')).toThrow('writer-audit-input');
  });
  it('caps source input before parse and includes relation fallback writes', () => {
    expect(() => collectTopicWriters('app/src/x.ts', 'x'.repeat(1024 * 1024 + 1))).toThrow('writer-audit-input');
    expect(collectTopicWriters('app/src/x.ts', 'db.execute("UPDATE relation_observations SET status=?");')[0].tables).toEqual([
      'relation_observations',
    ]);
  });
});
