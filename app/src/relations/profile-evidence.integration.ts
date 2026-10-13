/** SQL-only synthetic relation profile, on the existing isolated server. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { aliasesFromStoredEvidence } from './alias-evidence.ts';
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
  let reversePostId = 0;
  let checks = 0;
  const check = (value: unknown) => {
    assert.ok(value);
    checks++;
  };
  try {
    for (const letter of ['a', 'b']) {
      const [r] = await pool.query<ResultSetHeader>(
        "INSERT INTO blogs(slug,name,url,status,status_label,discovered_at) VALUES (?,?,?,'verified','fixture',?)",
        [`evidence-${letter}-${key}`, `Synthetic ${letter}`, letter === 'a' ? 'https://gogojp.tw/' : 'https://bobowin.blog/', now],
      );
      ids.push(r.insertId);
    }
    // URL-shaped acceptance scenarios only: HTML, dates and verified redirect
    // evidence below are synthetic, never fetched or written to blog_urls.
    const home = 'https://gogojp.tw/',
      target = 'https://bobowin.blog/';
    const url = home + 'jrkyushu';
    const [p] = await pool.query<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at) VALUES (?,?,?,?,?,?)',
      [ids[0], url, url, 'Synthetic source', published, now],
    );
    postId = p.insertId;
    const html = `<article><p>正文脈絡<a href="${target}asoboy">文章一</a><a href="${target}asoboy/another-synthetic-target">文章二</a></p></article><aside class="blogroll"><a href="${target}">部落卷</a></aside>`;
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
    const reverseUrl = target + 'asoboy';
    const legacyUrl = 'https://gojp.tw/2017-08-07-252';
    const reversePublished = new Date(now.getTime() - 40 * 86400000);
    const baseAliases = [
      { blogId: ids[0], url: home },
      { blogId: ids[1], url: target },
    ];
    const redirectEvidence = aliasesFromStoredEvidence(
      [
        {
          kind: 'redirect',
          from: legacyUrl,
          to: home + '2017-08-07-252',
          sourceUrl: legacyUrl,
          observedAt: now.toISOString(),
          verified: true,
        },
      ],
      baseAliases,
      now,
    );
    check(redirectEvidence.length === 1 && redirectEvidence[0].scope === 'exact-url');
    const [reversePost] = await pool.query<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at) VALUES (?,?,?,?,?,?)',
      [ids[1], reverseUrl, reverseUrl, 'Synthetic historical reverse source', reversePublished, now],
    );
    reversePostId = reversePost.insertId;
    const reverseHtml = `<article><p>合成舊文正文<a href="${legacyUrl}?utm_source=fixture#section">舊網址</a><a href="${home}another-synthetic-target">另一文章</a></p></article><aside class="blogroll"><a href="${home}">部落卷</a></aside>`;
    await saveObservation(
      pool,
      { id: reversePostId, blog_id: ids[1], url: reverseUrl, published_at: reversePublished, blog_url: target, depth: 0 },
      parseArticleLinks(reverseHtml, reverseUrl, ids[1], [...baseAliases, ...redirectEvidence]),
      new Response(reverseHtml),
      now,
    );
    const both = await readBlogRelations(pool, { id: ids[0] }, 90);
    check(both.outgoing.length === 1 && both.outgoing[0].count === 1);
    check(both.incoming.length === 1 && both.incoming[0].count === 1);
    const outgoingProof = both.evidence.filter((r) => r.sourceBlogId === ids[0]);
    const incomingProof = both.evidence.filter((r) => r.sourceBlogId === ids[1]);
    check(outgoingProof.length === 2 && incomingProof.length === 2);
    check(
      outgoingProof.every(
        (r) => r.postId === postId && r.postUrl === url && Math.abs(Date.parse(r.publishedAt!) - published.getTime()) < 1000,
      ),
    );
    check(
      incomingProof.every(
        (r) =>
          r.postId === reversePostId &&
          r.postUrl === reverseUrl &&
          Math.abs(Date.parse(r.publishedAt!) - reversePublished.getTime()) < 1000,
      ),
    );
    check(incomingProof.some((r) => r.targetUrl === legacyUrl && r.targetBlogId === ids[0]));
    check(both.nonBodyEvidence.length === 2 && both.nonBodyEvidence.every((r) => r.location === 'blogroll'));
    const recentOnly = await readBlogRelations(pool, { id: ids[0] }, 7);
    check(recentOnly.outgoing.length === 1 && recentOnly.incoming.length === 0);
    check(recentOnly.evidence.every((r) => r.postId === postId));
    // A URL containing 2017 is not an invented publication date. Test the actual
    // stored synthetic date leaving the selected 90-day window independently.
    await pool.query('UPDATE posts SET published_at=? WHERE id=?', [new Date(now.getTime() - 120 * 86400000), reversePostId]);
    const outside = await readBlogRelations(pool, { id: ids[0] }, 90);
    check(outside.incoming.length === 0 && outside.outgoing.length === 1);
    check(outside.evidence.every((r) => r.postId === postId));
    await pool.query('DELETE FROM relation_links WHERE source_post_id=?', [reversePostId]);
    await pool.query('DELETE FROM relation_observations WHERE post_id=?', [reversePostId]);
    await pool.query('DELETE FROM posts WHERE id=?', [reversePostId]);
    reversePostId = 0;
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
    return {
      checks,
      rawBodyLinks: 2,
      countedMentions: 1,
      separateBlogroll: 1,
      bidirectionalFixture: true,
      separatePublicationDates: true,
      outside90Excluded: true,
      syntheticInputs: true,
      realCapture: false,
      realSql: true,
    };
  } finally {
    if (reversePostId) {
      await pool.query('DELETE FROM relation_links WHERE source_post_id=?', [reversePostId]);
      await pool.query('DELETE FROM relation_observations WHERE post_id=?', [reversePostId]);
      await pool.query('DELETE FROM posts WHERE id=?', [reversePostId]);
    }
    if (postId) {
      await pool.query('DELETE FROM relation_links WHERE source_post_id=?', [postId]);
      await pool.query('DELETE FROM relation_observations WHERE post_id=?', [postId]);
      await pool.query('DELETE FROM posts WHERE id=?', [postId]);
    }
    if (ids.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [ids]);
  }
}
