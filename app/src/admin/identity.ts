import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { GoogleIdentity, SessionUser } from '../auth/google-login.ts';
export type AdminActor = { id: number; sub: string };
export async function bootstrapAdmin(pool: Pool, userId: number, identity: GoogleIdentity, emails: Set<string>, at: Date) {
  if (identity.emailVerified !== true || !emails.has(identity.email.toLowerCase())) return;
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[user]] = await c.query<RowDataPacket[]>('SELECT google_sub,role FROM users WHERE id=? FOR UPDATE', [userId]);
    if (!user || user.google_sub !== identity.sub) throw Error('identity mismatch');
    // Pins are permanent. A revoked role is never promoted again by a later login.
    const [insert] = await c.execute<ResultSetHeader>(
      'INSERT IGNORE INTO admin_google_identities(email,google_sub,user_id,created_at) VALUES (?,?,?,?)',
      [identity.email.toLowerCase(), identity.sub, userId, at],
    );
    if (insert.affectedRows === 1) {
      await c.execute("UPDATE users SET role='admin' WHERE id=?", [userId]);
      await writeAudit(
        c,
        userId,
        'role.bootstrap',
        'user',
        String(userId),
        { role: user.role },
        { role: 'admin' },
        'Verified Google identity bootstrap',
      );
    }
    await c.commit();
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
export async function isAdmin(c: Pool | PoolConnection, user: Pick<SessionUser, 'id' | 'sub'> | null, emails: Set<string>, lock = false) {
  if (!user?.sub || !Number.isSafeInteger(user.id)) return false;
  const [[row]] = await c.query<RowDataPacket[]>(
    `SELECT u.role,u.google_sub,p.google_sub pinned_sub,p.email pinned_email FROM users u JOIN admin_google_identities p ON p.user_id=u.id WHERE u.id=?${lock ? ' FOR UPDATE' : ''}`,
    [user.id],
  );
  return Boolean(
    row &&
      row.role === 'admin' &&
      row.google_sub === user.sub &&
      row.pinned_sub === user.sub &&
      emails.has(String(row.pinned_email).toLowerCase()),
  );
}
export async function requireAdminTransaction(c: PoolConnection, user: AdminActor, emails: Set<string>) {
  if (!(await isAdmin(c, user, emails, true))) throw Object.assign(Error('admin_access_revoked'), { statusCode: 403 });
}
export async function writeAudit(
  c: PoolConnection,
  actor: number | null,
  action: string,
  type: string,
  id: string,
  before: unknown,
  after: unknown,
  note: string | null = null,
) {
  await c.execute(
    'INSERT INTO admin_audits(actor_user_id,action,entity_type,entity_id,before_json,after_json,note,created_at) VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP())',
    [actor, action, type, id, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), note],
  );
}
