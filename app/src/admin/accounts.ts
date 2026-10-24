import type { Pool, RowDataPacket } from 'mysql2/promise';

// What each signed-in account has done, for /admin/accounts/ (adapted from
// tag.observe.tw 1d711372 app/src/admin/user-activity.ts). A reader's own use
// (互動) is kept apart from what they gave the site (貢獻) and from admin edits,
// which admin_audits records by actor id; each admin action maps to one metric.

type Group = 'use' | 'contribute' | 'admin';
export type AccountMetric = { key: string; label: string; group: Group };

export const ACCOUNT_METRICS: AccountMetric[] = [
  { key: 'follows', label: '追蹤', group: 'use' },
  { key: 'apiKeys', label: 'API 金鑰', group: 'use' },
  { key: 'candidates', label: '審核候選', group: 'admin' },
  { key: 'profiles', label: '簡介與主題', group: 'admin' },
  { key: 'tags', label: '部落格標籤', group: 'admin' },
  { key: 'genres', label: '標籤裁定', group: 'admin' },
  { key: 'relations', label: '連結關係', group: 'admin' },
  { key: 'similarweb', label: 'Similarweb', group: 'admin' },
  { key: 'blogs', label: '部落格資料', group: 'admin' },
  { key: 'roles', label: '帳號權限', group: 'admin' },
  { key: 'other', label: '其他', group: 'admin' },
];

/** The metric an admin_audits action counts toward; null for rows that are not an edit of their own. */
export function auditMetric(action: string): string | null {
  // The sign-in that pins an admin, the outcome row paired with each reserved submission, and the
  // `<action>.intent` row intent.ts writes before every admin write (the write audits itself).
  if (action === 'role.bootstrap' || action === 'similarweb.submit.outcome' || action.endsWith('.intent')) return null;
  if (action.startsWith('candidate.')) return 'candidates';
  if (action === 'ai.override') return 'profiles';
  if (action === 'tags.manual') return 'tags';
  if (action.startsWith('genre.')) return 'genres';
  if (action === 'relations.visibility') return 'relations';
  if (action.startsWith('similarweb.')) return 'similarweb';
  if (action.startsWith('blog.')) return 'blogs';
  if (action.startsWith('role.')) return 'roles';
  return 'other';
}

export type Account = {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
  /** Effective admin: role, pinned Google identity and BLOG_ADMIN_EMAILS all agree (identity.ts isAdmin). */
  admin: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
  counts: Record<string, number>;
  lastActiveAt: string | null;
};

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

export async function adminAccounts(pool: Pool, adminEmails: Set<string>) {
  const [users] = await pool.query<RowDataPacket[]>(
    `SELECT u.id,u.email,u.name,u.picture,u.role,u.google_sub sub,u.created_at createdAt,u.last_login_at lastLoginAt,
       p.google_sub pinnedSub,p.email pinnedEmail
     FROM users u LEFT JOIN admin_google_identities p ON p.user_id=u.id`,
  );
  const out = new Map<number, Account>(
    users.map((u) => [
      Number(u.id),
      {
        id: Number(u.id),
        email: String(u.email),
        name: u.name ?? null,
        picture: u.picture ?? null,
        admin: u.role === 'admin' && Boolean(u.pinnedSub) && u.pinnedSub === u.sub && adminEmails.has(String(u.pinnedEmail).toLowerCase()),
        createdAt: iso(u.createdAt),
        lastLoginAt: iso(u.lastLoginAt),
        counts: {},
        lastActiveAt: null,
      },
    ]),
  );
  const add = (who: unknown, metric: string | null, n: unknown, last: unknown) => {
    const account = out.get(Number(who));
    if (!account || !metric) return;
    account.counts[metric] = (account.counts[metric] ?? 0) + Number(n);
    const at = iso(last);
    if (at && (!account.lastActiveAt || at > account.lastActiveAt)) account.lastActiveAt = at;
  };
  // Literal SQL at every call, so the SQL-writer audit (app/test/topic-writer-audit.spec.ts) sees plain reads.
  const byUser =
    (metric: string) =>
    ([rows]: [RowDataPacket[], unknown]) => {
      for (const row of rows) add(row.who, metric, row.n, row.last);
    };
  await Promise.all([
    pool
      .query<RowDataPacket[]>('SELECT user_id who,COUNT(*) n,MAX(created_at) last FROM user_follows GROUP BY user_id')
      .then(byUser('follows')),
    pool
      .query<RowDataPacket[]>('SELECT user_id who,COUNT(*) n,MAX(created_at) last FROM user_api_keys GROUP BY user_id')
      .then(byUser('apiKeys')),
    pool
      .query<RowDataPacket[]>(
        'SELECT actor_user_id who,action,COUNT(*) n,MAX(created_at) last FROM admin_audits WHERE actor_user_id IS NOT NULL GROUP BY actor_user_id,action',
      )
      .then(([rows]) => {
        for (const row of rows) add(row.who, auditMetric(String(row.action)), row.n, row.last);
      }),
  ]);
  // Tag votes are cast on traffic.observe.tw itself since gen106 (blog_genre_votes is frozen), so none are counted here.
  return { metrics: ACCOUNT_METRICS, accounts: [...out.values()] };
}
