import assert from 'node:assert/strict';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { scanRevalidationCandidates, selectRevalidationCandidates } from './history-worker.ts';
import { digest } from './policy.ts';

/** The index walk must return exactly what the full hash scan returns, across window bounds. */
export async function runHistoryCandidatesIntegration(pool: Pool) {
  assert.equal(
    (pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool.config.connectionConfig.port,
    18169,
    'clone-only history candidate integration',
  );
  const time = new Date('2061-03-01T00:00:00Z'),
    hours = (n: number) => new Date(time.getTime() + n * 3600_000);
  const [b] = await pool.execute<ResultSetHeader>("INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,'verified',?)", [
    'history-candidates',
    '候選測試',
    'https://candidates.example/',
    time,
  ]);
  const posts: number[] = [];
  for (let i = 0; i < 240; i++) {
    const [p] = await pool.execute<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,content_hash,published_at,created_at) VALUES (?,?,?,?,?,?,?)',
      [b.insertId, `c${i}`, `https://candidates.example/${i}`, `候選${i}`, digest(`post${i}`), time, time],
    );
    posts.push(p.insertId);
  }
  // Every fourth post keeps a stored body; the rest compare against a NULL body hash.
  for (const id of posts.filter((_, i) => i % 4 === 0))
    await pool.execute(
      "INSERT INTO relation_observations(post_id,blog_id,body_text,content_hash,status,parser_version,observed_at,next_attempt_at) VALUES (?,?,'x',?,'ok','fixture',?,?)",
      [id, b.insertId, digest(`body${id}`), time, time],
    );
  await pool.query(
    `INSERT INTO topic_pages(canonical_id,label,normalized_label,state,first_snapshot_id,last_snapshot_id,first_observed_at,last_observed_at,updated_at)
     SELECT SHA2(CONCAT('cand',seq),256),CONCAT('候選',seq),CONCAT('候選',seq),IF(seq%97=0,'merged','active'),'s','s',?,?,? FROM seq_1_to_5000`,
    [time, time, time],
  );
  // Post 0 holds 4500 rows at one mid-range time, so a window can end inside one post or grow past it.
  // The rest spread over stale and fresh times (some tied with post 0) with matching, changed and missing hashes.
  await pool.query(
    `INSERT INTO topic_article_evidence(canonical_id,post_id,source,state,source_snapshot_id,post_hash,body_hash,matcher_version,first_observed_at,last_observed_at,checked_at)
     SELECT SHA2(CONCAT('cand',seq),256),?,'title','confirmed','s',?,NULL,'m',?,?,? FROM seq_1_to_4500`,
    [posts[0], digest('post0'), hours(-20), hours(-20), hours(-20)],
  );
  await pool.query(
    `INSERT INTO topic_article_evidence(canonical_id,post_id,source,state,source_snapshot_id,post_hash,body_hash,matcher_version,first_observed_at,last_observed_at,checked_at)
     SELECT SHA2(CONCAT('cand',t.seq),256),p.id,IF(t.seq%2,'title','body'),
       ELT(1+(p.id*7+t.seq)%9,'confirmed','confirmed','confirmed','confirmed','confirmed','confirmed','pending','revoked','confirmed'),
       's',IF((p.id+t.seq)%11=0,'changed',SHA2(CONCAT('post',p.n),256)),IF(p.n%4=0 AND (p.id+t.seq)%13,SHA2(CONCAT('body',p.id),256),NULL),'m',?,?,
       ? + INTERVAL ((p.id*31+t.seq*17)%(54*60)) MINUTE
     FROM (SELECT id,ROW_NUMBER() OVER (ORDER BY id)-1 n FROM posts WHERE blog_id=?) p JOIN seq_1_to_40 t ON t.seq<=1+(p.id*13)%40 WHERE p.n>0`,
    [hours(-48), hours(-48), hours(-48), b.insertId],
  );
  await pool.execute('DELETE FROM posts WHERE id IN (?,?)', [posts[7], posts[9]]);
  // Count which path each fast call took.
  let scans = 0;
  const spy = new Proxy(pool, {
    get(target, key) {
      if (key === 'query')
        return (sql: string, ...args: unknown[]) => {
          if (sql.includes('MIN(e.checked_at)')) scans++;
          return (target.query as (...a: unknown[]) => unknown)(sql, ...args);
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const paths = { walk: 0, fallback: 0 };
  for (const cutoff of [hours(-50), hours(-30), hours(-19), hours(0), hours(6), hours(40)])
    for (const limit of [1, 2, 50, 120, 150, 180, 200, 220, 250]) {
      scans = 0;
      const fast = await selectRevalidationCandidates(spy, cutoff, limit);
      paths[scans ? 'fallback' : 'walk']++;
      const full = await scanRevalidationCandidates(pool, cutoff, limit);
      assert.deepEqual(
        fast.map((r) => [Number(r.post_id), new Date(r.oldest).getTime()]),
        full.map((r) => [Number(r.post_id), new Date(r.oldest).getTime()]),
        `cutoff ${cutoff.toISOString()} limit ${limit}`,
      );
    }
  assert.ok(paths.walk >= 10 && paths.fallback >= 5, JSON.stringify(paths));
  return paths;
}
