import { readFile } from 'node:fs/promises';
import { validateResult } from '../app/src/ai/contracts.ts';
import { loadConfig } from '../app/src/config.js';
import { createDb } from '../app/src/db/client.ts';

const [entityType, idText, task, file, actor, note] = process.argv.slice(2);
const id = Number(idText);
if (
  !['blog', 'post'].includes(entityType) ||
  !Number.isSafeInteger(id) ||
  id < 1 ||
  !['profile', 'topics'].includes(task) ||
  (entityType === 'blog' ? task !== 'profile' : task !== 'topics') ||
  !file ||
  !actor ||
  actor.length > 128 ||
  !note ||
  note.length > 500
)
  throw Error('Usage: ai-override.ts blog|post ID profile|topics JSON_FILE ACTOR NOTE');
const raw = await readFile(file, 'utf8');
if (Buffer.byteLength(raw) > 16000) throw Error('override too large');
const parsed = JSON.parse(raw);
const value = validateResult(parsed, Array.isArray(parsed.quotedEvidence) ? parsed.quotedEvidence.join('\n') : '');
const db = createDb(loadConfig().blogDbUrl, { poolSize: 2 });
try {
  await db.pool.execute(
    'INSERT INTO ai_overrides (entity_type,entity_id,task,result_json,actor,note,updated_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE result_json=VALUES(result_json),actor=VALUES(actor),note=VALUES(note),updated_at=VALUES(updated_at)',
    [entityType, id, task, JSON.stringify(value), actor, note],
  );
  console.log(JSON.stringify({ entityType, id, task, overridden: true }));
} finally {
  await db.close();
}
