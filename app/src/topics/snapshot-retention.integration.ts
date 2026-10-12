import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { SOURCE } from './snapshot-client.ts';
import { canStartWindowSnapshot, cleanupTopicSnapshots } from './snapshot-retention.ts';
import { syncVocabulary } from './sync.ts';

/** Run only through the isolated SQL suite. Never point this fixture at the production database. */
export async function runSnapshotRetentionIntegration(pool: Pool) {
  assert.equal((pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool.config.connectionConfig.port, 18169);
  const [existing] = await pool.query<RowDataPacket[]>('SELECT id FROM topic_snapshots');
  const preserved = existing.map((r) => String(r.id));
  const [[originalCurrent]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
  const names = ['delete', 'current', 'parent', 'staging', 'ready', 'pinned', 'import', 'legacy', 'v2', 'full', 'newer', 'newest'] as const;
  const ids = Object.fromEntries(names.map((name) => [name, randomUUID()])) as Record<(typeof names)[number], string>;
  const child = randomUUID(),
    all = [...Object.values(ids), child],
    pointer = `retention-fixture-${randomUUID()}`,
    pinned = [...preserved, ids.pinned],
    now = new Date('2040-01-01T00:00:00Z');
  const has = async (id: string) => {
    const [[row]] = await pool.query<RowDataPacket[]>('SELECT status FROM topic_snapshots WHERE id=?', [id]);
    return row?.status ?? null;
  };
  try {
    for (const [offset, name] of names.entries()) {
      const status = name === 'staging' || name === 'ready' ? name : 'published';
      await pool.execute('INSERT INTO topic_snapshots(id,manifest,status,generated_at) VALUES (?,?,?,?)', [
        ids[name],
        JSON.stringify({ coverage: name === 'full' ? 'all-current-indexed-article-tags' : 'observed-article-window' }),
        status,
        new Date(now.getTime() + offset * 1000),
      ]);
      await pool.execute('INSERT INTO topic_window_runs(id,since_at,until_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?)', [
        ids[name],
        now.toISOString(),
        now.toISOString(),
        status,
        now,
        now,
      ]);
      await pool.execute('INSERT INTO topic_terms(snapshot_id,id,label,normalized_label,payload) VALUES (?,?,?,?,?)', [
        ids[name],
        'a'.repeat(64),
        '測試詞',
        '測試詞',
        '{}',
      ]);
    }
    await pool.execute('INSERT INTO topic_current(source,snapshot_id) VALUES (?,?)', [pointer, ids.current]);
    await pool.execute(
      "INSERT INTO topic_window_runs(id,parent_run_id,since_at,until_at,status,created_at,updated_at) VALUES (?,?,?,?,'scanning',?,?)",
      [child, ids.parent, now.toISOString(), now.toISOString(), now, now],
    );
    await pool.execute("INSERT INTO topic_snapshot_runs(snapshot_id,manifest,status,created_at,updated_at) VALUES (?,?,'preparing',?,?)", [
      ids.import,
      '{}',
      now,
      now,
    ]);
    for (const [table, id, post] of [
      ['topic_post_indexes', ids.legacy, 2_000_000_001],
      ['topic_post_indexes_v2', ids.v2, 2_000_000_002],
      ['topic_post_indexes_v3', ids.delete, 2_000_000_003],
    ] as const) {
      const versioned = table !== 'topic_post_indexes';
      await pool.execute(
        `INSERT INTO ${table}(post_id,snapshot_id,input_hash,matched_at${versioned ? ',matcher_version,cleanup_version,body_kind' : ''}) VALUES (?,?,?,?${versioned ? ',?,?,?' : ''})`,
        [post, id, 'b'.repeat(64), now, ...(versioned ? ['fixture', 'fixture', 'empty'] : [])],
      );
    }
    await pool.execute("INSERT INTO topic_matches_v3(snapshot_id,post_id,term_id,source) VALUES (?,?,?,'title')", [
      ids.delete,
      2_000_000_003,
      'a'.repeat(64),
    ]);
    const options = { keepPublished: 2, pinnedSnapshotIds: pinned, maxMs: 10_000 };
    let checks = 0;
    await assert.rejects(
      cleanupTopicSnapshots(
        pool,
        async () => {
          if (++checks === 2) throw Error('lease-lost-fixture');
        },
        options,
      ),
      /lease-lost-fixture/,
    );
    assert.equal(await has(ids.delete), 'published', 'lost lease rolls back both retirement and deletions');
    const [[untouched]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM topic_matches_v3 WHERE snapshot_id=?', [ids.delete]);
    assert.equal(Number(untouched.n), 1);
    const partial = await cleanupTopicSnapshots(pool, async () => {}, { ...options, maxRows: 1, batchRows: 1 });
    assert.equal(partial.deletedRows, 1);
    assert.equal(partial.retiredSnapshots, 0);
    assert.equal(partial.backlog, true);
    assert.equal(await has(ids.delete), 'retiring', 'partial retirement has durable status');
    assert.equal(await has(ids.current), 'published');
    const [[raw]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM topic_terms WHERE snapshot_id=?', [ids.delete]);
    assert.equal(Number(raw.n), 1, 'raw terms outlive indexed evidence during partial cleanup');
    // Even a partially retired snapshot is protected if an external recovery process pins it.
    const paused = await cleanupTopicSnapshots(pool, async () => {}, { ...options, pinnedSnapshotIds: [...pinned, ids.delete] });
    assert.equal(paused.deletedRows, 0);
    assert.equal(await has(ids.delete), 'retiring');
    const complete = await cleanupTopicSnapshots(
      pool,
      async () => {
        checks++;
      },
      options,
    );
    assert.equal(complete.retiredSnapshots, 1);
    assert.equal(complete.backlog, false);
    assert.equal(await has(ids.delete), null);
    for (const name of names.filter((name) => name !== 'delete')) assert.ok(await has(ids[name]), `${name} snapshot protected`);
    for (const table of ['topic_matches_v3', 'topic_post_indexes_v3', 'topic_terms']) {
      const [[row]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM ${table} WHERE snapshot_id=?`, [ids.delete]);
      assert.equal(Number(row.n), 0);
    }
    const state = await canStartWindowSnapshot(pool);
    assert.equal((await canStartWindowSnapshot(pool, state.publishedVersions - 1)).blocked, true);
    assert.equal((await canStartWindowSnapshot(pool, state.publishedVersions)).allowed, true);
    const repeat = await cleanupTopicSnapshots(pool, async () => {}, options);
    assert.equal(repeat.deletedRows, 0);
    await pool.execute("UPDATE topic_window_runs SET status='failed-schema' WHERE id=?", [child]);
    const capChild = randomUUID();
    all.push(capChild);
    await pool.execute(
      "INSERT INTO topic_window_runs(id,parent_run_id,since_at,until_at,status,created_at,updated_at) VALUES (?,?,?,?,'cap-terms',?,?)",
      [capChild, ids.parent, now.toISOString(), now.toISOString(), now, now],
    );
    const failedCleanup = await cleanupTopicSnapshots(pool, async () => {}, options);
    assert.equal(failedCleanup.retiredSnapshots, 1);
    assert.equal(await has(ids.parent), null, 'terminal failed-schema/cap children do not pin their parent forever');
    // Make all existing fixture runs terminal so the sync guard scenario controls its own active run.
    await pool.query("UPDATE topic_window_runs SET status='failed-schema',next_attempt_at=NULL WHERE id IN (?)", [all]);
    for (let i = 0; i < 65; i++) {
      const id = randomUUID();
      all.push(id);
      await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at) VALUES (?,?,'published',?)", [
        id,
        JSON.stringify({ coverage: 'observed-article-window' }),
        now,
      ]);
      await pool.execute('INSERT INTO topic_current(source,snapshot_id) VALUES (?,?)', [`${pointer}-${i}`, id]);
    }
    let requests = 0;
    const syncOptions = {
      enabled: true,
      now: () => now,
      maxPages: 1,
      source: {
        page: async () => {
          requests++;
          return { articles: [], nextCursor: 'resume-fixture' };
        },
      },
    };
    const blocked = await syncVocabulary(pool, syncOptions);
    assert.equal(blocked.status, 'retention-blocked');
    assert.equal(requests, 0, 'capacity guard stops a new run before upstream calls');
    const resumeId = randomUUID();
    all.push(resumeId);
    await pool.execute("INSERT INTO topic_window_runs(id,since_at,until_at,status,created_at,updated_at) VALUES (?,?,?,'scanning',?,?)", [
      resumeId,
      now.toISOString(),
      now.toISOString(),
      now,
      now,
    ]);
    const resumed = await syncVocabulary(pool, syncOptions);
    assert.equal(resumed.status, 'incomplete');
    assert.equal('version' in resumed && resumed.version, resumeId);
    assert.equal(requests, 1, 'existing scanning run resumes despite capacity guard');
    await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at) VALUES (?,?,'retiring',?)", [
      resumeId,
      JSON.stringify({ coverage: 'observed-article-window' }),
      now,
    ]);
    await pool.execute("UPDATE topic_window_runs SET status='ready' WHERE id=?", [resumeId]);
    const retired = await syncVocabulary(pool, syncOptions);
    assert.equal(retired.status, 'retired');
    assert.equal(await has(resumeId), 'retiring', 'publication never resurrects a partially deleted snapshot');
    const [[failedRun]] = await pool.query<RowDataPacket[]>('SELECT status FROM topic_window_runs WHERE id=?', [resumeId]);
    assert.equal(failedRun.status, 'failed-retired', 'rejected publication cannot keep pinning the retired generation');
    const [[current]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
    assert.equal(current?.snapshot_id, originalCurrent?.snapshot_id);
    return {
      boundedResume: true,
      rollbackProtected: true,
      currentProtected: true,
      activeParentProtected: true,
      fullImportProtected: true,
      pinnedProtected: true,
      leaseLossAtomic: true,
      guardBlocksBacklog: true,
      existingRunResumes: true,
      terminalRunsDoNotPin: true,
      retiringNeverRepublished: true,
    };
  } finally {
    await pool.query('DELETE FROM topic_current WHERE snapshot_id IN (?) AND source<>?', [all, SOURCE]);
    for (const table of [
      'topic_matches_v3',
      'topic_post_indexes_v3',
      'topic_post_indexes_v2',
      'topic_post_indexes',
      'topic_snapshot_runs',
      'topic_terms',
    ])
      await pool.query(`DELETE FROM ${table} WHERE snapshot_id IN (?)`, [all]);
    await pool.query('DELETE FROM topic_window_runs WHERE id IN (?)', [all]);
    await pool.query('DELETE FROM topic_snapshots WHERE id IN (?)', [all]);
    await pool.execute("DELETE FROM work_budgets WHERE day=? AND scope LIKE 'topics:%'", [now.toISOString().slice(0, 10)]);
  }
}
