import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { CONTENT_VERSION } from '../content/contracts.ts';
import { CLEANUP_VERSION } from './matching-body.ts';
import { digest, MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { evidence } from './routes.ts';
import { SOURCE } from './snapshot-client.ts';
import { runStagedScanBatch, startStagedScan } from './staged-scan-v2.ts';

function instrumented(
  pool: Pool,
  options: { afterQuery?: (sql: unknown, result: unknown) => void; failure?: 'begin' | 'write' | 'commit-before' | 'commit-after' },
): Pool {
  const wrapped: Pool = Object.create(pool);
  wrapped.getConnection = (async () => {
    const c = await pool.getConnection(),
      p: PoolConnection = Object.create(c);
    p.query = (async (q: unknown, args: unknown[] = []) => {
      const r = await c.query(q as string, args);
      options.afterQuery?.(q, r);
      return r;
    }) as PoolConnection['query'];
    p.execute = (async (q: unknown, args: unknown[] = []) => {
      if (options.failure === 'write' && String(q).startsWith('INSERT INTO topic_post_indexes_v3')) throw Error('synthetic-write');
      return c.execute(q as string, args as never);
    }) as PoolConnection['execute'];
    p.beginTransaction = async () => {
      if (options.failure === 'begin') throw Error('synthetic-begin');
      await c.beginTransaction();
    };
    p.commit = async () => {
      if (options.failure === 'commit-before') throw Error('synthetic-before-commit');
      await c.commit();
      if (options.failure === 'commit-after') throw Error('synthetic-after-commit');
    };
    p.rollback = c.rollback.bind(c);
    p.release = c.release.bind(c);
    p.destroy = c.destroy.bind(c);
    return p;
  }) as Pool['getConnection'];
  return wrapped;
}

/** Synthetic data + real guarded SQL only. No HTTP, publication or live complete-coverage assertion. */
export async function runStagedScanV2Integration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const [[nonempty]] = await pool.query<RowDataPacket[]>('SELECT id FROM posts LIMIT 1');
  assert.ok(!nonempty, 'tiny scan fixture requires empty disposable corpus, not an existing database');
  const target = randomUUID(),
    windows = [randomUUID(), randomUUID(), randomUUID()],
    manifest = JSON.stringify({ coverage: 'all-current-indexed-article-tags' }),
    selection = digest(target),
    label = '蛤蜊絲瓜',
    term = digest(label),
    now = new Date();
  const pins = {
    target,
    manifestSha256: createHash('sha256').update(manifest).digest('hex'),
    policyVersion: POLICY_VERSION,
    selectionId: selection,
    matcherVersion: MATCHER_VERSION,
    cleanupVersion: CLEANUP_VERSION,
  };
  const [[previous]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
  const blogs: number[] = [],
    posts: number[] = [],
    runs: string[] = [],
    events: string[] = [];
  let checks = 0;
  let byteSentinelObservations = 0;
  const check = (
    value: unknown,
    message: string,
    diagnostic?: { sourceCase: string; status: string; reason: string; counters: Record<string, number> },
  ) => {
    try {
      assert.ok(value, message);
    } catch (error) {
      if (error && typeof error === 'object') {
        Object.defineProperty(error, 'testOrdinal', { value: checks + 1 });
        if (diagnostic) Object.defineProperty(error, 'syntheticDiagnostic', { value: diagnostic });
      }
      throw error;
    }
    checks++;
  };
  const result = (r: unknown) => r as Record<string, unknown>;
  const newRun = async () => {
    const r = result(await startStagedScan(pool, pins, { enabled: true, now: () => now }));
    check(['scanning', 'scanned-as-of'].includes(String(r.status)), 'start generation-local scan');
    runs.push(String(r.runId));
    return r;
  };
  const setCurrent = async (id: string) =>
    pool.execute('INSERT INTO topic_current(source,snapshot_id) VALUES (?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)', [
      SOURCE,
      id,
    ]);
  const add = async (kind = 'missing', date: Date | null = null) => {
    const slug = `scan-${randomUUID()}`,
      home = `https://${slug}.example/`,
      url = `${home}post?id=1`;
    const [b] = await pool.execute<ResultSetHeader>("INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES(?,?,?,'verified',?)", [
      slug,
      slug,
      home,
      now,
    ]);
    blogs.push(b.insertId);
    const [p] = await pool.execute<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,content_hash,published_at,created_at) VALUES(?,?,?,?,?,?,?)',
      [b.insertId, randomUUID(), url, kind === 'zero' ? '沒有詞彙' : label, digest('metadata'), date, now],
    );
    posts.push(p.insertId);
    if (!['missing', 'zero'].includes(kind))
      await pool.execute(
        `INSERT INTO content_post_bodies(post_id,blog_id,body_text,content_hash,completeness,status,source_kind,source_url,article_url,adapter_id,adapter_version,rule_revision,obtained_at,next_attempt_at,last_attempt_at,truncated,coverage) VALUES (?,?,?,?,'full','ok',?,?,?,?,?,1,?,?,?,?,'full')`,
        [
          p.insertId,
          b.insertId,
          kind === 'oversize' ? 'x'.repeat(500001) : label,
          digest(label),
          kind === 'wp' ? 'wordpress-api' : 'rss-content',
          kind === 'wp' ? `${home}wp-json/wp/v2/posts?slug=post` : `${home}feed/`,
          kind === 'tracking' ? `${url}&utm_source=fixture#part` : kind === 'meaningful' ? `${home}post?id=2` : url,
          kind === 'wp' ? 'wordpress-public' : 'generic-public',
          CONTENT_VERSION,
          now,
          now,
          now,
          kind === 'capped' ? 1 : 0,
        ],
      );
    return { post: p.insertId, blog: b.insertId, home, url };
  };
  const removePosts = async () => {
    if (posts.length) {
      await pool.query('DELETE FROM content_post_bodies WHERE post_id IN (?)', [posts]);
      await pool.query('DELETE FROM topic_matches_v3 WHERE snapshot_id=? AND post_id IN (?)', [target, posts]);
      await pool.query('DELETE FROM topic_post_indexes_v3 WHERE snapshot_id=? AND post_id IN (?)', [target, posts]);
      await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
      posts.length = 0;
    }
    if (blogs.length) {
      await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
      blogs.length = 0;
    }
    const [[remaining]] = await pool.query<RowDataPacket[]>('SELECT id FROM posts LIMIT 1');
    check(!remaining, 'owned corpus cleanup actually empty');
  };
  try {
    await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at) VALUES (?,?,'ready',?)", [target, manifest, now]);
    await pool.execute(
      "INSERT INTO topic_snapshot_runs(snapshot_id,manifest,payload_mode,status,created_at,updated_at) VALUES (?,?,'single-copy-v1','ready',?,?)",
      [target, manifest, now, now],
    );
    await pool.execute(
      "INSERT INTO topic_policy_selections(snapshot_id,policy_version,selection_id,status,as_of,total_terms,eligible_terms,active_terms,code_points,estimated_bytes,config) VALUES (?,?,?,'ready',?,1,1,1,4,4096,'{}')",
      [target, POLICY_VERSION, selection, now],
    );
    await pool.execute('INSERT INTO topic_canonical_terms_v3(snapshot_id,id,normalized_label,label,policy_version) VALUES (?,?,?,?,?)', [
      target,
      term,
      label,
      label,
      POLICY_VERSION,
    ]);
    for (const w of windows)
      await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at) VALUES (?,?,'published',?)", [
        w,
        JSON.stringify({ coverage: 'observed-article-window' }),
        now,
      ]);
    await setCurrent(windows[0]);
    // Empty terminal must not block another scan, and legacy exact-owner recovery cannot clear another owner.
    const empty = await newRun(),
      empty2 = await newRun();
    check(empty.status === 'scanned-as-of' && empty2.status === 'scanned-as-of', 'empty starts both terminal');
    await pool.execute('UPDATE topic_staged_scan_owner SET run_id=? WHERE source=?', [String(empty2.runId), SOURCE]);
    await runStagedScanBatch(pool, { runId: String(empty.runId), expectedCursor: 0 }, { enabled: true, now: () => now });
    const [[other]] = await pool.query<RowDataPacket[]>('SELECT run_id FROM topic_staged_scan_owner WHERE source=?', [SOURCE]);
    check(other.run_id === empty2.runId, 'terminal recovery does not clear other owner');
    await runStagedScanBatch(pool, { runId: String(empty2.runId), expectedCursor: 0 }, { enabled: true, now: () => now });
    // ID hole and NULL date remain in all-ID bounded scan; current may drift independently.
    const hole = await add(),
      _one = await add('missing'),
      _two = await add('zero'),
      three = await add('wp', new Date(now.getTime() - 3600000));
    await pool.execute('DELETE FROM posts WHERE id=?', [hole.post]);
    let r = await newRun();
    let cursor = 0;
    for (let n = 0; n < 3; n++) {
      await setCurrent(windows[n]);
      r = result(
        await runStagedScanBatch(pool, { runId: String(r.runId), expectedCursor: cursor, limit: 1 }, { enabled: true, now: () => now }),
      );
      check(!['conflict', 'deferred', 'blocked'].includes(String(r.status)), 'window drift does not invalidate target scan');
      cursor = Number(r.cursor);
    }
    check(
      cursor === three.post && Number(r.checked) === 3 && Number(r.titleOnly) === 2 && Number(r.zeroHit) === 1,
      'NULL date/ID hole/title-only/zero/fullWP counters',
    );
    check(r.canVerify === false && r.status === 'scanned-as-of', 'as-of completion never verifies');
    const [publicRows] = await pool.query<RowDataPacket[]>(`WITH ${evidence()} SELECT * FROM evidence`, [
      new Date(now.getTime() - 86400000),
      now,
    ]);
    check(publicRows.length === 0, 'actual current-joined evidence SQL does not expose ready target');
    const [historyCandidates] = await pool.query<RowDataPacket[]>(
      "SELECT id FROM topic_snapshots WHERE id=? AND status IN ('published','retiring')",
      [target],
    );
    check(historyCandidates.length === 0, 'actual history published-status eligibility excludes target (not full backfill invocation)');
    const [frequencyCandidates] = await pool.query<RowDataPacket[]>(
      'SELECT snapshot_id FROM topic_current WHERE source=? AND snapshot_id=?',
      [SOURCE, target],
    );
    check(frequencyCandidates.length === 0, 'frequency current selector excludes target (not frequency refresh invocation)');
    await removePosts();
    for (const kind of ['rss', 'tracking', 'meaningful', 'capped', 'oversize'] as const) {
      const p = await add(kind);
      const started = await newRun();
      const boundedPool =
        kind === 'oversize'
          ? instrumented(pool, {
              afterQuery: (q, r) => {
                if (typeof q === 'string' && q.includes('CASE WHEN') && q.includes('FROM content_post_bodies b')) {
                  const rows = (r as unknown[][])[0];
                  check(rows.length === 1 && (rows[0] as RowDataPacket).body_text === null, '500001byte body returned only NULL sentinel');
                  byteSentinelObservations++;
                }
              },
            })
          : pool;
      const out = result(
        await runStagedScanBatch(boundedPool, { runId: String(started.runId), expectedCursor: 0 }, { enabled: true, now: () => now }),
      );
      const safeStatuses = ['disabled', 'busy', 'blocked', 'deferred', 'conflict', 'scanning', 'scanned-as-of'];
      const safeReasons = [
        'deadline',
        'lease',
        'local-db-unavailable',
        'target-not-ready',
        'target-public',
        'active-scan',
        'invalid-input',
        'scan-owner',
        'missing-run',
        'policy-count',
        'cursor-conflict',
      ];
      const diagnostic = {
        sourceCase: kind,
        status: typeof out.status === 'string' && safeStatuses.includes(out.status) ? out.status : 'unknown',
        reason:
          typeof out.reason === 'string' && safeReasons.includes(out.reason) ? out.reason : out.reason === undefined ? 'none' : 'unknown',
        counters: Object.fromEntries(
          ['checked', 'eligible', 'titleOnly', 'zeroHit', 'skipped', 'capped', 'unresolved'].flatMap((k) =>
            Number.isSafeInteger(out[k]) && Number(out[k]) >= 0 && Number(out[k]) <= 2147483647 ? [[k, Number(out[k])]] : [],
          ),
        ),
      };
      check(
        ['capped', 'oversize'].includes(kind) ? out.capped === 1 : kind === 'meaningful' ? out.titleOnly === 1 : out.titleOnly === 0,
        `stored source case ${kind}`,
        diagnostic,
      );
      const [[idx]] = await pool.query<RowDataPacket[]>('SELECT body_hash FROM topic_post_indexes_v3 WHERE snapshot_id=? AND post_id=?', [
        target,
        p.post,
      ]);
      check(
        ['capped', 'oversize'].includes(kind) ? !idx : kind === 'meaningful' ? idx?.body_hash === null : idx?.body_hash === digest(label),
        `body identity/hash case ${kind}`,
        diagnostic,
      );
      await removePosts();
    }
    for (const mutation of [
      'seed',
      'rejected',
      'moved',
      'future',
      'delete',
      'blog-url',
      'foreign-post',
      'body-revision',
      'source-url',
    ] as const) {
      const p = await add('rss'),
        started = await newRun();
      let release!: () => void, observed!: () => void;
      const held = new Promise<void>((resolve) => {
          release = resolve;
        }),
        seen = new Promise<void>((resolve) => {
          observed = resolve;
        });
      let intercepted = false;
      const wrapped: Pool = Object.create(pool);
      wrapped.getConnection = (async () => {
        const c = await pool.getConnection();
        const proxy: PoolConnection = Object.create(c);
        proxy.query = (async (q: unknown, args: unknown[] = []) => {
          const value = await c.query(q as string, args);
          if (!intercepted && typeof q === 'string' && q.includes('FROM content_post_bodies b WHERE') && !q.includes('FOR UPDATE')) {
            intercepted = true;
            events.push(`${mutation}:pre-read`);
            observed();
            await held;
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
      const pending = runStagedScanBatch(wrapped, { runId: String(started.runId), expectedCursor: 0 }, { enabled: true, now: () => now });
      pending.catch(() => {});
      try {
        await Promise.race([
          seen,
          pending.then(() => {
            throw Error('barrier not reached');
          }),
        ]);
        const writer = await pool.getConnection();
        try {
          await writer.beginTransaction();
          if (['seed', 'rejected', 'moved'].includes(mutation))
            await writer.execute('UPDATE blogs SET status=? WHERE id=?', [mutation, p.blog]);
          else if (mutation === 'future')
            await writer.execute('UPDATE posts SET published_at=? WHERE id=?', [new Date(now.getTime() + 86400000), p.post]);
          else if (mutation === 'delete') await writer.execute('DELETE FROM posts WHERE id=?', [p.post]);
          else if (mutation === 'blog-url') await writer.execute('UPDATE blogs SET url=? WHERE id=?', ['https://foreign.example/', p.blog]);
          else if (mutation === 'foreign-post')
            await writer.execute('UPDATE posts SET url=? WHERE id=?', ['https://foreign.example/post', p.post]);
          else if (mutation === 'body-revision')
            await writer.execute('UPDATE content_post_bodies SET revision=revision+1,content_hash=? WHERE post_id=?', [
              digest('changed'),
              p.post,
            ]);
          else
            await writer.execute('UPDATE content_post_bodies SET source_url=? WHERE post_id=?', ['https://foreign.example/feed', p.post]);
          await writer.commit();
          events.push(`${mutation}:writer-commit`);
        } finally {
          await writer.rollback();
          writer.release();
        }
        release();
        const out = result(await pending);
        events.push(`${mutation}:scan-return`);
        check(out.canVerify === false && Number(out.eligible) === 0, `${mutation} fresh barrier excludes stale match`);
        const [hits] = await pool.query<RowDataPacket[]>('SELECT post_id FROM topic_matches_v3 WHERE snapshot_id=? AND post_id=?', [
          target,
          p.post,
        ]);
        check(hits.length === 0, `${mutation} no stale target hit`);
      } finally {
        release();
        await pending.catch(() => {});
      }
      await removePosts();
    }
    let finalRun: Record<string, unknown> | undefined,
      finalPost = 0;
    for (const failure of ['begin', 'write', 'commit-before', 'commit-after'] as const) {
      const p = await add('rss'),
        started = await newRun();
      check(
        result(
          await runStagedScanBatch(
            instrumented(pool, { failure }),
            { runId: String(started.runId), expectedCursor: 0 },
            { enabled: true, now: () => now },
          ),
        ).status === 'deferred',
        `${failure} safe deferred`,
      );
      const [[run]] = await pool.query<RowDataPacket[]>('SELECT state_json FROM topic_staged_scan_runs WHERE run_id=?', [
        String(started.runId),
      ]);
      const stored = JSON.parse(typeof run.state_json === 'string' ? run.state_json : JSON.stringify(run.state_json));
      const [indexes] = await pool.query<RowDataPacket[]>('SELECT post_id FROM topic_post_indexes_v3 WHERE snapshot_id=? AND post_id=?', [
        target,
        p.post,
      ]);
      const [hits] = await pool.query<RowDataPacket[]>('SELECT post_id FROM topic_matches_v3 WHERE snapshot_id=? AND post_id=?', [
        target,
        p.post,
      ]);
      check(
        failure === 'commit-after'
          ? stored.cursor === p.post && indexes.length === 1 && hits.length > 0
          : stored.cursor === 0 && indexes.length === 0 && hits.length === 0,
        `${failure} cursor/matches/index atomic`,
      );
      if (failure === 'commit-after')
        check(
          result(await runStagedScanBatch(pool, { runId: String(started.runId), expectedCursor: 0 }, { enabled: true, now: () => now }))
            .status === 'conflict',
          'postcommit local failure oldcursor conflict',
        );
      await runStagedScanBatch(pool, { runId: String(started.runId), expectedCursor: stored.cursor }, { enabled: true, now: () => now });
      check(
        result(await runStagedScanBatch(pool, { runId: String(started.runId), expectedCursor: 0 }, { enabled: true, now: () => now }))
          .status === 'conflict',
        'stale cursor cannot overwrite committed run',
      );
      finalRun = started;
      finalPost = p.post;
      await removePosts();
    }
    await setCurrent(target);
    check(
      result(
        await runStagedScanBatch(pool, { runId: String(finalRun!.runId), expectedCursor: finalPost }, { enabled: true, now: () => now }),
      ).reason === 'target-public',
      'public target blocks terminal cleanup write',
    );
    return {
      checks,
      events,
      byteSentinelObservations,
      canVerify: false,
      productionTimingClaim: false,
      readerEvidence: 'actual current evidence SQL; history/frequency selectors only, no HTTP/full writer invocation',
    };
  } finally {
    // All held barriers are drained by their inner finally before owned data cleanup.
    if (previous) await setCurrent(String(previous.snapshot_id));
    else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    await pool.query('UPDATE topic_staged_scan_owner SET run_id=NULL WHERE source=? AND run_id IN (?)', [
      SOURCE,
      runs.length ? runs : ['none'],
    ]);
    await removePosts();
    await pool.execute('DELETE FROM topic_staged_scan_runs WHERE target_snapshot_id=?', [target]);
    for (const table of [
      'topic_matches_v3',
      'topic_post_indexes_v3',
      'topic_canonical_terms_v3',
      'topic_policy_selections',
      'topic_snapshot_runs',
    ])
      await pool.execute(`DELETE FROM ${table} WHERE snapshot_id=?`, [target]);
    await pool.query('DELETE FROM topic_snapshots WHERE id IN (?)', [[target, ...windows]]);
  }
}
