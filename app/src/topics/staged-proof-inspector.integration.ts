import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { CONTENT_VERSION } from '../content/contracts.ts';
import { CLEANUP_VERSION } from './matching-body.ts';
import { digest, MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { TOPIC_FINGERPRINT_VERSION } from './provenance-fingerprint-sql.ts';
import { SOURCE } from './snapshot-client.ts';
import { type InspectorInput, inspectStagedProof, stagedProofInspectorQueryForTests } from './staged-proof-inspector.ts';
import { STAGED_PROOF_VERSION } from './staged-scan-proof.ts';
import { enrollStagedScanProof, runStagedScanBatch, startStagedScan } from './staged-scan-v2.ts';
/** Tiny legitimate-capture oracle. Root executes only after exact ops command review, never author. */
export async function runStagedProofInspectorIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const [[existing]] = await pool.query<RowDataPacket[]>('SELECT id FROM posts LIMIT 1');
  assert.ok(!existing, 'inspector oracle requires empty disposable corpus');
  const target = randomUUID(),
    now = new Date(),
    manifest = JSON.stringify({ coverage: 'all-current-indexed-article-tags' }),
    selection = digest(target),
    label = '蛤蜊絲瓜',
    term = digest(label),
    blogs: number[] = [],
    posts: number[] = [],
    runs: string[] = [];
  let checks = 0;
  const events: string[] = [];
  const scanPins = {
      target,
      manifestSha256: createHash('sha256').update(manifest).digest('hex'),
      policyVersion: POLICY_VERSION,
      selectionId: selection,
      matcherVersion: MATCHER_VERSION,
      cleanupVersion: CLEANUP_VERSION,
    },
    controls = { enabled: true, proofMode: STAGED_PROOF_VERSION, now: () => now };
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
  const create = async (body: boolean) => {
    const slug = `inspect-${randomUUID()}`,
      home = `https://${slug}.example/`,
      url = home + 'post?id=1';
    const [b] = await pool.execute<ResultSetHeader>("INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES(?,?,?,'verified',?)", [
      slug,
      slug,
      home,
      now,
    ]);
    blogs.push(b.insertId);
    const [p] = await pool.execute<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,content_hash,published_at,created_at) VALUES(?,?,?,?,?,NULL,?)',
      [b.insertId, randomUUID(), url, label, digest('metadata'), now],
    );
    posts.push(p.insertId);
    if (body)
      await pool.execute(
        `INSERT INTO content_post_bodies(post_id,blog_id,body_text,content_hash,completeness,status,source_kind,source_url,article_url,adapter_id,adapter_version,rule_revision,obtained_at,next_attempt_at,last_attempt_at,coverage) VALUES (?,?,?,?,'full','ok','rss-content',?,?,'generic-public',?,1,?,?,?,'full')`,
        [p.insertId, b.insertId, label, digest(label), home + 'feed/', url, CONTENT_VERSION, now, now, now],
      );
    return { post: p.insertId, blog: b.insertId, home, url };
  };
  const input = (ids: number[]): InspectorInput => ({
    enabled: true,
    target,
    postIds: ids,
    pins: {
      manifestSha256: scanPins.manifestSha256,
      policyVersion: POLICY_VERSION,
      selectionId: selection,
      matcherVersion: MATCHER_VERSION,
      cleanupVersion: CLEANUP_VERSION,
      proofVersion: STAGED_PROOF_VERSION,
      fingerprintVersion: TOPIC_FINGERPRINT_VERSION,
    },
  });
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
    const full = await create(true),
      title = await create(false);
    check(dto(await enrollStagedScanProof(pool, scanPins, controls)).status === 'enrolled', 'enroll legitimate emptytarget');
    const started = dto(await startStagedScan(pool, scanPins, controls));
    check(started.status === 'scanning', 'legitimate scanner started');
    const run = String(started.runId);
    runs.push(run);
    check(
      dto(await runStagedScanBatch(pool, { runId: run, expectedCursor: 0 }, controls)).status === 'scanned-as-of',
      'capture proofs through real scanner, not fabricated validrows',
    );
    const request = input([full.post, title.post, 2147483647]);
    const individual = async () => {
      const result = await inspectStagedProof(pool, request, { maxDurationMs: 5000 });
      check(
        result.status === 'ok' &&
          result.items.length === request.postIds.length &&
          result.items.every((item, n) => item.postId === request.postIds[n]),
        'individual oracle status and exact requested IDs, never vacuous',
      );
      return result;
    };
    let out = await individual();
    check(
      out.status === 'ok' &&
        out.items[0].titleFresh &&
        out.items[0].bodyFresh &&
        out.items[1].titleFresh &&
        !out.items[1].bodyFresh &&
        !out.items[2].titleFresh,
      'full/title-only/missing ID flags',
    );
    check(!/fingerprint|hash|body_text|url|canVerify/.test(JSON.stringify(out)), 'DTO no private metadata');
    const query = stagedProofInspectorQueryForTests(request),
      select = query.sql.replace(/^SET STATEMENT max_statement_time=0\.25 FOR /, '');
    const [[explain]] = await pool.query<RowDataPacket[]>(`EXPLAIN FORMAT=JSON ${select}`, query.values);
    const plan = JSON.parse(explain.EXPLAIN);
    let nodes = 0;
    const containsTarget = (v: unknown, depth = 0): boolean => {
      if (depth > 40 || ++nodes > 10000) throw Error('explain-plan-cap');
      if (!v || typeof v !== 'object') return false;
      if ((v as Record<string, unknown>).table_name === 't') return true;
      return Object.values(v).some((x) => containsTarget(x, depth + 1));
    };
    const generationMaterialized = (v: unknown, depth = 0): boolean => {
      if (depth > 40) throw Error('explain-plan-cap');
      if (!v || typeof v !== 'object') return false;
      const r = v as Record<string, unknown>;
      if (r.materialized && containsTarget(r.materialized)) return true;
      return Object.values(r).some((x) => generationMaterialized(x, depth + 1));
    };
    const materialized = generationMaterialized(plan);
    check(materialized, 'actual EXPLAIN generation SHA derivedtable materialized; otherwise hold no costclaim');
    // Body withdrawal/new arrival do not invalidate a correctly captured title fingerprint.
    await pool.execute("UPDATE content_post_bodies SET status='missing' WHERE post_id=?", [full.post]);
    out = await individual();
    check(out.items[0].titleFresh && !out.items[0].bodyFresh, 'body withdrawal preserves metadata/title');
    await pool.execute("UPDATE content_post_bodies SET status='ok' WHERE post_id=?", [full.post]);
    await pool.execute(
      `INSERT INTO content_post_bodies(post_id,blog_id,body_text,content_hash,completeness,status,source_kind,source_url,article_url,adapter_id,adapter_version,rule_revision,obtained_at,next_attempt_at,last_attempt_at,coverage) VALUES (?,?,?,?,'full','ok','rss-content',?,?,'generic-public',?,1,?,?,?,'full')`,
      [title.post, title.blog, label, digest(label), title.home + 'feed/', title.url, CONTENT_VERSION, now, now, now],
    );
    out = await individual();
    check(out.items[1].titleFresh && !out.items[1].bodyFresh, 'newbody does not magically match oldtitle-only proof');
    for (const status of ['seed', 'rejected', 'moved']) {
      await pool.execute('UPDATE blogs SET status=? WHERE id=?', [status, full.blog]);
      out = await individual();
      check(!out.items[0].titleFresh && out.items[0].reason === 'unavailable', `${status} masked`);
    }
    await pool.execute("UPDATE blogs SET status='verified' WHERE id=?", [full.blog]);
    for (const [column, value, original] of [
      ['url', full.url + '&id2=2', full.url],
      ['title', '同hash改標題', label],
      ['published_at', new Date(now.getTime() + 86400000), null],
    ] as const) {
      await pool.execute(`UPDATE posts SET ${column}=? WHERE id=?`, [value, full.post]);
      out = await individual();
      check(!out.items[0].titleFresh, 'samehash metadata or future invalid');
      await pool.execute(`UPDATE posts SET ${column}=? WHERE id=?`, [original, full.post]);
    }
    await pool.execute('UPDATE content_post_bodies SET source_url=? WHERE post_id=?', ['https://foreign.example/feed', full.post]);
    out = await individual();
    check(out.items[0].titleFresh && !out.items[0].bodyFresh, 'samehash sourceURL invalidates body only');
    await pool.execute('UPDATE content_post_bodies SET source_url=? WHERE post_id=?', [full.home + 'feed/', full.post]);
    await pool.execute('UPDATE topic_index_proofs SET checked_at=? WHERE snapshot_id=? AND post_id=?', [
      new Date(now.getTime() + 86400000),
      target,
      full.post,
    ]);
    out = await individual();
    check(!out.items[0].titleFresh, 'future proof timestamp is not fresh');
    await pool.execute('UPDATE topic_index_proofs SET checked_at=observed_at WHERE snapshot_id=? AND post_id=?', [target, full.post]);
    // Independent corrupt/changed fields: restore each original before the next case.
    for (const [table, column, value, post, titleExpected] of [
      ['topic_index_proofs', 'body_fingerprint', null, full.post, true],
      // metadata_fingerprint is NOT NULL: use a mismatching value, never relax DDL to test a NULL write.
      ['topic_index_proofs', 'metadata_fingerprint', 'a'.repeat(64), full.post, false],
      ['topic_index_proofs', 'body_content_hash', 'a'.repeat(64), title.post, false],
      ['topic_index_proofs', 'matcher_version', 'unknown', full.post, false],
      ['topic_post_indexes_v3', 'input_hash', 'a'.repeat(64), full.post, false],
      ['topic_index_proofs', 'checked_at', new Date(now.getTime() - 86400000), full.post, false],
    ] as const) {
      const [[saved]] = await pool.query<RowDataPacket[]>(`SELECT ${column} value FROM ${table} WHERE snapshot_id=? AND post_id=?`, [
        target,
        post,
      ]);
      await pool.execute(`UPDATE ${table} SET ${column}=? WHERE snapshot_id=? AND post_id=?`, [value, target, post]);
      out = await individual();
      const item = out.items.find((x) => x.postId === post)!;
      check(item.titleFresh === titleExpected && !item.bodyFresh, 'independent proof/index expectation or timestamp negative');
      await pool.execute(`UPDATE ${table} SET ${column}=? WHERE snapshot_id=? AND post_id=?`, [saved.value, target, post]);
    }
    for (const [column, value] of [
      ['blog_id', title.blog],
      ['source_updated_at', new Date(now.getTime() - 86400000)],
      ['body_text', 'x'.repeat(500001)],
    ] as const) {
      const [[saved]] = await pool.query<RowDataPacket[]>(`SELECT ${column} value FROM content_post_bodies WHERE post_id=?`, [full.post]);
      await pool.execute(`UPDATE content_post_bodies SET ${column}=? WHERE post_id=?`, [value, full.post]);
      out = await individual();
      check(out.items[0].titleFresh && !out.items[0].bodyFresh, 'owner/source-updated/byte cap invalidates body only');
      await pool.execute(`UPDATE content_post_bodies SET ${column}=? WHERE post_id=?`, [saved.value, full.post]);
    }
    await pool.execute("UPDATE topic_generation_proof_contracts SET proof_version='unknown' WHERE snapshot_id=?", [target]);
    const invalidGeneration = await inspectStagedProof(pool, request, { maxDurationMs: 5000 });
    check(invalidGeneration.status === 'blocked' && invalidGeneration.items.length === 0, 'marker pin global invalid is blocked empty');
    await pool.execute('UPDATE topic_generation_proof_contracts SET proof_version=? WHERE snapshot_id=?', [STAGED_PROOF_VERSION, target]);
    const [[originalRun]] = await pool.query<RowDataPacket[]>('SELECT state_json FROM topic_staged_scan_runs WHERE run_id=?', [run]);
    const state = typeof originalRun.state_json === 'string' ? JSON.parse(originalRun.state_json) : originalRun.state_json;
    for (const key of ['target', 'version', 'manifestSha256', 'selectionId', 'policyVersion', 'matcherVersion', 'cleanupVersion']) {
      const changed = { ...state, [key]: 'unknown' };
      await pool.execute('UPDATE topic_staged_scan_runs SET state_json=? WHERE run_id=?', [JSON.stringify(changed), run]);
      out = await individual();
      check(
        out.items.every((x) => !x.titleFresh),
        'run lineage pin mutation invalid',
      );
    }
    await pool.execute('UPDATE topic_staged_scan_runs SET state_json=? WHERE run_id=?', [JSON.stringify(state), run]);
    const [[oldCurrent]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
    await pool.execute(
      'INSERT INTO topic_current(source,snapshot_id) VALUES (?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)',
      [SOURCE, target],
    );
    try {
      const published = await inspectStagedProof(pool, request, { maxDurationMs: 5000 });
      check(published.status === 'blocked' && published.items.length === 0, 'explicit target nowcurrent globalblocked empty');
    } finally {
      if (oldCurrent) await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [oldCurrent.snapshot_id, SOURCE]);
      else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    }
    // Same admission key: A's query result held, B busy; after A ends C is independent fresh SQL.
    let release!: () => void, seen!: () => void;
    const held = new Promise<void>((r) => {
        release = r;
      }),
      observed = new Promise<void>((r) => {
        seen = r;
      }),
      wrapped: Pool = Object.create(pool);
    let once = false;
    wrapped.getConnection = (async () => {
      const c = await pool.getConnection(),
        proxy: PoolConnection = Object.create(c);
      proxy.query = (async (q: unknown, args: unknown[] = []) => {
        const value = await c.query(q as never, args);
        if (!once) {
          once = true;
          events.push('A:read-held');
          seen();
          await held;
        }
        return value;
      }) as PoolConnection['query'];
      proxy.release = c.release.bind(c);
      proxy.destroy = c.destroy.bind(c);
      return proxy;
    }) as Pool['getConnection'];
    const A = inspectStagedProof(wrapped, request, { maxDurationMs: 5000 });
    A.catch(() => {});
    try {
      await Promise.race([
        observed,
        A.then(() => {
          throw Error('admission-barrier-missed');
        }),
      ]);
      await pool.execute("UPDATE blogs SET status='rejected' WHERE id=?", [full.blog]);
      events.push('hide:commit');
      const B = await inspectStagedProof(wrapped, request, { maxDurationMs: 5000 });
      check(B.status === 'busy' && B.items.length === 0, 'samepool Bbusy has no Aolditems, not B0freshsuccess');
      release();
      await A;
      events.push('A:return');
      const C = await inspectStagedProof(wrapped, request, { maxDurationMs: 5000 });
      check(
        C.status === 'ok' &&
          C.items.length === request.postIds.length &&
          C.items.every((item, n) => item.postId === request.postIds[n]) &&
          !C.items[0].titleFresh,
        'afterA Cnewstatement masks committedhide',
      );
      events.push('C:fresh');
    } finally {
      release();
      await A.catch(() => {});
    }
    await pool.execute("UPDATE blogs SET status='verified' WHERE id=?", [full.blog]);
    await pool.execute('DELETE FROM content_post_bodies WHERE post_id=?', [full.post]);
    out = await individual();
    check(out.items[0].titleFresh && !out.items[0].bodyFresh, 'allNULL missingbody fingerprint cannot be proof');
    // An absent proof produces SQL NULL through LEFT JOIN without violating its NOT NULL column.
    await pool.execute('DELETE FROM topic_index_proofs WHERE snapshot_id=? AND post_id=?', [target, title.post]);
    out = await individual();
    check(!out.items[1].titleFresh && !out.items[1].bodyFresh, 'absent proof NULL metadata expectation is unavailable');
    await pool.execute('DELETE FROM posts WHERE id=?', [full.post]);
    out = await individual();
    check(!out.items[0].titleFresh && out.items[0].reason === 'unavailable', 'deleted post masked nextfreshread');
    return {
      checks,
      events,
      generationMaterialized: materialized,
      readerAdopted: false,
      publicB0Claim: false,
      cooperativeWriterOnly: true,
      performanceClaim: false,
    };
  } finally {
    await pool.execute('DELETE FROM topic_index_proofs WHERE snapshot_id=?', [target]);
    for (const table of [
      'topic_matches_v3',
      'topic_post_indexes_v3',
      'topic_canonical_terms_v3',
      'topic_policy_selections',
      'topic_snapshot_runs',
    ])
      await pool.execute(`DELETE FROM ${table} WHERE snapshot_id=?`, [target]);
    await pool.execute('DELETE FROM topic_generation_proof_contracts WHERE snapshot_id=?', [target]);
    await pool.query('UPDATE topic_staged_scan_owner SET run_id=NULL WHERE source=? AND run_id IN (?)', [
      SOURCE,
      runs.length ? runs : ['none'],
    ]);
    await pool.execute('DELETE FROM topic_staged_scan_runs WHERE target_snapshot_id=?', [target]);
    await pool.execute('DELETE FROM topic_snapshots WHERE id=?', [target]);
    if (posts.length) {
      await pool.query('DELETE FROM content_post_bodies WHERE post_id IN (?)', [posts]);
      await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    }
    if (blogs.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
  }
}
