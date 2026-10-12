/** SQL regression fixtures. Caller MUST supply an isolated test database. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { parseArticleLinks } from './parser.ts';
import { deferObservation, discoverCandidateLinks, loadAliases, requeueLegacyObservations, saveObservation } from './store.ts';
import { relationBudgetAvailable } from './worker.ts';

export async function runRelationQualityIntegration(pool: Pool) {
  const suffix = Date.now().toString(36),
    now = new Date('2088-03-04T01:00:00Z');
  const url = `https://quality-${suffix}.example/`,
    origin = new URL(url).origin;
  const candidates: number[] = [];
  const scope = `relations:host:${createHash('sha256').update(origin).digest('hex')}`;
  let blogId = 0,
    postId = 0,
    assertions = 0;
  const check = (value: unknown) => {
    assert.ok(value);
    assertions++;
  };
  try {
    const [blog] = await pool.query<ResultSetHeader>(
      "INSERT INTO blogs(slug,name,url,status,status_label,discovered_at) VALUES (?,?,?,'verified','fixture',?)",
      [`quality-${suffix}`, 'Quality', url, now],
    );
    blogId = blog.insertId;
    const [post] = await pool.query<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at) VALUES (?,?,?,?,?,?)',
      [blogId, url + 'post', url + 'post', 'Quality fixture', now, now],
    );
    postId = post.insertId;
    const p = { id: postId, blog_id: blogId, url: url + 'post', blog_url: url, published_at: now, depth: 0 };
    await pool.query('INSERT INTO work_budgets(day,scope,used,updated_at) VALUES (?,?,20,?)', [now.toISOString().slice(0, 10), scope, now]);
    check(!(await relationBudgetAvailable(pool, p.url, now)));
    await deferObservation(pool, p, now);
    let [[o]] = await pool.query<RowDataPacket[]>('SELECT * FROM relation_observations WHERE post_id=?', [postId]);
    check(o.status === 'deferred' && o.last_success_at === null && o.error_code === 'budget-deferred');
    check(new Date(o.next_attempt_at).toISOString() === '2088-03-05T00:00:00.000Z');
    const aliases = await loadAliases(pool);
    const html =
      '<body class="ast-right-sidebar"><article class="tag-movie-comment"><div class="entry-content">正文<a href="https://bit.ly/x">短址</a><a href="https://news.ltn.com.tw/news">媒體</a></div></article></body>';
    const parsed = parseArticleLinks(html, p.url, blogId, aliases);
    await saveObservation(pool, p, parsed, new Response(html), now);
    const [links] = await pool.query<RowDataPacket[]>('SELECT target_reason FROM relation_links WHERE source_post_id=?', [postId]);
    check(links.some((l) => l.target_reason === 'shortener-unresolved') && links.some((l) => l.target_reason === 'non-publication-host'));
    const [[before]] = await pool.query<RowDataPacket[]>(
      "SELECT COALESCE(SUM(used),0) used FROM work_budgets WHERE day=? AND scope='relations:candidates'",
      [now.toISOString().slice(0, 10)],
    );
    await discoverCandidateLinks(
      pool,
      { blogId, blogUrl: url, sourceUrl: p.url, postId, depth: 0, kind: 'article-link', path: [p.url] },
      parsed.links,
      now,
    );
    const [[after]] = await pool.query<RowDataPacket[]>(
      "SELECT COALESCE(SUM(used),0) used FROM work_budgets WHERE day=? AND scope='relations:candidates'",
      [now.toISOString().slice(0, 10)],
    );
    check(Number(before.used) === Number(after.used));
    await deferObservation(pool, p, now);
    [[o]] = await pool.query<RowDataPacket[]>('SELECT * FROM relation_observations WHERE post_id=?', [postId]);
    check(o.status === 'ok' && o.body_text.includes('正文') && o.last_success_at !== null);
    await pool.query("UPDATE relation_observations SET parser_version='semantic-links-v1' WHERE post_id=?", [postId]);
    const dry = await requeueLegacyObservations(pool);
    check(dry.applied === 0 && dry.postIds.includes(postId));
    await requeueLegacyObservations(pool, { apply: true, limit: 2000 });
    [[o]] = await pool.query<RowDataPacket[]>('SELECT * FROM relation_observations WHERE post_id=?', [postId]);
    check(o.status === 'reparse-pending' && o.etag === null && o.body_text.includes('正文'));
    const [[retained]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM relation_links WHERE source_post_id=?', [postId]);
    check(Number(retained.count) === 2);
    // A legacy owner-less Gamer candidate must not swallow distinct query-owned publications.
    for (const candidateUrl of [
      'https://home.gamer.com.tw/homeindex.php',
      `https://home.gamer.com.tw/homeindex.php?owner=alice${suffix}`,
    ]) {
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO discovery_candidates(url,name,source_type,source_url,source_evidence,status,discovered_at) VALUES (?,'fixture',?,?,'{}','candidate',?)`,
        [candidateUrl, `fixture-${suffix}`, url, now],
      );
      candidates.push(r.insertId);
    }
    const gamerHtml = `<article><a href="https://home.gamer.com.tw/homeindex.php?owner=alice${suffix}">Alice</a><a href="https://home.gamer.com.tw/homeindex.php?owner=bob${suffix}">Bob</a></article>`;
    const gamerLinks = parseArticleLinks(gamerHtml, p.url, blogId, aliases).links;
    await discoverCandidateLinks(
      pool,
      { blogId, blogUrl: url, sourceUrl: p.url, postId, depth: 0, kind: 'article-link', path: [p.url] },
      gamerLinks,
      now,
    );
    const [identities] = await pool.query<RowDataPacket[]>('SELECT candidate_id,url FROM relation_candidate_identities WHERE url IN (?)', [
      gamerLinks.map((l) => l.targetUrl),
    ]);
    check(identities.length === 2 && new Set(identities.map((i) => i.candidate_id)).size === 2);
    check(identities.every((i) => i.candidate_id !== candidates[0]));
    check(identities.find((i) => i.url.includes('alice'))?.candidate_id === candidates[1]);
    for (const row of identities) if (!candidates.includes(row.candidate_id)) candidates.push(row.candidate_id);
    return { assertions, budgetDefer: true, blockedCandidatesFree: true, repairPreservesEvidence: true };
  } finally {
    if (candidates.length) {
      await pool.query('DELETE FROM relation_candidate_identities WHERE candidate_id IN (?)', [candidates]);
      await pool.query('DELETE FROM discovery_candidates WHERE id IN (?)', [candidates]);
    }
    if (postId) {
      await pool.query('DELETE FROM relation_links WHERE source_post_id=?', [postId]);
      await pool.query('DELETE FROM relation_observations WHERE post_id=?', [postId]);
      await pool.query('DELETE FROM posts WHERE id=?', [postId]);
    }
    if (blogId) await pool.query('DELETE FROM blogs WHERE id=?', [blogId]);
    await pool.query('DELETE FROM work_budgets WHERE day=? AND scope=?', [now.toISOString().slice(0, 10), scope]);
  }
}
