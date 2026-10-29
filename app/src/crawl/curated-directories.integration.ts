import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { resolvePublicPage } from '../seo/page-routes.ts';
import { runCuratedContentBatch } from './curated-content.ts';
import { admitCuratedMember, CURATED_PAGES, INDIEPING_API, runCuratedDirectorySync, syncCuratedMembers } from './curated-directories.ts';
import { crawlBlog } from './feed.ts';

/** Disposable MariaDB only; all HTTP is injected, including the robots and DNS checks. */
export async function runCuratedDirectoryIntegration(pool: Pool) {
  assert.equal(new URL(process.env.BLOG_DB_URL!).port, '18169');
  const domains = ['english-curated.example', 'blocked-curated.example', 'rejected-curated.example', 'alias-curated.example'];
  const [existing] = await pool.execute<ResultSetHeader>(
    "INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES ('existing-curated','Keep my name',?,'verified',UTC_TIMESTAMP())",
    [`https://${domains[3]}/zh/`],
  );
  await pool.execute(
    "INSERT INTO discovery_candidates(url,name,source_type,status,discovered_at) VALUES (?,'Opt out','owner-exclusion','rejected',UTC_TIMESTAMP())",
    [`https://${domains[2]}/`],
  );
  // A URL can have several discovery sources. Sync must select the exact source row it updated.
  await pool.execute(
    "INSERT INTO discovery_candidates(url,name,source_type,status,discovered_at) VALUES (?,'Indirect link','article-link','candidate',UTC_TIMESTAMP())",
    [`https://${domains[0]}/`],
  );
  await pool.execute(
    "INSERT INTO discovery_candidates(url,name,source_type,status,discovered_at) VALUES (?,'Article URL rejected, not the publication','blogblog-club','rejected',UTC_TIMESTAMP())",
    [`https://${domains[0]}/old-post`],
  );
  let sourceDown = false;
  let repairReady = false;
  const options = {
    delayMs: 250,
    timeoutMs: 1000,
    resolveHost: async () => ['93.184.216.34'],
    fetcher: async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
      if (url === INDIEPING_API)
        return sourceDown
          ? new Response(null, { status: 503 })
          : Response.json(domains.map((domain) => ({ domain, name: 'English writer' })));
      if (url === CURATED_PAGES[0])
        return new Response(
          '<main><table><tr><td><a href="https://table-curated.example/links/">Writer</a></td></tr></table><a href="https://resource.example/">Resource</a></main>',
        );
      if (url === CURATED_PAGES[1])
        return new Response('<main><ul><li>主持人：<a href="https://host-curated.example/post/1">Host</a></li></ul></main>');
      if (repairReady && url === `https://${domains[1]}/`)
        return new Response('<html><a href="/post/1">Recovered article</a></html>', { headers: { 'content-type': 'text/html' } });
      if (repairReady && url === `https://${domains[1]}/post/1`)
        return new Response('<html><h1>Recovered article</h1><article>My actual personal writing recovered from HTML.</article></html>', {
          headers: { 'content-type': 'text/html' },
        });
      if (url === `https://${domains[0]}/`)
        return new Response(
          '<html lang="en"><title>English</title><link rel="alternate" type="application/rss+xml" href="/feed.xml"></html>',
          { headers: { 'content-type': 'text/html' } },
        );
      if (url === `https://${domains[0]}/feed.xml`)
        return new Response(
          `<rss><channel><title>A different name</title><link>https://${domains[0]}/</link><item><title>My actual article</title><guid>https://${domains[0]}/post/1</guid><link>https://${domains[0]}/post/1</link><description>Personal writing.</description></item><item><title>Not mine</title><link>https://other.example/post/1</link><guid>https://other.example/post/1</guid></item></channel></rss>`,
          { headers: { 'content-type': 'application/rss+xml' } },
        );
      return new Response(null, { status: 403 });
    },
  };
  const sync = await runCuratedDirectorySync(pool, options);
  assert.equal(sync.members, 6);
  assert.equal(sync.failures.length, 0);
  assert.equal(sync.results.filter((r) => r.status === 'approved').length, 5);
  assert.equal(sync.results.filter((r) => r.created).length, 4);
  assert.ok(sync.results.some((r) => r.reason === 'rejected_identity_preserved'));
  const [[alias]] = await pool.query<RowDataPacket[]>('SELECT name,url FROM blogs WHERE id=?', [existing.insertId]);
  assert.equal(alias.name, 'Keep my name');
  assert.equal(alias.url, `https://${domains[3]}/zh/`);
  const [blogs] = await pool.query<RowDataPacket[]>('SELECT id,slug,url FROM blogs');
  assert.equal(blogs.length, 5, 'No resource, duplicate alias, or rejected site admitted');
  for (const b of blogs) assert.ok(await resolvePublicPage(pool, 'blog', b.slug), 'Catalog route exists before content');
  const [[before]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM posts');
  assert.equal(Number(before.n), 0, 'No fabricated articles or HTTP verification during catalog admission');
  const content = await runCuratedContentBatch(pool, { ...options, limit: 10, maxDurationMs: 120000 });
  assert.equal(content.processed, 5);
  assert.equal(content.results.filter((r) => r.status === 'ready').length, 1);
  assert.equal(content.results.filter((r) => r.status === 'failed').length, 4);
  const [posts] = await pool.query<RowDataPacket[]>('SELECT url FROM posts');
  assert.deepEqual(
    posts.map((p) => p.url),
    [`https://${domains[0]}/post/1`],
    'Cross-site feed entries remain excluded',
  );
  const repeated = await runCuratedContentBatch(pool, { ...options, limit: 10 });
  assert.equal(repeated.processed, 0, 'Successful content and daily failure backoff are respected');
  const [[candidate]] = await pool.query<RowDataPacket[]>("SELECT id FROM discovery_candidates WHERE url=? AND source_type='indieping'", [
    `https://${domains[0]}/`,
  ]);
  assert.equal((await admitCuratedMember(pool, candidate.id)).reason, 'already_linked');
  sourceDown = true;
  const failedSource = await runCuratedDirectorySync(pool, options);
  assert.deepEqual(failedSource.failures, [{ page: INDIEPING_API, reason: 'http_503' }]);
  const [[retained]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM blogs');
  assert.equal(Number(retained.n), 5, 'An unavailable official directory never removes admitted members');
  const [forged] = await pool.execute<ResultSetHeader>(
    "INSERT INTO discovery_candidates(url,name,source_type,source_evidence,status,discovered_at) VALUES ('https://forged.example/','Fake','indieping',?,'candidate',UTC_TIMESTAMP())",
    [JSON.stringify({ directoryListing: { page: INDIEPING_API } })],
  );
  assert.equal((await admitCuratedMember(pool, forged.insertId)).reason, 'direct_membership_unverified');
  sourceDown = false;
  domains.push('rollback-curated.example');
  await syncCuratedMembers(pool, options);
  const [[rollback]] = await pool.query<RowDataPacket[]>(
    "SELECT id FROM discovery_candidates WHERE url='https://rollback-curated.example/'",
  );
  await pool.query(`CREATE TRIGGER curated_fixture_audit_failure BEFORE INSERT ON discovery_candidate_audits
    FOR EACH ROW BEGIN IF NEW.candidate_id=${Number(rollback.id)} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture'; END IF; END`);
  try {
    await assert.rejects(admitCuratedMember(pool, rollback.id));
    const [[afterRollback]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) n FROM blogs WHERE url='https://rollback-curated.example/'",
    );
    assert.equal(Number(afterRollback.n), 0, 'Audit failure rolls back catalog and aliases together');
    const [[state]] = await pool.query<RowDataPacket[]>('SELECT status FROM discovery_candidates WHERE id=?', [rollback.id]);
    assert.equal(state.status, 'candidate');
  } finally {
    await pool.query('DROP TRIGGER curated_fixture_audit_failure');
  }
  const concurrent = await Promise.all([admitCuratedMember(pool, rollback.id), admitCuratedMember(pool, rollback.id)]);
  assert.equal(concurrent.filter((r) => r.created).length, 1, 'Concurrent runs create one publication');
  const repaired = blogs.find((b) => b.url === `https://${domains[1]}/`)!;
  const code = `function listPosts({url,$}) { return { posts: $('a').map((i,a)=>({url:new URL($(a).attr('href'),url).href})).get(),next:null }; }
    function parsePost({$}) { return { title: $('h1').text(),bodyHtml:$('article').html(),tags:[] }; }`;
  await pool.execute(
    "INSERT INTO blog_scrapers(blog_id,status,`trigger`,code,code_sha256,list_urls,model,created_at,activated_at) VALUES (?,'active','feed_dead',?,?,?,'fixture',UTC_TIMESTAMP(),UTC_TIMESTAMP())",
    [repaired.id, code, createHash('sha256').update(code).digest('hex'), JSON.stringify([repaired.url])],
  );
  await pool.execute("INSERT INTO feed_sources(blog_id,url,type,last_success_at) VALUES (?,?,'rss',UTC_TIMESTAMP())", [
    repaired.id,
    repaired.url + 'empty-feed',
  ]);
  repairReady = true;
  const recovered = await crawlBlog({ pool }, { id: repaired.id, slug: repaired.slug, url: repaired.url }, options);
  assert.equal(recovered.posts, 1, 'An HTTP-successful empty feed cannot suppress the validated HTML repair');
  assert.equal(
    (await crawlBlog({ pool }, { id: repaired.id, slug: repaired.slug, url: repaired.url }, options)).posts,
    0,
    'Subsequent runs use the repair and preserve article deduplication',
  );
  return { qualified: 5, created: 4, articles: posts.length, preservedExclusion: true, sourceFailureRetained: true };
}
