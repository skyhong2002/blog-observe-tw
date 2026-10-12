import type { RowDataPacket } from 'mysql2/promise';
import { writeAudit } from '../app/src/admin/identity.ts';
import { loadConfig } from '../app/src/config.js';
import { createDb } from '../app/src/db/client.ts';

const [idText, role, note] = process.argv.slice(2);
const id = Number(idText);
if (!Number.isSafeInteger(id) || id < 1 || !['reader', 'admin'].includes(role) || !note || note.length > 500)
  throw Error('Usage: admin-role.ts USER_ID reader|admin AUDIT_NOTE');
const config = loadConfig(),
  db = createDb(config.blogDbUrl, { poolSize: 2 });
const c = await db.pool.getConnection();
try {
  await c.beginTransaction();
  const [[user]] = await c.query<RowDataPacket[]>(
    'SELECT u.role,p.email,p.google_sub,u.google_sub actual_sub FROM users u LEFT JOIN admin_google_identities p ON p.user_id=u.id WHERE u.id=? FOR UPDATE',
    [id],
  );
  if (!user) throw Error('user_missing');
  if (role === 'admin' && (!user.google_sub || user.google_sub !== user.actual_sub || !config.adminEmails.has(user.email.toLowerCase())))
    throw Error('existing_authorized_pin_required');
  await c.execute('UPDATE users SET role=? WHERE id=?', [role, id]);
  await writeAudit(c, null, 'role.cli', 'user', String(id), { role: user.role }, { role }, note);
  await c.commit();
  console.log(JSON.stringify({ userId: id, role }));
} catch (error) {
  await c.rollback();
  throw error;
} finally {
  c.release();
  await db.close();
}
