import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { CONTENT_VERSION } from '../content/contracts.ts';
import { CLEANUP_VERSION } from './matching-body.ts';
import { digest, MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { SOURCE } from './snapshot-client.ts';
import { STAGED_PROOF_VERSION } from './staged-scan-proof.ts';
import { enrollStagedScanProof, runStagedScanBatch, startStagedScan } from './staged-scan-v2.ts';
/** Synthetic generation-local proof SQL. Root executes only guarded disposable18169. */
export async function runStagedScanProofIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const [[existing]] = await pool.query<RowDataPacket[]>('SELECT id FROM posts LIMIT 1');
  assert.ok(!existing, 'proof fixture needs empty disposable corpus');
  const target = randomUUID(),
    window = randomUUID(),
    now = new Date(),
    manifest = JSON.stringify({ coverage: 'all-current-indexed-article-tags' }),
    selection = digest(target),
    label = '蛤蜊絲瓜',
    term = digest(label),
    blogs: number[] = [],
    posts: number[] = [],
    runs: string[] = [],
    events: string[] = [];
  let checks = 0,
    rrIssuedTransactions = 0,
    rrBehaviorProbes = 0;
  const pins = {
    target,
    manifestSha256: createHash('sha256').update(manifest).digest('hex'),
    policyVersion: POLICY_VERSION,
    selectionId: selection,
    matcherVersion: MATCHER_VERSION,
    cleanupVersion: CLEANUP_VERSION,
  };
  const controls = { enabled: true, proofMode: STAGED_PROOF_VERSION, now: () => now };
  const check = (v: unknown, m: string) => {
    try {
      assert.ok(v, m);
    } catch (e) {
      if (e && typeof e === 'object') Object.defineProperty(e, 'testOrdinal', { value: checks + 1 });
      throw e;
    }
    checks++;
  };
  const dto = (x: unknown) => x as Record<string, unknown>;
  const [[previous]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
  const create = async (kind: string) => {
    const slug = `proof-${randomUUID()}`,
      home = `https://${slug}.example/`,
      url = `${home}post?id=1`,
      title = kind === 'zero' ? '沒有詞語' : label;
    const [b] = await pool.execute<ResultSetHeader>("INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES(?,?,?,'verified',?)", [
      slug,
      slug,
      home,
      now,
    ]);
    blogs.push(b.insertId);
    const [p] = await pool.execute<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,summary,content_hash,published_at,created_at) VALUES(?,?,?,?,?,?,NULL,?)',
      [b.insertId, randomUUID(), url, title, null, digest('metadata'), now],
    );
    posts.push(p.insertId);
    if (kind !== 'missing')
      await pool.execute(
        `INSERT INTO content_post_bodies(post_id,blog_id,body_text,content_hash,completeness,status,source_kind,source_url,article_url,adapter_id,adapter_version,rule_revision,obtained_at,source_updated_at,next_attempt_at,last_attempt_at,coverage) VALUES (?,?,?,?,'full','ok','rss-content',?,?,'generic-public',?,1,?,NULL,?,?,'full')`,
        [
          p.insertId,
          b.insertId,
          kind === 'cap' ? 'x'.repeat(500001) : title,
          digest(title),
          kind === 'origin' ? home.replace('https:', 'http:') + 'feed/' : home + 'feed/',
          kind === 'meaningful' ? home + 'post?id=2' : kind === 'tracking' ? url + '&utm_source=test#anchor' : url,
          CONTENT_VERSION,
          now,
          now,
          now,
        ],
      );
    if (kind === 'unknown-rss' || kind === 'unknown-html')
      await pool.execute('UPDATE content_post_bodies SET adapter_id=?,source_kind=?,source_url=? WHERE post_id=?', [
        'unknown-public',
        kind === 'unknown-html' ? 'article-html' : 'rss-content',
        kind === 'unknown-html' ? url : home + 'feed/',
        p.insertId,
      ]);
    if (kind === 'bad-rule') await pool.execute('UPDATE content_post_bodies SET rule_revision=0 WHERE post_id=?', [p.insertId]);
    return { post: p.insertId, blog: b.insertId, home, url };
  };
  const start = async () => {
    const r = dto(await startStagedScan(pool, pins, controls));
    check(r.status === 'scanning', 'start explicit proof scan');
    runs.push(String(r.runId));
    return String(r.runId);
  };
  const cleanupPosts = async () => {
    if (posts.length) {
      await pool.query('DELETE FROM topic_index_proofs WHERE snapshot_id=? AND post_id IN (?)', [target, posts]);
      await pool.query('DELETE FROM topic_matches_v3 WHERE snapshot_id=? AND post_id IN (?)', [target, posts]);
      await pool.query('DELETE FROM topic_post_indexes_v3 WHERE snapshot_id=? AND post_id IN (?)', [target, posts]);
      await pool.query('DELETE FROM content_post_bodies WHERE post_id IN (?)', [posts]);
      await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
      posts.length = 0;
    }
    if (blogs.length) {
      await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
      blogs.length = 0;
    }
    const [[left]] = await pool.query<RowDataPacket[]>('SELECT id FROM posts LIMIT 1');
    check(!left, 'cleanup corpus empty');
  };
  try {
    await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at) VALUES (?,?,'ready',?)", [target, manifest, now]);
    await pool.execute(
      "INSERT INTO topic_snapshot_runs(snapshot_id,manifest,payload_mode,status,created_at,updated_at) VALUES (?,?,'single-copy-v1','ready',?,?)",
      [target, manifest, now, now],
    );
    await pool.execute(
      "INSERT INTO topic_policy_selections(snapshot_id,policy_version,selection_id,status,as_of,active_terms,config) VALUES (?,?,?,'ready',?,1,'{}')",
      [target, POLICY_VERSION, selection, now],
    );
    await pool.execute('INSERT INTO topic_canonical_terms_v3(snapshot_id,id,label,normalized_label,policy_version) VALUES (?,?,?,?,?)', [
      target,
      term,
      label,
      label,
      POLICY_VERSION,
    ]);
    await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at) VALUES (?,?,'published',?)", [
      window,
      JSON.stringify({ coverage: 'observed-article-window' }),
      now,
    ]);
    await pool.execute(
      'INSERT INTO topic_current(source,snapshot_id) VALUES (?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)',
      [SOURCE, window],
    );
    check(dto(await enrollStagedScanProof(pool, pins, { enabled: true })).status === 'blocked', 'no implicit proof enrollment');
    check(dto(await startStagedScan(pool, pins, controls)).reason === 'missing-proof-marker', 'explicit proof scan requires marker');
    await pool.execute("INSERT INTO topic_matches_v3(snapshot_id,post_id,term_id,source) VALUES (?,123456789,?,'title')", [target, term]);
    check(
      dto(await enrollStagedScanProof(pool, pins, controls)).reason === 'proof-target-nonempty',
      'orphan match prevents silent enrollment',
    );
    await pool.execute('DELETE FROM topic_matches_v3 WHERE snapshot_id=? AND post_id=123456789', [target]);
    check(dto(await enrollStagedScanProof(pool, pins, controls)).status === 'enrolled', 'explicit empty ready enrollment');
    check(dto(await startStagedScan(pool, pins, { enabled: true })).reason === 'proof-mode-required', 'enrolled target cannot legacy scan');
    const [ddlColumns] = await pool.query<RowDataPacket[]>(
      "SELECT TABLE_NAME,COLUMN_NAME,COLLATION_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('topic_snapshots','topic_staged_scan_runs','topic_post_indexes_v3','topic_generation_proof_contracts','topic_index_proofs') AND COLUMN_NAME IN ('id','snapshot_id','run_id','scan_run_id')",
    );
    const collation = (table: string, column: string) =>
      ddlColumns.find((r) => r.TABLE_NAME === table && r.COLUMN_NAME === column)?.COLLATION_NAME;
    check(
      collation('topic_generation_proof_contracts', 'snapshot_id') === collation('topic_snapshots', 'id') &&
        collation('topic_index_proofs', 'snapshot_id') === collation('topic_post_indexes_v3', 'snapshot_id') &&
        collation('topic_index_proofs', 'scan_run_id') === collation('topic_staged_scan_runs', 'run_id'),
      'actual FK character collations equal',
    );
    const [[retained]] = await pool.query<RowDataPacket[]>(
      'SELECT EXISTS(SELECT 1 FROM topic_generation_proof_contracts WHERE snapshot_id=?) protected',
      [target],
    );
    check(Number(retained.protected) === 1, 'marker retention predicate true even before scanrun');
    // Parent FK/collation behavior oracle, not merely metadata configuration.
    let restricted = false;
    try {
      await pool.execute('DELETE FROM topic_snapshots WHERE id=?', [target]);
    } catch (e) {
      restricted = (e as { code?: string }).code === 'ER_ROW_IS_REFERENCED_2';
    }
    check(restricted, 'marker FK restricts parenttarget deletion');
    for (const kind of ['full', 'zero', 'missing', 'origin', 'tracking', 'meaningful', 'cap', 'unknown-rss', 'unknown-html', 'bad-rule']) {
      const p = await create(kind),
        run = await start();
      const out = dto(await runStagedScanBatch(pool, { runId: run, expectedCursor: 0 }, controls));
      check(out.status === 'scanned-as-of' && out.canVerify === false, `${kind} only scanned asof`);
      const [[proof]] = await pool.query<RowDataPacket[]>('SELECT * FROM topic_index_proofs WHERE snapshot_id=? AND post_id=?', [
        target,
        p.post,
      ]);
      if (kind === 'cap') check(!proof && out.capped === 1, 'capped no proof');
      else {
        const titleOnly = ['missing', 'origin', 'meaningful', 'unknown-rss', 'unknown-html', 'bad-rule'].includes(kind);
        check(proof?.kind === (titleOnly ? 'title-only' : 'full'), 'source kind proof');
        check(
          titleOnly
            ? proof.body_fingerprint === null &&
                proof.body_content_hash === null &&
                proof.body_revision === null &&
                proof.source_kind === null &&
                proof.body_obtained_at === null
            : typeof proof.body_fingerprint === 'string' && proof.body_content_hash === digest(kind === 'zero' ? '沒有詞語' : label),
          'proof body existence and nullability',
        );
        check(
          proof.metadata_fingerprint !== null && proof.scan_run_id === run && proof.input_hash !== null,
          'proof metadata and run pinned',
        );
      }
      if (kind === 'zero') {
        const [matches] = await pool.query<RowDataPacket[]>('SELECT post_id FROM topic_matches_v3 WHERE snapshot_id=? AND post_id=?', [
          target,
          p.post,
        ]);
        check(matches.length === 0 && proof.kind === 'full' && out.zeroHit === 1, 'zero hit retains full proof');
      }
      if (kind === 'full') {
        let runRestricted = false;
        try {
          await pool.execute('DELETE FROM topic_staged_scan_runs WHERE run_id=?', [run]);
        } catch (e) {
          runRestricted = (e as { code?: string }).code === 'ER_ROW_IS_REFERENCED_2';
        }
        check(runRestricted, 'run parent RESTRICT no unbounded cascade');
        await pool.execute('DELETE FROM topic_post_indexes_v3 WHERE snapshot_id=? AND post_id=?', [target, p.post]);
        const [remaining] = await pool.query<RowDataPacket[]>('SELECT post_id FROM topic_index_proofs WHERE snapshot_id=? AND post_id=?', [
          target,
          p.post,
        ]);
        check(remaining.length === 0, 'singleindex cascade removes exactly its proof (not GCbudget proof)');
      }
      await cleanupPosts();
    }
    {
      const p = await create('full'),
        first = await start();
      await runStagedScanBatch(pool, { runId: first, expectedCursor: 0 }, controls);
      await pool.execute('UPDATE content_post_bodies SET source_url=? WHERE post_id=?', ['https://foreign.example/feed', p.post]);
      const replacement = await start();
      await runStagedScanBatch(pool, { runId: replacement, expectedCursor: 0 }, controls);
      const [[proof]] = await pool.query<RowDataPacket[]>(
        'SELECT kind,body_fingerprint,source_kind,scan_run_id FROM topic_index_proofs WHERE snapshot_id=? AND post_id=?',
        [target, p.post],
      );
      check(
        proof.kind === 'title-only' && proof.body_fingerprint === null && proof.source_kind === null && proof.scan_run_id === replacement,
        'explicit rescan atomically replaces prior full proof with title-only',
      );
      const [hits] = await pool.query<RowDataPacket[]>('SELECT source FROM topic_matches_v3 WHERE snapshot_id=? AND post_id=?', [
        target,
        p.post,
      ]);
      check(hits.length === 1 && hits[0].source === 'title', 'rescan removes oldbody hit');
      await cleanupPosts();
    }
    for (const mutation of [
      'body-updated',
      'owner-status',
      'post-title',
      'future',
      'delete',
      'blog-url',
      'post-url',
      'source-url',
      'adapter',
    ]) {
      const p = await create('full'),
        run = await start();
      let release!: () => void,
        seen!: () => void,
        heldOnce = false;
      const gate = new Promise<void>((r) => {
          release = r;
        }),
        observed = new Promise<void>((r) => {
          seen = r;
        });
      const wrapped: Pool = Object.create(pool);
      wrapped.getConnection = (async () => {
        const c = await pool.getConnection(),
          proxy: PoolConnection = Object.create(c);
        proxy.query = (async (q: unknown, args: unknown[] = []) => {
          const value = await c.query(q as string, args);
          if (!heldOnce && typeof q === 'string' && q.includes('metadata_fingerprint') && !q.includes('FOR UPDATE')) {
            heldOnce = true;
            events.push(`${mutation}:pre-tuple`);
            seen();
            await gate;
          }
          return value;
        }) as PoolConnection['query'];
        proxy.execute = c.execute.bind(c);
        proxy.beginTransaction = c.beginTransaction.bind(c);
        proxy.commit = c.commit.bind(c);
        proxy.rollback = c.rollback.bind(c);
        proxy.release = c.release.bind(c);
        proxy.destroy = c.destroy.bind(c);
        return proxy;
      }) as Pool['getConnection'];
      const pending = runStagedScanBatch(wrapped, { runId: run, expectedCursor: 0 }, controls);
      pending.catch(() => {});
      try {
        await Promise.race([
          observed,
          pending.then(() => {
            throw Error('barrier-not-reached');
          }),
        ]);
        const writer = await pool.getConnection();
        try {
          await writer.beginTransaction();
          if (mutation === 'body-updated')
            await writer.execute('UPDATE content_post_bodies SET source_updated_at=? WHERE post_id=?', [
              new Date(now.getTime() - 1000),
              p.post,
            ]);
          else if (mutation === 'owner-status') await writer.execute("UPDATE blogs SET status='rejected' WHERE id=?", [p.blog]);
          else if (mutation === 'future')
            await writer.execute('UPDATE posts SET published_at=? WHERE id=?', [new Date(now.getTime() + 86400000), p.post]);
          else if (mutation === 'delete') await writer.execute('DELETE FROM posts WHERE id=?', [p.post]);
          else if (mutation === 'blog-url') await writer.execute('UPDATE blogs SET url=? WHERE id=?', ['https://changed.example/', p.blog]);
          else if (mutation === 'post-url') await writer.execute('UPDATE posts SET url=? WHERE id=?', [p.url + '&meaningful=2', p.post]);
          else if (mutation === 'source-url')
            await writer.execute('UPDATE content_post_bodies SET source_url=? WHERE post_id=?', ['https://changed.example/feed', p.post]);
          else if (mutation === 'adapter')
            await writer.execute('UPDATE content_post_bodies SET adapter_id=? WHERE post_id=?', ['unknown-public', p.post]);
          else await writer.execute('UPDATE posts SET title=? WHERE id=?', ['同hash改標題', p.post]);
          await writer.commit();
          events.push(`${mutation}:writer-commit`);
        } finally {
          await writer.rollback();
          writer.release();
        }
        release();
        const out = dto(await pending);
        check(out.eligible === 0 && out.canVerify === false, 'fresh mismatch not proven');
        const [proof] = await pool.query<RowDataPacket[]>('SELECT post_id FROM topic_index_proofs WHERE snapshot_id=? AND post_id=?', [
          target,
          p.post,
        ]);
        check(proof.length === 0, 'fresh mismatch no proof');
        events.push(`${mutation}:return`);
      } finally {
        release();
        await pending.catch(() => {});
      }
      await cleanupPosts();
    }
    // H1: Harness creates an explicit RR read view; runtime current check is locking, before body locks.
    {
      const p = await create('full'),
        run = await start();
      let release!: () => void,
        seen!: () => void,
        inTx = false,
        heldOnce = false;
      const gate = new Promise<void>((r) => {
          release = r;
        }),
        observed = new Promise<void>((r) => {
          seen = r;
        }),
        wrapped: Pool = Object.create(pool);
      wrapped.getConnection = (async () => {
        const c = await pool.getConnection(),
          proxy: PoolConnection = Object.create(c);
        proxy.query = (async (q: unknown, args: unknown[] = []) => {
          const value = await c.query(q as string, args);
          if (inTx && !heldOnce && typeof q === 'string' && q.includes('SELECT source FROM topic_current')) {
            heldOnce = true;
            events.push('rr:consistent-snapshot');
            seen();
            await gate;
            const [[oldBody]] = await c.query<RowDataPacket[]>('SELECT source_updated_at FROM content_post_bodies WHERE post_id=?', [
              p.post,
            ]);
            check(oldBody?.source_updated_at === null, 'explicit RR plain body probe retains old NULL after writercommit');
            rrBehaviorProbes++;
            events.push('rr:plain-old-body');
          }
          return value;
        }) as PoolConnection['query'];
        proxy.execute = c.execute.bind(c);
        proxy.beginTransaction = async () => {
          await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
          rrIssuedTransactions++;
          await c.beginTransaction();
          await c.query('SELECT run_id FROM topic_staged_scan_runs WHERE run_id=?', [run]);
          inTx = true;
        };
        proxy.commit = async () => {
          await c.commit();
          inTx = false;
        };
        proxy.rollback = async () => {
          await c.rollback();
          inTx = false;
        };
        proxy.release = c.release.bind(c);
        proxy.destroy = c.destroy.bind(c);
        return proxy;
      }) as Pool['getConnection'];
      const pending = runStagedScanBatch(wrapped, { runId: run, expectedCursor: 0 }, controls);
      pending.catch(() => {});
      try {
        await Promise.race([
          observed,
          pending.then(() => {
            throw Error('rr-barrier-not-reached');
          }),
        ]);
        const writer = await pool.getConnection();
        try {
          await writer.beginTransaction();
          await writer.execute('UPDATE content_post_bodies SET source_updated_at=? WHERE post_id=?', [
            new Date(now.getTime() - 1000),
            p.post,
          ]);
          await writer.commit();
          events.push('rr:writer-commit');
        } finally {
          await writer.rollback();
          writer.release();
        }
        release();
        const out = dto(await pending);
        check(out.unresolved === 1 && out.eligible === 0, 'locking finaltuple sees post-snapshot change');
        const [proof] = await pool.query<RowDataPacket[]>('SELECT post_id FROM topic_index_proofs WHERE snapshot_id=? AND post_id=?', [
          target,
          p.post,
        ]);
        check(proof.length === 0, 'RR stale snapshot cannot produce proof');
        events.push('rr:return');
      } finally {
        release();
        await pending.catch(() => {});
      }
      await cleanupPosts();
    }
    // Proof insert fails after index/matches writes: all four groups must roll back, then safely resume.
    const p = await create('full'),
      run = await start(),
      failing: Pool = Object.create(pool);
    failing.getConnection = (async () => {
      const c = await pool.getConnection(),
        proxy: PoolConnection = Object.create(c);
      proxy.query = c.query.bind(c);
      proxy.execute = (async (q: unknown, args: unknown[] = []) => {
        if (typeof q === 'string' && q.startsWith('INSERT INTO topic_index_proofs')) throw Error('synthetic-proof-write');
        return c.execute(q as string, args as never);
      }) as PoolConnection['execute'];
      proxy.beginTransaction = c.beginTransaction.bind(c);
      proxy.commit = c.commit.bind(c);
      proxy.rollback = c.rollback.bind(c);
      proxy.release = c.release.bind(c);
      proxy.destroy = c.destroy.bind(c);
      return proxy;
    }) as Pool['getConnection'];
    check(
      dto(await runStagedScanBatch(failing, { runId: run, expectedCursor: 0 }, controls)).status === 'deferred',
      'proof failure deferred',
    );
    for (const table of ['topic_matches_v3', 'topic_post_indexes_v3', 'topic_index_proofs']) {
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT post_id FROM ${table} WHERE snapshot_id=? AND post_id=?`, [target, p.post]);
      check(rows.length === 0, 'proof/index/matches rollback');
    }
    const [[row]] = await pool.query<RowDataPacket[]>('SELECT state_json FROM topic_staged_scan_runs WHERE run_id=?', [run]);
    check(
      JSON.parse(typeof row.state_json === 'string' ? row.state_json : JSON.stringify(row.state_json)).cursor === 0,
      'cursor rollback with proof',
    );
    await runStagedScanBatch(pool, { runId: run, expectedCursor: 0 }, controls);
    await cleanupPosts();
    {
      const p = await create('full'),
        run = await start(),
        uncertain: Pool = Object.create(pool);
      uncertain.getConnection = (async () => {
        const c = await pool.getConnection(),
          proxy: PoolConnection = Object.create(c);
        proxy.query = c.query.bind(c);
        proxy.execute = c.execute.bind(c);
        proxy.beginTransaction = c.beginTransaction.bind(c);
        proxy.commit = async () => {
          await c.commit();
          throw Error('synthetic-after-commit');
        };
        proxy.rollback = c.rollback.bind(c);
        proxy.release = c.release.bind(c);
        proxy.destroy = c.destroy.bind(c);
        return proxy;
      }) as Pool['getConnection'];
      check(
        dto(await runStagedScanBatch(uncertain, { runId: run, expectedCursor: 0 }, controls)).status === 'deferred',
        'actual committed unknown outcome deferred',
      );
      const [[stored]] = await pool.query<RowDataPacket[]>('SELECT state_json FROM topic_staged_scan_runs WHERE run_id=?', [run]);
      check(
        JSON.parse(typeof stored.state_json === 'string' ? stored.state_json : JSON.stringify(stored.state_json)).cursor === p.post,
        'unknown commit durablecursor retained',
      );
      for (const table of ['topic_index_proofs', 'topic_matches_v3', 'topic_post_indexes_v3']) {
        const [rows] = await pool.query<RowDataPacket[]>(`SELECT post_id FROM ${table} WHERE snapshot_id=? AND post_id=?`, [
          target,
          p.post,
        ]);
        check(rows.length > 0, 'unknown commit durableproof/index/match retained');
      }
      check(
        dto(await runStagedScanBatch(pool, { runId: run, expectedCursor: 0 }, controls)).status === 'conflict',
        'unknowncommit oldcursor conflict',
      );
      check(
        dto(await runStagedScanBatch(pool, { runId: run, expectedCursor: p.post }, controls)).status === 'scanned-as-of',
        'unknowncommit correctcursor terminalresume',
      );
    }
    await cleanupPosts();
    {
      const p = await create('full'),
        run = await start();
      let release!: () => void,
        seen!: () => void,
        inTx = false,
        heldOnce = false;
      const gate = new Promise<void>((r) => {
          release = r;
        }),
        observed = new Promise<void>((r) => {
          seen = r;
        }),
        wrapped: Pool = Object.create(pool);
      wrapped.getConnection = (async () => {
        const c = await pool.getConnection(),
          proxy: PoolConnection = Object.create(c);
        proxy.query = (async (q: unknown, args: unknown[] = []) => {
          if (inTx && !heldOnce && typeof q === 'string' && q.includes('SELECT source FROM topic_current') && q.includes('FOR UPDATE')) {
            heldOnce = true;
            events.push('pointer:before-locking-check');
            seen();
            await gate;
            const [[oldPointer]] = await c.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
            check(oldPointer?.snapshot_id === window, 'explicit RR plain pointer probe retains old window after writercommit');
            rrBehaviorProbes++;
            events.push('pointer:plain-old-window');
          }
          return c.query(q as string, args);
        }) as PoolConnection['query'];
        proxy.execute = c.execute.bind(c);
        proxy.beginTransaction = async () => {
          await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
          rrIssuedTransactions++;
          await c.beginTransaction();
          await c.query('SELECT run_id FROM topic_staged_scan_runs WHERE run_id=?', [run]);
          inTx = true;
          events.push('pointer:consistent-snapshot');
        };
        proxy.commit = async () => {
          await c.commit();
          inTx = false;
        };
        proxy.rollback = async () => {
          await c.rollback();
          inTx = false;
        };
        proxy.release = c.release.bind(c);
        proxy.destroy = c.destroy.bind(c);
        return proxy;
      }) as Pool['getConnection'];
      const pending = runStagedScanBatch(wrapped, { runId: run, expectedCursor: 0 }, controls);
      pending.catch(() => {});
      try {
        await Promise.race([
          observed,
          pending.then(() => {
            throw Error('pointer-barrier-not-reached');
          }),
        ]);
        const writer = await pool.getConnection();
        try {
          await writer.beginTransaction();
          await writer.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [target, SOURCE]);
          await writer.commit();
          events.push('pointer:independent-writer-commit');
        } finally {
          await writer.rollback();
          writer.release();
        }
        release();
        const out = dto(await pending);
        check(out.status === 'blocked' && out.reason === 'target-public', 'fresh locking pointer rejects despite old RR view');
        for (const table of ['topic_index_proofs', 'topic_matches_v3', 'topic_post_indexes_v3']) {
          const [rows] = await pool.query<RowDataPacket[]>(`SELECT post_id FROM ${table} WHERE snapshot_id=? AND post_id=?`, [
            target,
            p.post,
          ]);
          check(rows.length === 0, 'pointer race no proof/index/matches writes');
        }
        const [[stored]] = await pool.query<RowDataPacket[]>('SELECT state_json FROM topic_staged_scan_runs WHERE run_id=?', [run]);
        check(
          JSON.parse(typeof stored.state_json === 'string' ? stored.state_json : JSON.stringify(stored.state_json)).cursor === 0,
          'pointer race cursor not advanced',
        );
        events.push('pointer:return');
      } finally {
        release();
        await pending.catch(() => {});
        await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [window, SOURCE]);
      }
      // Explicit recovery completes this blocked scan only after target is again unpublished/current absent.
      await runStagedScanBatch(pool, { runId: run, expectedCursor: 0 }, controls);
    }
    const [publicContract] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=? AND snapshot_id=?', [
      SOURCE,
      target,
    ]);
    check(publicContract.length === 0, 'proof target not current');
    check(rrIssuedTransactions >= 2 && rrBehaviorProbes === 2, 'both explicit RR harnesses issued settings and proved old plain views');
    return {
      checks,
      events,
      canVerify: false,
      readerAdopted: false,
      rrIsolation: 'REPEATABLE-READ',
      rrIssuedTransactions,
      rrBehaviorProbes,
      cleanupApi: 'not implemented',
      parentFk: 'restrict',
      checkEnforcement: 'cooperative pure validator; no CHECK',
      productionTimingClaim: false,
    };
  } finally {
    if (previous) await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [previous.snapshot_id, SOURCE]);
    else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    await pool.execute('DELETE FROM topic_index_proofs WHERE snapshot_id=?', [target]);
    await cleanupPosts();
    await pool.execute('DELETE FROM topic_generation_proof_contracts WHERE snapshot_id=?', [target]);
    await pool.query('UPDATE topic_staged_scan_owner SET run_id=NULL WHERE source=? AND run_id IN (?)', [
      SOURCE,
      runs.length ? runs : ['none'],
    ]);
    await pool.execute('DELETE FROM topic_staged_scan_runs WHERE target_snapshot_id=?', [target]);
    for (const table of [
      'topic_matches_v3',
      'topic_post_indexes_v3',
      'topic_canonical_terms_v3',
      'topic_policy_selections',
      'topic_snapshot_runs',
    ])
      await pool.execute(`DELETE FROM ${table} WHERE snapshot_id=?`, [target]);
    await pool.query('DELETE FROM topic_snapshots WHERE id IN (?)', [[target, window]]);
  }
}
