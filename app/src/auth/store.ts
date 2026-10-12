import { and, eq, gt, lt } from 'drizzle-orm';
import type { Pool } from 'mysql2/promise';
import { bootstrapAdmin, isAdmin } from '../admin/identity.ts';
import type { Db } from '../db/client.ts';
import { userSessions, users } from '../db/schema.ts';
import type { GoogleIdentity, LoginStore, SessionUser } from './google-login.ts';
import { hashToken } from './google-login.ts';

/** Drizzle-backed reader sessions.  The gateway passes the blog-only Db
 * instance; this store never points at the tag or YouTube databases. */
export function dbLoginStore(db: Db, options: { pool?: Pool; adminEmails?: Set<string> } = {}): LoginStore {
  return {
    async upsertUser(identity: GoogleIdentity, at: Date) {
      await db
        .insert(users)
        .values({
          googleSub: identity.sub,
          email: identity.email,
          name: identity.name,
          picture: identity.picture,
          createdAt: at,
          lastLoginAt: at,
        })
        .onDuplicateKeyUpdate({
          set: { email: identity.email, name: identity.name, picture: identity.picture, lastLoginAt: at },
        });
      const [row] = await db.select({ id: users.id }).from(users).where(eq(users.googleSub, identity.sub));
      if (!row) throw new Error('Google user was not persisted');
      if (options.pool) await bootstrapAdmin(options.pool, row.id, identity, options.adminEmails || new Set(), at);
      return row.id;
    },

    async createSession(tokenHash: string, userId: number, expiresAt: Date) {
      const at = new Date();
      // Sign-ins are rare, so cleanup is deterministic and does not need a
      // second queue or a shared Redis job.
      await db.delete(userSessions).where(lt(userSessions.expiresAt, at));
      await db.insert(userSessions).values({ tokenHash, userId, createdAt: at, expiresAt });
    },

    async sessionUser(tokenHash: string, at: Date): Promise<SessionUser | null> {
      const [row] = await db
        .select({
          id: users.id,
          role: users.role,
          sub: users.googleSub,
          email: users.email,
          name: users.name,
          picture: users.picture,
        })
        .from(userSessions)
        .innerJoin(users, eq(users.id, userSessions.userId))
        .where(and(eq(userSessions.tokenHash, tokenHash), gt(userSessions.expiresAt, at)));
      if (!row) return null;
      const role = options.pool && (await isAdmin(options.pool, row, options.adminEmails || new Set())) ? 'admin' : 'reader';
      return { ...row, role };
    },

    async deleteSession(tokenHash: string) {
      await db.delete(userSessions).where(eq(userSessions.tokenHash, tokenHash));
    },
  };
}

/** Useful for tests and migration checks without exposing session material. */
export function sessionHash(token: string, sessionSecret: string) {
  return hashToken(token, sessionSecret);
}
