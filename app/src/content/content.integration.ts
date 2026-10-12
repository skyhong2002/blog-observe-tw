/** Real SQL fixtures; caller supplies a disposable migrated database, never production. */
import assert from 'node:assert/strict';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { runRelationBatch } from '../relations/worker.ts';
import type { ContentEvidence } from './contracts.ts';
import { ingestContentEvidence, initializeContentRules, storedRelationContent } from './store.ts';
import { runContentBatch } from './worker.ts';
export async function runContentIntegration(pool: Pool) {
  const suffix = Date.now().toString(36),
    now = new Date(),
    blogs: number[] = [],
    posts: number[] = [];
  let assertions = 0;
  const check = (v: unknown) => {
    assert.ok(v);
    assertions++;
  };
  const home = `https://content-${suffix}.example/`,
    target = `https://target-${suffix}.example/`;
  try {
    for (const [name, url] of [
      ['Source', home],
      ['Target', target],
      ['Empty', `https://empty-${suffix}.example/`],
    ]) {
      const [row] = await pool.query<ResultSetHeader>(
        "INSERT INTO blogs(slug,name,url,status,status_label,discovered_at)VALUES(?,?,?,'verified','fixture',?)",
        [`content-${name.toLowerCase()}-${suffix}`, name, url, now],
      );
      blogs.push(row.insertId);
    }
    for (const [path, date] of [
      ['rss', '2098-01-01'],
      ['html', '2099-01-01'],
    ]) {
      const [r] = await pool.query<ResultSetHeader>(
        'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at)VALUES(?,?,?,?,?,?)',
        [blogs[0], home + path, home + path, 'fixture', date, now],
      );
      posts.push(r.insertId);
    }
    await initializeContentRules(pool, now);
    const [[empty]] = await pool.query<RowDataPacket[]>('SELECT last_status,last_success_at FROM content_blog_rules WHERE blog_id=?', [
      blogs[2],
    ]);
    check(empty.last_status === 'no-posts' && empty.last_success_at === null);
    const base: ContentEvidence = {
      blogId: blogs[0],
      blogUrl: home,
      postId: posts[0],
      articleUrl: home + 'rss',
      sourceUrl: home + 'feed',
      kind: 'rss-content',
      completeness: 'full',
      html: `<p>短文<a href="${target}post">朋友</a></p>`,
      modifiedAt: new Date('2026-01-10'),
      obtainedAt: now,
    };
    const ingest = async (e: ContentEvidence) => {
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const r = await ingestContentEvidence(c, e, now);
        await c.commit();
        return r;
      } catch (e) {
        await c.rollback();
        throw e;
      } finally {
        c.release();
      }
    };
    const first = await ingest(base);
    check(first.status === 'ok' && first.changed);
    const same = await ingest(base);
    check(!same.changed && same.hash === first.hash);
    let [[body]] = await pool.query<RowDataPacket[]>('SELECT * FROM content_post_bodies WHERE post_id=?', [posts[0]]);
    check(Number(body.revision) === 1 && body.body_text.includes('短文') && body.coverage === 'syndicated-body-only');
    const partial = await ingest({ ...base, html: '摘要', completeness: 'partial' });
    check(!partial.changed && partial.hash === first.hash);
    await ingest({ ...base, html: '<p>新版全文</p>', modifiedAt: null });
    const old = await ingest({ ...base, html: '<p>舊版全文</p>', modifiedAt: new Date('2026-01-09') });
    check(!old.changed);
    [[body]] = await pool.query<RowDataPacket[]>('SELECT * FROM content_post_bodies WHERE post_id=?', [posts[0]]);
    check(body.body_text === '新版全文' && new Date(body.source_updated_at).toISOString().startsWith('2026-01-10'));
    await ingest({ ...base, html: base.html, modifiedAt: new Date('2026-01-11') });
    const stored = await storedRelationContent(pool, posts[0], blogs[0], [
      { blogId: blogs[0], url: home },
      { blogId: blogs[1], url: target },
    ]);
    check(stored?.parsed.links[0]?.targetBlogId === blogs[1] && stored?.parsed.extraction.startsWith('content:rss-content:'));
    await pool.query('UPDATE content_post_bodies SET page_links=NULL WHERE post_id=?', [posts[0]]);
    check(
      (
        await storedRelationContent(pool, posts[0], blogs[0], [
          { blogId: blogs[0], url: home },
          { blogId: blogs[1], url: target },
        ])
      )?.parsed.links[0]?.targetBlogId === blogs[1],
    );
    const beforePriority = (
      await pool.query<RowDataPacket[]>('SELECT content_hash FROM content_post_bodies WHERE post_id=?', [posts[0]])
    )[0][0].content_hash;
    await ingest({
      ...base,
      kind: 'article-html',
      sourceUrl: base.articleUrl,
      html: '<link rel="https://api.w.org/" href="/wp-json/"><div class="entry-content">HTML較短版本</div>',
    });
    let [[rule]] = await pool.query<RowDataPacket[]>('SELECT platform,rules FROM content_blog_rules WHERE blog_id=?', [blogs[0]]);
    check(rule.platform === 'generic' && !JSON.stringify(rule.rules).includes('apiBase'));
    check(
      (await pool.query<RowDataPacket[]>('SELECT content_hash FROM content_post_bodies WHERE post_id=?', [posts[0]]))[0][0].content_hash ===
        beforePriority,
    );
    await ingest({
      ...base,
      kind: 'article-html',
      sourceUrl: base.articleUrl,
      html: '<link rel="canonical" href="/other"><link rel="https://api.w.org/" href="/wp-json/"><article>錯文</article>',
    });
    [[rule]] = await pool.query<RowDataPacket[]>('SELECT platform,rules FROM content_blog_rules WHERE blog_id=?', [blogs[0]]);
    check(rule.platform === 'generic' && !JSON.stringify(rule.rules).includes('apiBase'));
    // Withdrawn/moved sites cannot race a previously-started fetch into the current generation.
    await pool.query("UPDATE blogs SET status='moved' WHERE id=?", [blogs[0]]);
    check((await ingest(base)).status === 'publication-changed');
    await pool.query("UPDATE blogs SET status='verified' WHERE id=?", [blogs[0]]);
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      await ingestContentEvidence(c, { ...base, html: '<p>應回滾</p>', modifiedAt: new Date('2026-01-12') }, now);
      await c.rollback();
    } finally {
      c.release();
    }
    [[body]] = await pool.query<RowDataPacket[]>('SELECT * FROM content_post_bodies WHERE post_id=?', [posts[0]]);
    check(body.body_text.includes('短文'));
    // HTML fetch is stored once; relation projection consumes that exact normalized body without any HTTP.
    let requests = 0;
    const fetcher = async (input: unknown) => {
      requests++;
      const url = String(input);
      return new Response(
        url.endsWith('/robots.txt')
          ? 'User-agent: *\nAllow: /'
          : `<article>HTML正文<a href="${target}post">朋友</a><div class="blogroll"><a href="https://roll-${suffix}.example/">友站</a></div></article>`,
        { headers: { 'content-type': url.endsWith('/robots.txt') ? 'text/plain' : 'text/html' } },
      );
    };
    const fetched = await runContentBatch(pool, {
      limit: 1,
      blogId: blogs[0],
      now: () => now,
      resolveHost: async () => ['93.184.216.34'],
      fetcher,
      delayMs: 250,
    });
    check(fetched.processed === 1 && requests === 2);
    [[body]] = await pool.query<RowDataPacket[]>('SELECT * FROM content_post_bodies WHERE post_id=?', [posts[1]]);
    check(body.status === 'ok' && body.body_text === 'HTML正文朋友');
    let repeated = 0;
    const projected = await runRelationBatch(pool, {
      limit: 1,
      blogId: blogs[0],
      now: () => now,
      fetcher: async () => {
        repeated++;
        throw Error('unexpected HTTP');
      },
    });
    check(projected.processed === 1 && repeated === 0);
    const [links] = await pool.query<RowDataPacket[]>('SELECT location FROM relation_links WHERE source_post_id=?', [posts[1]]);
    check(links.some((l) => l.location === 'body') && links.some((l) => l.location === 'blogroll'));
    const [[o]] = await pool.query<RowDataPacket[]>('SELECT body_text,extraction FROM relation_observations WHERE post_id=?', [posts[1]]);
    check(o.body_text === 'HTML正文朋友' && o.extraction.startsWith('content:article-html:'));
    const [[attempts]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM content_attempts WHERE post_id=?', [posts[0]]);
    check(Number(attempts.count) <= 20);
    const [partialPost] = await pool.query<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at)VALUES(?,?,?,?,?,?)',
      [blogs[0], home + 'partial', home + 'partial', 'fixture', '2100-01-01', now],
    );
    posts.push(partialPost.insertId);
    const partialEvidence: ContentEvidence = {
      ...base,
      postId: partialPost.insertId,
      articleUrl: home + 'partial',
      sourceUrl: home + 'partial',
      kind: 'article-html',
      html: '<article>預覽文字 訂閱後閱讀全文</article>',
    };
    await ingest(partialEvidence);
    const [[stable]] = await pool.query<RowDataPacket[]>('SELECT status,next_attempt_at FROM content_post_bodies WHERE post_id=?', [
      partialPost.insertId,
    ]);
    check(stable.status === 'partial' && new Date(stable.next_attempt_at).getTime() > now.getTime() + 29 * 86400000);
    await pool.query('UPDATE content_post_bodies SET next_attempt_at=? WHERE post_id=?', [now, partialPost.insertId]);
    const holder = await pool.getConnection();
    let signalNetwork!: () => void, releaseResponse!: () => void;
    const networkReached = new Promise<void>((r) => (signalNetwork = r)),
      responseReady = new Promise<void>((r) => (releaseResponse = r));
    let workerDone = false;
    const failedWorker = runContentBatch(pool, {
      blogId: blogs[0],
      limit: 1,
      now: () => now,
      resolveHost: async () => ['93.184.216.34'],
      fetcher: async () => {
        signalNetwork();
        await responseReady;
        return new Response('unavailable', { status: 404 });
      },
      delayMs: 250,
    }).finally(() => {
      workerDone = true;
    });
    try {
      await networkReached;
      await holder.beginTransaction();
      await holder.query('SELECT id FROM blogs WHERE id=? FOR UPDATE', [blogs[0]]);
      await holder.query('SELECT post_id FROM content_post_bodies WHERE post_id=? FOR UPDATE', [posts[0]]);
      await holder.query('SELECT blog_id FROM content_blog_rules WHERE blog_id=? FOR UPDATE', [blogs[0]]);
      releaseResponse();
      await new Promise((r) => setTimeout(r, 50));
      check(!workerDone);
      // A multi-post feed transaction can update its second body while failure writer waits on blog first.
      await holder.query('UPDATE content_post_bodies SET last_error=NULL WHERE post_id=?', [partialPost.insertId]);
      await holder.commit();
      await failedWorker;
      check(workerDone);
    } finally {
      releaseResponse();
      await holder.rollback();
      holder.release();
      await failedWorker;
    }
    await ingest({ ...partialEvidence, html: '<nav>沒有正文</nav>' });
    const [[retainedPartial]] = await pool.query<RowDataPacket[]>('SELECT status,body_text FROM content_post_bodies WHERE post_id=?', [
      partialPost.insertId,
    ]);
    check(retainedPartial.status === 'partial' && retainedPartial.body_text.includes('預覽文字'));
    return { assertions, zeroDuplicateHttp: true, fullTextPreserved: true, atomicRollback: true, withdrawalChecked: true };
  } finally {
    if (posts.length) {
      await pool.query('DELETE FROM content_attempts WHERE post_id IN (?)', [posts]);
      await pool.query('DELETE FROM content_post_bodies WHERE post_id IN (?)', [posts]);
      await pool.query('DELETE FROM relation_links WHERE source_post_id IN (?)', [posts]);
      await pool.query('DELETE FROM relation_observations WHERE post_id IN (?)', [posts]);
      await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    }
    if (blogs.length) {
      await pool.query('DELETE FROM content_blog_rules WHERE blog_id IN (?)', [blogs]);
      await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
    }
    const [candidates] = await pool.query<RowDataPacket[]>('SELECT id FROM discovery_candidates WHERE source_url IN (?)', [
      [home + 'html', home + 'rss'],
    ]);
    if (candidates.length) {
      const ids = candidates.map((r) => r.id);
      await pool.query('DELETE FROM relation_candidate_identities WHERE candidate_id IN (?)', [ids]);
      await pool.query('DELETE FROM discovery_candidates WHERE id IN (?)', [ids]);
    }
    await pool.query('DELETE FROM relation_snapshots');
  }
}
