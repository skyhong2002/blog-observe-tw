/**
 * Disposable rehearsal of migration 0035 through the real tools/migrate-drizzle.mjs:
 *   1. a held metadata lock makes the second CREATE INDEX fail after the first one committed → not recorded;
 *   2. the rerun completes the remaining indexes and records 0035 once; a third run is a no-op;
 *   3. a same-name index with another definition fails the migration (not recorded) until it is replaced.
 * Only a loopback :18169 test server is accepted. Usage: node tools/rehearse-migration-0035.mjs <private env file>
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import mysql from 'mysql2/promise';

const env = parseEnv(await readFile(process.argv[2], 'utf8'));
const url = new URL(env.BLOG_DB_URL);
assert.ok(['127.0.0.1', '127.0.0.2'].includes(url.hostname) && url.port === '18169', 'isolated_loopback_18169_required');
const name = 'rehearse_0035';
url.pathname = `/${name}`;
const login = {
  host: url.hostname,
  port: 18169,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  charset: 'utf8mb4',
};
const control = await mysql.createConnection(login);
await control.query(`DROP DATABASE IF EXISTS \`${name}\``);
await control.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
const db = await mysql.createConnection({ ...login, database: name });
const dir = new URL('../app/src/db/migrations/', import.meta.url);
let holder;
const result = {};
const migrate = () =>
  new Promise((resolve) =>
    execFile(
      process.execPath,
      [new URL('migrate-drizzle.mjs', import.meta.url).pathname],
      { env: { PATH: process.env.PATH, BLOG_DB_URL: url.href } },
      (error, stdout, stderr) =>
        resolve({ ok: !error, out: (`${stdout}${stderr}`.match(/^(Error: .*|\{.*)$/m) ?? [`${stdout}${stderr}`])[0].trim() }),
    ),
  );
const id = '0035_body_hash_covering_indexes';
const recorded = async () => (await db.query('SELECT COUNT(*) n FROM _blog_observe_migrations WHERE id=?', [id]))[0][0].n;
const definition = async (table, index) =>
  (
    await db.query(
      'SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?',
      [table, index],
    )
  )[0][0].c;
const state = async () => ({
  bodies: await definition('content_post_bodies', 'content_bodies_hash'),
  observations: await definition('relation_observations', 'relation_observations_hash'),
  recorded: await recorded(),
});
try {
  // Schema as of 0034, recorded in the ledger as production has it.
  for (const s of (await readFile(new URL('../db/001_init.sql', import.meta.url), 'utf8'))
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean))
    await db.query(s);
  await db.query('CREATE TABLE _blog_observe_migrations (id varchar(255) NOT NULL PRIMARY KEY, applied_at datetime NOT NULL)');
  for (const file of (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f) && !f.startsWith('0000_') && f < '0035').sort()) {
    for (const s of (await readFile(new URL(file, dir), 'utf8'))
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean))
      await db.query(s);
    await db.query('INSERT INTO _blog_observe_migrations VALUES (?,UTC_TIMESTAMP())', [file.replace(/\.sql$/, '')]);
  }
  await db.query("INSERT INTO _blog_observe_migrations VALUES ('0000_blog_observe_baseline',UTC_TIMESTAMP())");
  await db.query("INSERT INTO blogs(id,slug,name,url,status,discovered_at) VALUES (1,'b','b','https://b.example/','verified',NOW())");
  await db.query(
    "INSERT INTO posts(id,blog_id,guid,url,title,published_at,created_at) SELECT seq,1,CONCAT('g',seq),CONCAT('https://b.example/',seq),'t',NOW(),NOW() FROM seq_1_to_2000",
  );
  await db.query(
    "INSERT INTO content_post_bodies(post_id,blog_id,body_text,content_hash,completeness,status,source_kind,source_url,article_url,adapter_id,adapter_version,rule_revision,obtained_at,next_attempt_at,last_attempt_at,coverage) SELECT id,blog_id,REPEAT('字',2000),SHA2(id,256),'full','ok','feed','u','u','a','1',1,NOW(),NOW(),NOW(),'full' FROM posts",
  );
  await db.query(
    "INSERT INTO relation_observations(post_id,blog_id,body_text,content_hash,status,parser_version,observed_at,next_attempt_at) SELECT id,blog_id,REPEAT('字',1000),SHA2(id,256),'ok','1',NOW(),NOW() FROM posts WHERE id%2=0",
  );
  const log = (m) => console.error(new Date().toISOString(), m);
  log('schema at 0034 ready');

  // 1. The first index commits, then a held metadata lock fails the second after the bounded wait.
  holder = await mysql.createConnection({ ...login, database: name });
  await holder.query('START TRANSACTION');
  await holder.query('SELECT COUNT(*) FROM relation_observations');
  const started = Date.now();
  // A reader that arrives while the DDL waits queues behind it: that wait must stay within lock_wait_timeout.
  const reader = mysql.createConnection({ ...login, database: name }).then(async (c) => {
    let waiting;
    for (let i = 0; i < 600 && !waiting; i++) {
      [[waiting]] = await control.query(
        "SELECT TIME_MS ms FROM information_schema.PROCESSLIST WHERE DB=? AND STATE='Waiting for table metadata lock' AND INFO LIKE 'CREATE INDEX%'",
        [name],
      );
      if (!waiting) await new Promise((r) => setTimeout(r, 100));
    }
    result.ddlWaitSeenAfterMs = Date.now() - started;
    const t = Date.now();
    await c.query('SELECT COUNT(*) FROM relation_observations');
    await c.end();
    return Date.now() - t;
  });
  log('metadata lock held; migrating');
  const failed = await migrate();
  log(`first run: ${failed.out}`);
  result.partialFailure = {
    ...failed,
    seconds: Math.round((Date.now() - started) / 1000),
    readerWaitMs: await reader,
    after: await state(),
  };
  assert.equal(failed.ok, false);
  assert.ok(result.partialFailure.readerWaitMs < 6_000, 'readers queue at most lock_wait_timeout (5 s) behind the DDL');
  assert.match(failed.out, /0035_body_hash_covering_indexes failed: Lock wait timeout/);
  assert.deepEqual(result.partialFailure.after, { bodies: 'post_id,blog_id,status,content_hash', observations: null, recorded: 0 });
  await holder.end();
  holder = undefined;

  // 2. Rerun finishes the rest and records once; a third run applies nothing.
  log('lock released; rerun');
  const rerun = await migrate();
  result.rerun = { ...rerun, after: await state() };
  assert.equal(rerun.ok, true, rerun.out);
  assert.deepEqual(JSON.parse(rerun.out).applied, [id]);
  assert.deepEqual(result.rerun.after, {
    bodies: 'post_id,blog_id,status,content_hash',
    observations: 'post_id,blog_id,status,content_hash',
    recorded: 1,
  });
  const again = await migrate();
  assert.deepEqual(JSON.parse(again.out).applied, []);
  result.thirdRun = again.out;

  // 3. Same name, other definition (unrecorded): the migration fails and stays unrecorded until it is replaced.
  await db.query('DELETE FROM _blog_observe_migrations WHERE id=?', [id]);
  await db.query('DROP INDEX content_bodies_hash ON content_post_bodies');
  await db.query('CREATE INDEX content_bodies_hash ON content_post_bodies (post_id,status)');
  const wrong = await migrate();
  result.wrongDefinition = { ...wrong, after: await state() };
  assert.equal(wrong.ok, false);
  assert.match(wrong.out, /content_bodies_hash: existing index definition differs/);
  assert.equal(result.wrongDefinition.after.recorded, 0);
  await db.query('DROP INDEX content_bodies_hash ON content_post_bodies');
  const fixed = await migrate();
  result.afterReplace = { ...fixed, after: await state() };
  assert.equal(fixed.ok, true, fixed.out);
  assert.equal(result.afterReplace.after.bodies, 'post_id,blog_id,status,content_hash');
  assert.equal(result.afterReplace.after.recorded, 1);
  result.ledger = (await db.query("SELECT COUNT(*) n FROM _blog_observe_migrations WHERE id LIKE '0035%'"))[0][0].n;
  assert.equal(result.ledger, 1);
  console.log(JSON.stringify(result, null, 1));
} finally {
  holder?.destroy();
  await db.end();
  await control.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await control.end();
}
