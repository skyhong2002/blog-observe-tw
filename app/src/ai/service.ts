import { randomBytes } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { reserveBudget } from '../jobs/budget.ts';
import {
  AI_POLICY,
  type AiResult,
  type AiTask,
  inputKey,
  MODEL_ALIAS,
  NORMALIZATION,
  normalizeInput,
  validateInference,
  validateResult,
} from './contracts.ts';
import { callGateway, gatewayBody } from './gateway.ts';

const decode = (v: unknown): AiResult => (typeof v === 'string' ? JSON.parse(v) : (v as AiResult));
export type Inference = {
  status: 'ok' | 'deferred' | 'failed';
  result?: AiResult;
  cacheKey: string;
  actualModel?: string;
  overridden?: boolean;
};
export async function infer(
  pool: Pool,
  task: AiTask,
  entityType: 'blog' | 'post' | 'candidate',
  entityId: number,
  rawInput: string,
  coverage: string,
  options: { now?: () => Date; signal?: AbortSignal; gateway?: typeof callGateway } = {},
): Promise<Inference> {
  const input = normalizeInput(rawInput),
    { inputHash, cacheKey } = inputKey(task, input);
  const now = (options.now || (() => new Date()))();
  const [[override]] = await pool.query<RowDataPacket[]>(
    'SELECT result_json FROM ai_overrides WHERE entity_type=? AND entity_id=? AND task=?',
    [entityType, entityId, task],
  );
  if (override) {
    if (task === 'classification') return { status: 'deferred', cacheKey }; // Operator classification is never automatic admission evidence.
    try {
      const value = decode(override.result_json);
      return {
        status: 'ok',
        result: validateResult(value, Array.isArray(value.quotedEvidence) ? value.quotedEvidence.join('\n') : ''),
        cacheKey,
        overridden: true,
      };
    } catch {
      return { status: 'failed', cacheKey };
    }
  }
  // Include entity in cache ownership: identical evidence may be cached, but never attached to the wrong publication.
  const storageKey = inputKey(task, `${entityType}:${entityId}\0${input}`).cacheKey;
  await pool.execute(
    `INSERT IGNORE INTO ai_results (task,entity_type,entity_id,cache_key,input_hash,coverage,status,model_alias,policy,normalization_version,attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,'pending',?,?,?,0,?,?)`,
    [task, entityType, entityId, storageKey, inputHash, coverage, MODEL_ALIAS, AI_POLICY, NORMALIZATION, now, now],
  );
  const [[row]] = await pool.query<RowDataPacket[]>('SELECT * FROM ai_results WHERE cache_key=?', [storageKey]);
  if (row.status === 'ok') {
    try {
      return {
        status: 'ok',
        result: validateInference(task, decode(row.result_json), input),
        cacheKey: storageKey,
        actualModel: row.actual_model,
      };
    } catch {
      return { status: 'failed', cacheKey: storageKey };
    }
  }
  if (row.attempts >= 3 || (row.next_attempt_at && new Date(row.next_attempt_at) > now) || options.signal?.aborted)
    return { status: 'deferred', cacheKey: storageKey };
  // CAS is a crash-safe short lease. An attempt lost after reservation still consumes budget.
  const claimToken = randomBytes(16).toString('hex');
  const [claim] = await pool.execute<ResultSetHeader>(
    "UPDATE ai_results SET status='running',claim_token=?,next_attempt_at=?,updated_at=? WHERE id=? AND status<>'ok' AND attempts<3 AND (next_attempt_at IS NULL OR next_attempt_at<=?)",
    [claimToken, new Date(now.getTime() + 600000), now, row.id, now],
  );
  if (claim.affectedRows !== 1) return { status: 'deferred', cacheKey: storageKey };
  const permitted = await reserveBudget(
    pool,
    [
      { scope: 'ai:attempts', amount: 1, limit: 10 },
      { scope: `ai:task:${task}`, amount: 1, limit: task === 'classification' ? 6 : 2 },
      { scope: 'ai:tokens', amount: Buffer.byteLength(gatewayBody(task, input)) + 1500, limit: 80000 },
    ],
    now,
  );
  if (!permitted) {
    await pool.execute("UPDATE ai_results SET status='pending',next_attempt_at=? WHERE id=? AND claim_token=?", [
      new Date(now.getTime() + 6 * 3600000),
      row.id,
      claimToken,
    ]);
    return { status: 'deferred', cacheKey: storageKey };
  }
  const [started] = await pool.execute<ResultSetHeader>(
    "UPDATE ai_results SET attempts=attempts+1 WHERE id=? AND claim_token=? AND status='running'",
    [row.id, claimToken],
  );
  if (started.affectedRows !== 1) return { status: 'deferred', cacheKey: storageKey };
  try {
    const value = await (options.gateway || callGateway)(task, input, { signal: options.signal });
    value.result = validateInference(task, value.result, input);
    const [saved] = await pool.execute<ResultSetHeader>(
      "UPDATE ai_results SET status='ok',last_error=NULL,result_json=?,actual_model=?,next_attempt_at=NULL,updated_at=? WHERE id=? AND claim_token=?",
      [JSON.stringify(value.result), value.actualModel, (options.now || (() => new Date()))(), row.id, claimToken],
    );
    if (saved.affectedRows !== 1) return { status: 'deferred', cacheKey: storageKey };
    return { status: 'ok', ...value, cacheKey: storageKey };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const lastError =
      /^gateway_(?:http_\d{3}|response_too_large|empty|incomplete|model_missing|input_too_large|key_unavailable)$|^(?:invalid|ungrounded)_output$/.test(
        message,
      )
        ? message
        : 'gateway_request_failed';
    await pool.execute("UPDATE ai_results SET status='failed',last_error=?,next_attempt_at=?,updated_at=? WHERE id=? AND claim_token=?", [
      lastError,
      new Date(now.getTime() + 6 * 3600000 * 2 ** Number(row.attempts)),
      now,
      row.id,
      claimToken,
    ]);
    return { status: 'failed', cacheKey: storageKey };
  }
}
