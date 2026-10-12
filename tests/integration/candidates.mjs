import { assertEphemeralDatabase } from './guard.mjs';
import assert from 'node:assert/strict';
import { AI_POLICY, inputKey, normalizeInput } from '../../app/src/ai/contracts.ts';
import { infer } from '../../app/src/ai/service.ts';
import { validateCandidate } from '../../app/src/crawl/candidate-validation.ts';
import { recordCandidateCheck } from '../../app/src/crawl/candidate-promotion.ts';
export async function runCandidateIntegration(pool) {
  assertEphemeralDatabase(pool);
  assert.equal(new URL(process.env.BLOG_DB_URL).hostname, '127.0.0.1');
  assert.equal(new URL(process.env.BLOG_DB_URL).port, '18169');
  assert.equal(pool.pool.config.connectionConfig.port, 18169);
  const suffix = Date.now().toString(36);
  const ids = [],
    blogs = [],
    posts = [];
  let assertions = 0;
  const check = (value, message) => {
    assert.ok(value, message);
    assertions++;
  };
  const [[oldBudget]] = await pool.query("SELECT used FROM work_budgets WHERE day=UTC_DATE() AND scope='discovery:admissions'");
  await pool.query("DELETE FROM work_budgets WHERE day=UTC_DATE() AND scope='discovery:admissions'");
  const source = (home, kind = 'rss', personal = true, intro = undefined) => ({
    delayMs: 250,
    resolveHost: async () => ['93.184.216.34'],
    fetcher: async (input) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
      if (url === home)
        return new Response(
          `<title>Quill Writer</title><meta name="description" content="${intro ?? (personal === true ? 'My personal blog. About me: I am Quill Writer.' : personal === false ? 'Corporate blog newsroom.' : 'Site description:')}"><link rel="${kind === 'rss' ? 'alternate' : 'sitemap'}" type="${kind === 'rss' ? 'application/rss+xml' : 'application/xml'}" href="/${kind === 'rss' ? 'feed/' : 'sitemap.xml'}">${personal === 'comment' ? '<div id="comments"><div class="about-me">我是測試作者，這是我的個人部落格。</div></div>' : personal === 'article' ? '<article><div class="author-bio">我是測試作者，這是我的個人部落格。</div></article>' : ''}`,
          { headers: { 'content-type': 'text/html' } },
        );
      if (kind === 'rss' && url === home + 'feed/')
        return new Response(
          `<rss><channel><title>Quill Writer</title><link>${home}</link><item><title>A short old personal note</title><guid>${home}post</guid><link>${home}post</link><description>Hello</description></item></channel></rss>`,
        );
      if (kind === 'sitemap' && url === home + 'sitemap.xml') return new Response(`<urlset><url><loc>${home}post</loc></url></urlset>`);
      if (kind === 'sitemap' && url === home + 'post')
        return new Response(
          `<link rel="canonical" href="${home}post"><script type="application/ld+json">${JSON.stringify({ '@type': 'BlogPosting', url: home + 'post', headline: 'My personal reflection', author: { '@type': 'Person', name: 'Quill Writer' } })}</script>`,
        );
      return new Response(null, { status: 404 });
    },
  });
  async function candidate(
    name,
    { kind = 'rss', personal = true, intro = undefined, type = 'blogroll', home = null, evidence = { discoveryDepth: 1 } } = {},
  ) {
    home = home || `https://${name}-${suffix}.example/`;
    const [created] = await pool.execute(
      "INSERT INTO discovery_candidates(url,name,source_type,source_evidence,status,discovered_at) VALUES (?,'Quill Writer',?,?,'candidate',UTC_TIMESTAMP())",
      [home, type, JSON.stringify(evidence)],
    );
    ids.push(created.insertId);
    const result = await validateCandidate(
      { id: created.insertId, url: home, name: 'Quill Writer', status: 'candidate', source_type: type },
      source(home, kind, personal, intro),
    );
    return { home, check: result, id: created.insertId };
  }
  async function apply(item) {
    const result = await recordCandidateCheck(pool, item.check, true);
    if (result.created) blogs.push(result.blogId);
    return result;
  }
  async function used() {
    const [[row]] = await pool.query("SELECT used FROM work_budgets WHERE day=UTC_DATE() AND scope='discovery:admissions'");
    return Number(row?.used || 0);
  }
  try {
    const first = await candidate('rss');
    check(first.check.eligible, 'RSS verification ' + JSON.stringify(first.check));
    const admitted = await apply(first);
    check(admitted.created, 'RSS insert');
    check((await used()) === 1, 'first consumes one');
    const [[frozen]] = await pool.query('SELECT depth FROM relation_publications WHERE blog_id=?', [admitted.blogId]);
    check(frozen.depth === 1, 'depth frozen');
    for (const mode of ['label', 'comment', 'article']) {
      const spoof = await candidate(`spoof-${mode}`, { personal: mode });
      check(!spoof.check.eligible, `${mode} not deterministic ownership`);
      const quote = mode === 'label' ? 'Site description:' : '我是測試作者，這是我的個人部落格。';
      const answer = { classification: 'personal', confidence: 0.99, quotedEvidence: [quote], bio: '', topics: [] };
      const inference = await infer(pool, 'classification', 'candidate', spoof.id, spoof.check.personalEvidence.input, 'site-identity', {
        gateway: async () => ({ result: answer, actualModel: 'fixture' }),
      });
      check(inference.result?.classification !== 'personal', `${mode} inference cannot supply personal proof`);
      // Independent writer gate rejects unsafe cached payloads even if a preceding layer were bypassed.
      await pool.execute("UPDATE ai_results SET status='ok',result_json=? WHERE cache_key=?", [JSON.stringify(answer), inference.cacheKey]);
      spoof.check = {
        ...spoof.check,
        eligible: true,
        reason: 'fixture-forged-ai',
        personalEvidence: { ...spoof.check.personalEvidence, method: 'ai', personal: true, cacheKey: inference.cacheKey },
      };
      check((await apply(spoof)).reason === 'personal_publication_unverified', `${mode} cached proof rejected at writer`);
    }
    const genuine = await candidate('genuine-ai', { home: first.home, type: 'ai-positive-fixture' });
    const genuineAnswer = {
      classification: 'personal',
      confidence: 0.99,
      quotedEvidence: ['My personal blog. About me: I am Quill Writer.'],
      bio: '',
      topics: [],
    };
    const verifiedInference = await infer(
      pool,
      'classification',
      'candidate',
      genuine.id,
      genuine.check.personalEvidence.input,
      'site-identity',
      { gateway: async () => ({ result: genuineAnswer, actualModel: 'fixture' }) },
    );
    check(verifiedInference.result?.classification === 'personal', 'normal bio remains accepted by inference');
    genuine.check.personalEvidence = { ...genuine.check.personalEvidence, method: 'ai', cacheKey: verifiedInference.cacheKey };
    check((await apply(genuine)).reason === 'auto-approved-existing-blog', 'normal AI site bio accepted by writer');
    for (const [index, intro] of [
      'Personal blog. About me: I am Ｑｕｉｌｌ Writer. 😀 Literal \\u4e00',
      '我是阿文，這是我的個人部落格。💡 ＡＩ Literal \\u4e00',
    ].entries()) {
      const unicode = await candidate(`unicode-${index}`, { home: first.home, type: `unicode-${index}`, intro });
      check(unicode.check.eligible, 'Unicode homepage deterministic identity');
      const evidence = unicode.check.personalEvidence;
      check(normalizeInput(evidence.input) === evidence.input, 'canonical JSON remains stable after normalization');
      const answer = { classification: 'personal', confidence: 0.99, quotedEvidence: [evidence.identitySnippet], bio: '', topics: [] };
      const inferred = await infer(pool, 'classification', 'candidate', unicode.id, evidence.input, 'site-identity', {
        gateway: async () => ({ result: answer, actualModel: 'fixture' }),
      });
      check(inferred.result?.classification === 'personal', 'Unicode AI classification validated');
      const [[stored]] = await pool.query('SELECT input_hash,policy FROM ai_results WHERE cache_key=?', [inferred.cacheKey]);
      check(
        stored.input_hash === inputKey('classification', normalizeInput(evidence.input)).inputHash && stored.policy === AI_POLICY,
        'Unicode hash and policy match writer contract',
      );
      unicode.check.personalEvidence = { ...evidence, method: 'ai', cacheKey: inferred.cacheKey };
      check((await apply(unicode)).reason === 'auto-approved-existing-blog', 'Unicode AI writer proof preserved');
    }

    const nonpersonal = await candidate('company', { personal: false });
    check(!nonpersonal.check.eligible, 'company not personal');
    check((await apply(nonpersonal)).status === 'candidate', 'company retained');
    check((await used()) === 1, 'decline no admission charge');
    const bad = await candidate('badproof');
    bad.check.personalEvidence = undefined;
    const badResult = await apply(bad);
    check(badResult.reason === 'personal_publication_unverified', 'bad proof reason');
    const [[audit]] = await pool.query('SELECT COUNT(*) n FROM discovery_candidate_audits WHERE candidate_id=?', [bad.id]);
    check(audit.n === 1, 'bad proof audit');
    const manual = await candidate('manual');
    await pool.execute(
      "INSERT INTO discovery_candidate_audits(candidate_id,action,source_type,occurred_at,created_at) VALUES (?,'retain','manual',UTC_TIMESTAMP(),UTC_TIMESTAMP())",
      [manual.id],
    );
    check((await apply(manual)).status === 'manual-decision-preserved', 'manual preserved');
    const sm = await candidate('sitemap', { kind: 'sitemap' });
    check(sm.check.eligible, 'sitemap actual Person article verification');
    check(sm.check.feed?.type === 'sitemap', 'sitemap source type');
    check(sm.check.sitemapArticles?.[0].publishedAt === null, 'no date guessed');
    check((await apply(sm)).created, 'sitemap insert');
    const [p] = await pool.execute('INSERT INTO posts(blog_id,guid,url,title,created_at) VALUES (?,?,?,?,UTC_TIMESTAMP())', [
      admitted.blogId,
      first.home + 'source',
      first.home + 'source',
      'Source article',
    ]);
    posts.push(p.insertId);
    const parentEvidence = {
      sourceBlogId: admitted.blogId,
      sourcePostId: p.insertId,
      location: 'body',
      sourceArticleUrl: first.home + 'source',
    };
    const mismatch = await candidate('depth-bad', { type: 'article-link', evidence: { ...parentEvidence, discoveryDepth: 1 } });
    check((await apply(mismatch)).reason === 'discovery_depth_mismatch', 'parent depth checked');
    const child = await candidate('depth-ok', { type: 'article-link', evidence: { ...parentEvidence, discoveryDepth: 2 } });
    check((await apply(child)).created, 'valid child insert');
    const roll = await candidate('blogroll', {
      evidence: {
        sourceBlogId: admitted.blogId,
        sourcePostId: null,
        sourcePageUrl: first.home + 'blogroll',
        location: 'blogroll',
        discoveryDepth: 2,
      },
    });
    check((await apply(roll)).created, 'blogroll noPost valid source page');
    const badPage = await candidate('blogroll-outside', {
      evidence: {
        sourceBlogId: admitted.blogId,
        sourcePostId: null,
        sourcePageUrl: 'https://outside.example/roll',
        location: 'blogroll',
        discoveryDepth: 2,
      },
    });
    check((await apply(badPage)).reason === 'discovery_parent_page_mismatch', 'blogroll outside page denied');
    check((await used()) === 4, 'only four new blogs consumed');
    const duplicate = await candidate('alias', { home: first.home, type: 'blogblog-club' });
    check((await apply(duplicate)).reason === 'auto-approved-existing-blog', 'existing identity reused');
    check((await used()) === 4, 'duplicate no budget charge');
    for (let i = 0; i < 6; i++) check((await apply(await candidate(`fill-${i}`))).created, `daily slot ${i}`);
    check((await used()) === 10, 'daily exactly ten');
    const exhausted = await candidate('exhausted');
    check((await apply(exhausted)).reason === 'daily_admission_budget_exhausted', 'eleventh retained');
    check((await used()) === 10, 'never exceeds ten');
    const reused = await candidate('alias2', { home: first.home, type: 'integration-existing' });
    check((await apply(reused)).reason === 'auto-approved-existing-blog', 'reuse still works when daily full');
    check((await used()) === 10, 'full quota reuse uncharged');
    const concurrent = await candidate('concurrent', { home: first.home, type: 'integration-concurrent' });
    const blocker = await pool.getConnection();
    await blocker.beginTransaction();
    await blocker.query('SELECT id FROM blogs WHERE id=? FOR UPDATE', [admitted.blogId]);
    const began = Date.now();
    const pending = recordCandidateCheck(pool, concurrent.check, true);
    await new Promise((r) => setTimeout(r, 150));
    await blocker.commit();
    blocker.release();
    const simultaneous = await pending;
    check(simultaneous.reason === 'auto-approved-existing-blog', 'admission waits safely for crawler row');
    check(Date.now() - began < 5000, 'bounded concurrent lock wait');
    return {
      assertions,
      concurrentLockWaitMs: Date.now() - began,
      newBlogs: blogs.length,
      rss: true,
      sitemap: true,
      manualPreserved: true,
      invalidEvidenceAudited: true,
      parentDepth: true,
      blogrollNoPost: true,
      dailyLimit: 10,
      duplicateUncharged: true,
    };
  } finally {
    if (posts.length) await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    if (blogs.length) {
      await pool.query('DELETE FROM feed_sources WHERE blog_id IN (?)', [blogs]);
      await pool.query('DELETE FROM blog_urls WHERE blog_id IN (?)', [blogs]);
      await pool.query('DELETE FROM relation_publications WHERE blog_id IN (?)', [blogs]);
      await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
    }
    if (ids.length) {
      await pool.query("DELETE FROM ai_results WHERE entity_type='candidate' AND entity_id IN (?)", [ids]);
      await pool.query('DELETE FROM discovery_candidate_audits WHERE candidate_id IN (?)', [ids]);
      await pool.query('DELETE FROM discovery_candidates WHERE id IN (?)', [ids]);
    }
    await pool.query("DELETE FROM work_budgets WHERE day=UTC_DATE() AND scope='discovery:admissions'");
    if (oldBudget)
      await pool.execute(
        "INSERT INTO work_budgets(day,scope,used,updated_at) VALUES(UTC_DATE(),'discovery:admissions',?,UTC_TIMESTAMP())",
        [oldBudget.used],
      );
  }
}
