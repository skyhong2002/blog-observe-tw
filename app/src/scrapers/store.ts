import { createHash } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MODEL_ALIAS } from '../ai/contracts.ts';
import type { GeneratedScraper, ScraperTrigger } from './contract.ts';

export type StoredScraper = {
  id: number;
  blogId: number | null;
  code: string;
  listUrls: string[];
  maxPages: number;
  /** Read its pages through the headless browser (render.ts). */
  render: boolean;
  consecutiveFailures: number;
};
type Sql = Pick<Pool, 'execute'>;
const listUrls = (value: unknown): string[] => {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : [];
};
const stored = (row: RowDataPacket): StoredScraper => ({
  id: Number(row.id),
  blogId: row.blog_id == null ? null : Number(row.blog_id),
  code: String(row.code),
  listUrls: listUrls(row.list_urls),
  maxPages: Number(row.max_pages) || 1,
  render: Boolean(Number(row.render)),
  consecutiveFailures: Number(row.consecutive_failures) || 0,
});
export const codeSha256 = (code: string) => createHash('sha256').update(code).digest('hex');

export async function activeScraper(db: Sql, blogId: number): Promise<StoredScraper | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT id,blog_id,code,list_urls,max_pages,render,consecutive_failures FROM blog_scrapers WHERE blog_id=? AND status='active' ORDER BY id DESC LIMIT 1",
    [blogId],
  );
  return rows[0] ? stored(rows[0]) : null;
}
export async function saveValidatedScraper(
  db: Sql,
  input: {
    blogId: number | null;
    candidateId: number | null;
    trigger: ScraperTrigger;
    scraper: GeneratedScraper;
    actualModel: string;
    validation: unknown;
  },
  now = new Date(),
) {
  const [[latest]] = await db.execute<RowDataPacket[]>(
    'SELECT COALESCE(MAX(revision),0) revision FROM blog_scrapers WHERE (blog_id IS NOT NULL AND blog_id=?) OR (candidate_id IS NOT NULL AND candidate_id=?)',
    [input.blogId, input.candidateId],
  );
  const [insert] = await db.execute<ResultSetHeader>(
    `INSERT INTO blog_scrapers (blog_id,candidate_id,revision,status,\`trigger\`,code,code_sha256,list_urls,max_pages,render,model,actual_model,validation,created_at)
     VALUES (?,?,?,'validated',?,?,?,?,?,?,?,?,?,?)`,
    [
      input.blogId,
      input.candidateId,
      Number(latest?.revision ?? 0) + 1,
      input.trigger,
      input.scraper.code,
      codeSha256(input.scraper.code),
      JSON.stringify(input.scraper.listUrls),
      input.scraper.maxPages,
      input.scraper.render,
      MODEL_ALIAS,
      input.actualModel.slice(0, 180),
      JSON.stringify(input.validation),
      now,
    ],
  );
  return insert.insertId;
}
/** Caller holds a transaction. The blog's previous active scraper is superseded in the same commit. */
export async function activateScraperOnConnection(c: PoolConnection, scraperId: number, blogId: number, sha256: string, now = new Date()) {
  const [[row]] = await c.query<RowDataPacket[]>('SELECT id,status,code_sha256 FROM blog_scrapers WHERE id=? FOR UPDATE', [scraperId]);
  if (row?.status !== 'validated' || row.code_sha256 !== sha256) return false;
  await c.execute("UPDATE blog_scrapers SET status='superseded' WHERE blog_id=? AND status='active'", [blogId]);
  await c.execute("UPDATE blog_scrapers SET status='active',blog_id=?,activated_at=? WHERE id=?", [blogId, now, scraperId]);
  return true;
}
export async function activateScraper(pool: Pool, scraperId: number, blogId: number, sha256: string, now = new Date()) {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[blog]] = await c.query<RowDataPacket[]>('SELECT status FROM blogs WHERE id=? FOR UPDATE', [blogId]);
    const ok = blog?.status === 'verified' && (await activateScraperOnConnection(c, scraperId, blogId, sha256, now));
    if (ok) await c.commit();
    else await c.rollback();
    return ok;
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
export async function recordScraperRun(db: Sql, scraperId: number, error: string | null, now = new Date()) {
  if (error)
    await db.execute(
      'UPDATE blog_scrapers SET last_run_at=?,last_error_at=?,last_error=?,consecutive_failures=consecutive_failures+1 WHERE id=?',
      [now, now, error.slice(0, 255), scraperId],
    );
  else
    await db.execute('UPDATE blog_scrapers SET last_run_at=?,last_success_at=?,last_error=NULL,consecutive_failures=0 WHERE id=?', [
      now,
      now,
      scraperId,
    ]);
}
export async function recordGenerationAttempt(
  db: Sql,
  attempt: {
    targetType: 'candidate' | 'blog';
    targetId: number;
    trigger: ScraperTrigger;
    status: string;
    reason: string | null;
    rounds: number;
    scraperId?: number | null;
    actualModel?: string | null;
    report?: unknown;
  },
  now = new Date(),
) {
  const report = attempt.report === undefined ? null : JSON.stringify(attempt.report);
  await db.execute(
    'INSERT INTO scraper_generation_attempts (target_type,target_id,`trigger`,status,reason,rounds,scraper_id,actual_model,report,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [
      attempt.targetType,
      attempt.targetId,
      attempt.trigger,
      attempt.status,
      attempt.reason?.slice(0, 255) ?? null,
      attempt.rounds,
      attempt.scraperId ?? null,
      attempt.actualModel?.slice(0, 180) ?? null,
      report && Buffer.byteLength(report) <= 256 * 1024 ? report : null,
      now,
    ],
  );
}
