/** SQL-only synthetic relation profile, on the existing isolated server. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { PARSER_VERSION, parseArticleLinks } from './parser.ts';
import { readBlogRelations } from './routes.ts';
import { saveObservation } from './store.ts';
export async function runProfileEvidenceIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const key = randomBytes(6).toString('hex');
  const now = new Date();
  const published = new Date(now.getTime() - 86400000);
  const ids: number[] = [];
  let postId = 0;
  let checks = 0;
  const check = (value: unknown) => {
    assert.ok(value);
    checks++;
  };
  try {
    for (const letter of ['a', 'b']) {
      const [r] = await pool.query<ResultSetHeader>(
        "INSERT INTO blogs(slug,name,url,status,status_label,discovered_at) VALUES (?,?,?,'verified','fixture',?)",
        [`evidence-${letter}-${key}`, `Synthetic ${letter}`, `https://${letter}-${key}.example/`, now],
      );
      ids.push(r.insertId);
    }
    const home = `https://a-${key}.example/`,
      target = `https://b-${key}.example/`;
    const url = home + 'post';
    const [p] = await pool.query<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at) VALUES (?,?,?,?,?,?)',
      [ids[0], url, url, 'Synthetic source', published, now],
    );
    postId = p.insertId;
    const html = `<article><p>正文脈絡<a href="${target}one">文章一</a><a href="${target}two">文章二</a></p></article><aside class="blogroll"><a href="${target}">部落卷</a></aside>`;
    const parsed = parseArticleLinks(html, url, ids[0], [
      { blogId: ids[0], url: home },
      { blogId: ids[1], url: target },
    ]);
    check(parsed.links.filter((r) => r.location === 'body').length === 2);
    await saveObservation(
      pool,
      { id: postId, blog_id: ids[0], url, published_at: published, blog_url: home, depth: 0 },
      parsed,
      new Response(html),
      now,
    );
    const before = await readBlogRelations(pool, { id: ids[0] }, 90);
    check(before.outgoing.length === 1 && before.outgoing[0].count === 1);
    check(before.evidence.length === 2 && before.evidence.every((r) => r.evidenceType === 'direct-link' && r.location === 'body'));
    check(before.evidence.every((r) => r.postId === postId && r.matchVersion === PARSER_VERSION && r.observedAt && r.publishedAt));
    check(before.evidence.some((r) => r.context.includes('正文脈絡')));
    check(before.nonBodyEvidence.length === 1 && before.nonBodyEvidence[0].location === 'blogroll');
    check(!before.evidenceTruncated && !before.nonBodyEvidenceTruncated);
    const manyHtml = `<article>${Array.from({ length: 21 }, (_, i) => `<a href="${target}body-${i}">正文 ${i}</a>`).join('')}</article><aside class="blogroll">${Array.from({ length: 21 }, (_, i) => `<a href="${target}roll-${i}">卷 ${i}</a>`).join('')}</aside>`;
    await saveObservation(
      pool,
      { id: postId, blog_id: ids[0], url, published_at: published, blog_url: home, depth: 0 },
      parseArticleLinks(manyHtml, url, ids[0], [
        { blogId: ids[0], url: home },
        { blogId: ids[1], url: target },
      ]),
      new Response(manyHtml),
      new Date(now.getTime() + 1),
    );
    const capped = await readBlogRelations(pool, { id: ids[0] }, 90);
    check(capped.evidence.length === 20 && capped.evidenceTruncated);
    check(capped.nonBodyEvidence.length === 20 && capped.nonBodyEvidenceTruncated);
    check(capped.outgoing.length === 1 && capped.outgoing[0].count === 1);
    for (const state of ['seed', 'rejected', 'moved']) {
      await pool.query('UPDATE blogs SET status=? WHERE id=?', [state, ids[1]]);
      const after = await readBlogRelations(pool, { id: ids[0] }, 90);
      check(!after.evidence.length && !after.nonBodyEvidence.length && !after.edges.length);
    }
    await pool.query("UPDATE blogs SET status='verified' WHERE id=?", [ids[1]]);
    await pool.query('UPDATE posts SET published_at=? WHERE id=?', [new Date('2099-01-01'), postId]);
    const future = await readBlogRelations(pool, { id: ids[0] }, 90);
    check(!future.evidence.length && !future.nonBodyEvidence.length && !future.edges.length);
    await pool.query('DELETE FROM posts WHERE id=?', [postId]);
    const removed = await readBlogRelations(pool, { id: ids[0] }, 90);
    check(!removed.evidence.length && !removed.nonBodyEvidence.length && !removed.edges.length);
    return { checks, rawBodyLinks: 2, countedMentions: 1, separateBlogroll: 1, realSql: true };
  } finally {
    if (postId) {
      await pool.query('DELETE FROM relation_links WHERE source_post_id=?', [postId]);
      await pool.query('DELETE FROM relation_observations WHERE post_id=?', [postId]);
      await pool.query('DELETE FROM posts WHERE id=?', [postId]);
    }
    if (ids.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [ids]);
  }
}
