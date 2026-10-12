/** Run only against an isolated restored database; this suite deliberately writes fixture rows. */
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { recordCandidateCheck } from '../crawl/candidate-promotion.ts';
import { type DiscoveryCandidate, validateCandidate } from '../crawl/candidate-validation.ts';
import { parsePublicationBlogroll, runPublicationDiscoveryBatch, saveHomeSweep } from './home.ts';
import { parseArticleLinks } from './parser.ts';
import { loadRelationCoverage, loadRelations, registerRelationRoutes } from './routes.ts';
import { type ArticleRow, discoverCandidates, loadAliases, reconcileTargets, retainFailedObservation, saveObservation } from './store.ts';
import { budgetedRelationFetcher } from './worker.ts';

export async function runRelationIntegration(pool: Pool) {
  const configuredPort = (pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool?.config?.connectionConfig
    ?.port;
  if (configuredPort !== 18169) throw Error('relation integration requires the isolated test database on port 18169');
  const suffix = Date.now().toString(36);
  const now = new Date('2040-10-12T00:00:00Z');
  const blogIds: number[] = [];
  const postIds: number[] = [];
  const unknown = `https://unknown-${suffix}.example/`;
  const homeUnknown = `https://home-${suffix}.example/`;
  let assertions = 0;
  const check = (value: unknown) => {
    assert.ok(value);
    assertions++;
  };
  const app = Fastify();
  try {
    for (const name of ['a', 'b']) {
      const [row] = await pool.query<ResultSetHeader>(
        `INSERT INTO blogs (slug,name,url,status,status_label,discovered_at) VALUES (?,?,?,'verified','已核對',?)`,
        [`relation-fixture-${name}-${suffix}`, `Relation ${name}`, `https://${name}-${suffix}.example/`, now],
      );
      blogIds.push(row.insertId);
    }
    const [a, b] = blogIds;
    const sourceUrl = `https://a-${suffix}.example/post`;
    const targetUrl = `https://b-${suffix}.example/post`;
    for (const [blogId, url] of [
      [a, sourceUrl],
      [b, targetUrl],
    ] as const) {
      const [row] = await pool.query<ResultSetHeader>(
        `INSERT INTO posts (blog_id,guid,url,title,published_at,created_at) VALUES (?,?,?,?,?,?)`,
        [blogId, url, url, 'fixture', new Date(now.getTime() - 86400000), now],
      );
      postIds.push(row.insertId);
    }
    const aliases = await loadAliases(pool);
    const post: ArticleRow = {
      id: postIds[0],
      blog_id: a,
      url: sourceUrl,
      published_at: new Date(now.getTime() - 86400000),
      blog_url: `https://a-${suffix}.example/`,
      depth: 0,
    };
    const html = `<article><p>A <a href="${targetUrl}">B</a><a href="${targetUrl}">B again</a><a href="${unknown}entry">Unknown article</a></p><aside><a href="https://sidebar-${suffix}.example/">Sidebar</a></aside></article>`;
    const parsed = parseArticleLinks(html, sourceUrl, a, aliases);
    const response = new Response(html, { headers: { 'content-type': 'text/html', etag: '"fixture"' } });
    await saveObservation(pool, post, parsed, response, now);
    await saveObservation(pool, post, parsed, response, now);
    const [[links]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM relation_links WHERE source_post_id=?', [post.id]);
    check(Number(links.count) === 4);
    const [[resolved]] = await pool.query<RowDataPacket[]>(
      'SELECT target_post_id FROM relation_links WHERE source_post_id=? AND target_blog_id=? LIMIT 1',
      [post.id, b],
    );
    check(Number(resolved.target_post_id) === postIds[1]);
    const first = await loadRelations(pool, 7, now);
    check(first.edges.some((e) => e.sourceBlogId === a && e.targetBlogId === b && e.count === 1 && e.share === 1));
    await retainFailedObservation(pool, post, 'http-403', now);
    const [[failed]] = await pool.query<RowDataPacket[]>(
      'SELECT body_text,status,last_success_at FROM relation_observations WHERE post_id=?',
      [post.id],
    );
    check(failed.status === 'failed' && failed.body_text && failed.last_success_at);
    const retained = await loadRelations(pool, 7, now);
    check(retained.edges.some((e) => e.sourceBlogId === a && e.targetBlogId === b));
    await saveObservation(pool, post, parsed, response, now);
    check((await discoverCandidates(pool, { ...post, depth: 2 }, parsed, now)) === 1);
    check((await discoverCandidates(pool, post, parsed, now)) === 0);
    const [[candidate]] = await pool.query<RowDataPacket[]>('SELECT id,status,source_evidence FROM discovery_candidates WHERE url=?', [
      unknown,
    ]);
    check(candidate.status === 'candidate');
    const evidence = typeof candidate.source_evidence === 'string' ? JSON.parse(candidate.source_evidence) : candidate.source_evidence;
    check(evidence.discoveryDepth === 1 && evidence.requiresIdentityEnrichment && evidence.sourcePostId === post.id);
    check(evidence.linkDiscovery.discoveryDepth === 1 && evidence.linkDiscovery.sourcePostId === post.id);
    check(
      (await discoverCandidates(
        pool,
        { ...post, depth: 3 },
        parseArticleLinks(`<article><a href="https://depth-${suffix}.example/">Deep</a></article>`, sourceUrl, a, aliases),
        now,
      )) === 0,
    );
    const [[budget]] = await pool.query<RowDataPacket[]>(
      "SELECT used FROM work_budgets WHERE day='2040-10-12' AND scope='relations:candidates'",
    );
    check(Number(budget.used) >= 1);
    const profileCoverage = await loadRelationCoverage(pool, a);
    check(profileCoverage.totalPosts === 1 && profileCoverage.observedPosts === 1 && profileCoverage.unresolvedLinks === 1);
    // Later identity resolution uses retained links, no new crawl and no loss of original target URL.
    await pool.query('UPDATE relation_links SET resolution_checked_at=? WHERE source_post_id=?', [
      new Date(now.getTime() - 86400000),
      post.id,
    ]);
    check((await reconcileTargets(pool, [...aliases, { blogId: b, url: unknown }], now)) >= 1);
    let networkCalls = 0;
    const fetcher = budgetedRelationFetcher(
      pool,
      {
        now: () => now,
        fetcher: async () => {
          networkCalls++;
          return new Response('ok');
        },
      },
      async () => {},
      Date.now() + 60000,
    );
    for (let i = 0; i < 20; i++) await fetcher(`https://budget-${suffix}.example/robots.txt`);
    await assert.rejects(() => fetcher(`https://budget-${suffix}.example/redirect`), /relation_http_budget/);
    assertions++;
    check(networkCalls === 20);
    await registerRelationRoutes(app, pool);
    const profile = await app.inject({ method: 'GET', url: `/api/blogs/relation-fixture-a-${suffix}/relations` });
    check(profile.statusCode === 200 && profile.json().coverage.totalPosts === 1);
    check(!profile.body.includes('body_text') && !profile.body.includes('bodyText') && !profile.body.includes('context'));
    const invalid = await app.inject({ method: 'GET', url: '/api/relations?days=999' });
    check(invalid.statusCode === 400);
    const missing = await app.inject({ method: 'GET', url: `/api/blogs/missing-${suffix}/relations` });
    check(missing.statusCode === 404);
    await pool.query("UPDATE blogs SET status='moved' WHERE id=?", [b]);
    await pool.query('UPDATE relation_links SET resolution_checked_at=? WHERE source_post_id=?', [
      new Date(now.getTime() - 86400000),
      post.id,
    ]);
    await reconcileTargets(
      pool,
      [...aliases.filter((alias) => alias.blogId !== b), { blogId: a, url: `https://b-${suffix}.example/` }],
      now,
    );
    const [[moved]] = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) count FROM relation_links WHERE source_post_id=? AND target_blog_id=?',
      [post.id, b],
    );
    check(Number(moved.count) === 0);
    const homeCalls: string[] = [];
    const homeResult = await runPublicationDiscoveryBatch(pool, {
      now: () => now,
      delayMs: 250,
      resolveHost: async () => ['8.8.8.8'],
      fetcher: async (input) => {
        const url = new URL(String(input));
        homeCalls.push(url.href);
        if (url.pathname === '/robots.txt') return new Response('', { status: 404 });
        const body =
          url.pathname === '/blogroll'
            ? `<main><h1>部落卷</h1><a href="${homeUnknown}">New personal blog</a></main>`
            : `<nav><a href="/blogroll">Blogroll</a></nav><div class="blogroll"><a href="${unknown}">Existing</a></div><aside><a href="https://not-blogroll-${suffix}.example/">Ignore</a></aside>`;
        return new Response(body, { headers: { 'content-type': 'text/html' } });
      },
    });
    check(homeResult.processed === 1);
    check(
      homeCalls.every((url) =>
        [new URL(sourceUrl).origin + '/', new URL(sourceUrl).origin + '/robots.txt', new URL(sourceUrl).origin + '/blogroll'].includes(url),
      ),
    );
    const [[homeScan]] = await pool.query<RowDataPacket[]>('SELECT status,child_url FROM relation_home_scans WHERE blog_id=?', [a]);
    check(homeScan.status === 'ok' && homeScan.child_url === new URL(sourceUrl).origin + '/blogroll');
    const [[homeCount]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM relation_home_links WHERE blog_id=?', [a]);
    check(Number(homeCount.count) === 2);
    const [[homeCandidate]] = await pool.query<RowDataPacket[]>(
      'SELECT source_type,source_evidence FROM discovery_candidates WHERE url=?',
      [homeUnknown],
    );
    const homeEvidence =
      typeof homeCandidate.source_evidence === 'string' ? JSON.parse(homeCandidate.source_evidence) : homeCandidate.source_evidence;
    check(
      homeCandidate.source_type === 'blogroll' &&
        homeEvidence.sourcePostId === null &&
        homeEvidence.sourceBlogId === a &&
        homeEvidence.discoveryDepth === 1 &&
        /^[a-f0-9]{64}$/.test(homeEvidence.bodySha256),
    );
    check(homeEvidence.path.length === 3 && homeEvidence.sourcePageUrl.endsWith('/blogroll'));
    const homeCoverage = await loadRelationCoverage(pool, a);
    check(homeCoverage.nonBodyLinks.blogroll === 2);
    const [[afterHomeBudget]] = await pool.query<RowDataPacket[]>(
      "SELECT used FROM work_budgets WHERE day='2040-10-12' AND scope='relations:candidates'",
    );
    check(Number(afterHomeBudget.used) === Number(budget.used) + 1);
    const homeUrl = new URL(sourceUrl).origin + '/';
    const childOld = homeUrl + 'blogroll',
      childNew = homeUrl + 'new-blogroll';
    const parsedHome = parsePublicationBlogroll(`<div class="blogroll"><a href="${unknown}">Existing</a></div>`, homeUrl, a, aliases);
    const parsedChild = parsePublicationBlogroll(
      `<main><h1>部落卷</h1><a href="${homeUnknown}">New</a></main>`,
      childOld,
      a,
      aliases,
      true,
    );
    const homePage = { sourceUrl: homeUrl, parsed: parsedHome, path: [homeUrl] };
    const childPage = { sourceUrl: childOld, parsed: parsedChild, path: [homeUrl, childOld] };
    const scan = { etag: '"fixture-home"', modified: null, childUrl: childOld, truncated: false };
    const pages = async () => {
      const [r] = await pool.query<RowDataPacket[]>(
        'SELECT DISTINCT source_page_url FROM relation_home_links WHERE blog_id=? ORDER BY source_page_url',
        [a],
      );
      return r.map((x) => x.source_page_url);
    };
    await saveHomeSweep(pool, a, [homePage], { ...scan, childUrl: null }, now);
    check(JSON.stringify(await pages()) === JSON.stringify([homeUrl]));
    await saveHomeSweep(pool, a, [homePage, childPage], scan, now);
    await saveHomeSweep(
      pool,
      a,
      [homePage, { ...childPage, sourceUrl: childNew, path: [homeUrl, childNew] }],
      { ...scan, childUrl: childNew },
      now,
    );
    check((await pages()).includes(childNew) && !(await pages()).includes(childOld));
    const renamed = homeUrl + 'renamed-home';
    await saveHomeSweep(pool, a, [{ ...homePage, sourceUrl: renamed }], { ...scan, childUrl: null }, now);
    check(JSON.stringify(await pages()) === JSON.stringify([renamed]));
    await saveHomeSweep(pool, a, [homePage, childPage], scan, now);
    // Limit only the fixture selection; all other SQL and transactional writes use the real clone.
    const scopedPool = new Proxy(pool, {
      get(target, key) {
        if (key === 'query')
          return (sql: string, params?: unknown[]) =>
            sql.startsWith('SELECT b.id,b.url,COALESCE(p.depth,0) depth,s.etag')
              ? target.query(
                  `SELECT b.id,b.url,COALESCE(p.depth,0) depth,s.etag,s.last_modified,s.child_url FROM blogs b LEFT JOIN relation_publications p ON p.blog_id=b.id LEFT JOIN relation_home_scans s ON s.blog_id=b.id WHERE b.id=?`,
                  [a],
                )
              : target.query(sql, params);
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const partial = await runPublicationDiscoveryBatch(scopedPool, {
      now: () => now,
      delayMs: 250,
      resolveHost: async () => ['8.8.8.8'],
      fetcher: async (input) =>
        new URL(String(input)).pathname === '/' ? new Response(null, { status: 304 }) : new Response('', { status: 404 }),
    });
    check(partial.skipped === 1);
    const [[partialScan]] = await pool.query<RowDataPacket[]>(
      'SELECT status,etag,child_url,last_success_at FROM relation_home_scans WHERE blog_id=?',
      [a],
    );
    check(partialScan.status === 'partial' && partialScan.etag === null && partialScan.child_url === null && partialScan.last_success_at);
    check((await pages()).length === 2);
    check((await loadRelationCoverage(pool, a)).nonBodyLinks.blogroll === 0);
    let conditional = false;
    const recovered = await runPublicationDiscoveryBatch(scopedPool, {
      now: () => now,
      delayMs: 250,
      resolveHost: async () => ['8.8.8.8'],
      fetcher: async (input, init) => {
        conditional ||= new Headers(init?.headers).has('if-none-match');
        check(new URL(String(input)).pathname === '/');
        return new Response(`<div class="blogroll"><a href="${unknown}">Existing</a></div>`, { headers: { 'content-type': 'text/html' } });
      },
    });
    check(recovered.processed === 1 && !conditional);
    check(JSON.stringify(await pages()) === JSON.stringify([homeUrl]));
    const [[actualCandidate]] = await pool.query<RowDataPacket[]>('SELECT * FROM discovery_candidates WHERE url=?', [homeUnknown]);
    const checked = await validateCandidate(actualCandidate as DiscoveryCandidate, {
      delayMs: 250,
      resolveHost: async () => ['8.8.8.8'],
      fetcher: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === '/robots.txt') return new Response('', { status: 404 });
        if (url.pathname === '/')
          return new Response(
            '<meta name="description" content="Personal blog. About me: I am Quill Writer."><title>Quill Writer</title><link rel="alternate" type="application/rss+xml" href="/feed/">',
            { headers: { 'content-type': 'text/html' } },
          );
        if (url.pathname === '/feed/')
          return new Response(
            `<rss version="2.0"><channel><title>Quill Writer</title><link>${homeUnknown}</link><item><title>Old article</title><link>${homeUnknown}post</link><guid>old-post</guid></item></channel></rss>`,
            { headers: { 'content-type': 'application/rss+xml' } },
          );
        return new Response('', { status: 404 });
      },
    });
    check(checked.eligible);
    const admitted = await recordCandidateCheck(pool, checked, true);
    if ('blogId' in admitted && admitted.blogId) blogIds.push(admitted.blogId);
    check(admitted.status === 'approved');
    const [[admissionDepth]] = await pool.query<RowDataPacket[]>(
      'SELECT depth,source_candidate_id FROM relation_publications WHERE blog_id=?',
      [blogIds[2]],
    );
    check(Number(admissionDepth.depth) === 1 && Number(admissionDepth.source_candidate_id) === actualCandidate.id);
    return { assertions, fixturePosts: postIds.length, networkCalls, result: 'passed' };
  } finally {
    await app.close();
    if (postIds.length) {
      await pool.query('DELETE FROM relation_links WHERE source_post_id IN (?)', [postIds]);
      await pool.query('DELETE FROM relation_observations WHERE post_id IN (?)', [postIds]);
      await pool.query('DELETE FROM posts WHERE id IN (?)', [postIds]);
    }
    await pool.query('DELETE FROM relation_candidate_identities WHERE url IN (?)', [[unknown, homeUnknown]]);
    await pool.query('DELETE a FROM discovery_candidate_audits a JOIN discovery_candidates d ON d.id=a.candidate_id WHERE d.url IN (?)', [
      [unknown, homeUnknown],
    ]);
    await pool.query('DELETE FROM discovery_candidates WHERE url IN (?)', [[unknown, homeUnknown]]);
    if (blogIds.length) {
      await pool.query('DELETE FROM relation_home_links WHERE blog_id IN (?)', [blogIds]);
      await pool.query('DELETE FROM relation_home_scans WHERE blog_id IN (?)', [blogIds]);
    }
    if (blogIds.length) {
      await pool.query('DELETE FROM relation_publications WHERE blog_id IN (?)', [blogIds]);
      await pool.query('DELETE FROM feed_sources WHERE blog_id IN (?)', [blogIds]);
      await pool.query('DELETE FROM blog_urls WHERE blog_id IN (?)', [blogIds]);
      await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogIds]);
    }
  }
}
