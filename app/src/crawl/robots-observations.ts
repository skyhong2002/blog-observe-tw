import type { Pool, RowDataPacket } from 'mysql2/promise';
import { onRobotsObservation, type RobotsObservation } from './feed.ts';

export type RobotsStatus = Omit<RobotsObservation, 'host' | 'checkedAt'> & { checkedAt: string; readableAt: string | null };
/** An unreadable robots.txt is not cached by the crawler, so the same answer can repeat on every request. */
const REPEAT_MS = 10 * 60_000;

/** Keeps the latest robots.txt read per host. Writes are fire-and-forget and never slow or fail a crawl. */
export function recordRobotsObservations(pool: Pool) {
  const written = new Map<string, { key: string; at: number }>();
  onRobotsObservation((o) => {
    const key = `${o.outcome}:${o.httpStatus}:${o.error}:${o.disallow.join('\n')}`;
    const last = written.get(o.host);
    if (last?.key === key && o.checkedAt.getTime() - last.at < REPEAT_MS) return;
    written.set(o.host, { key, at: o.checkedAt.getTime() });
    if (written.size > 5000) written.delete(written.keys().next().value!);
    pool
      .execute(
        `INSERT INTO robots_observations (host,outcome,http_status,error,disallow,checked_at,readable_at) VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE outcome=VALUES(outcome),http_status=VALUES(http_status),error=VALUES(error),
           disallow=VALUES(disallow),checked_at=VALUES(checked_at),readable_at=COALESCE(VALUES(readable_at),readable_at)`,
        [
          o.host.slice(0, 255),
          o.outcome,
          o.httpStatus,
          o.error,
          JSON.stringify(o.disallow.slice(0, 50).map((rule) => rule.slice(0, 200))),
          o.checkedAt,
          o.outcome === 'unreachable' ? null : o.checkedAt,
        ],
      )
      .catch(() => {});
  });
}

export function robotsHost(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).host.toLowerCase() : null;
  } catch {
    return null;
  }
}
const wwwToggled = (host: string) => (host.startsWith('www.') ? host.slice(4) : `www.${host}`);
/** A blog's home may redirect between `www.` and the bare host; the crawler reads robots.txt where it lands. */
export function robotsFor(statuses: Map<string, RobotsStatus>, url: string | null | undefined): RobotsStatus | null {
  const host = robotsHost(url);
  if (!host) return null;
  const [a, b] = [statuses.get(host), statuses.get(wwwToggled(host))];
  return a && b ? (a.checkedAt >= b.checkedAt ? a : b) : (a ?? b ?? null);
}
const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

/** Latest robots status for each URL's host; URLs whose host was never read are left out. */
export async function robotsStatuses(pool: Pool, urls: (string | null | undefined)[]): Promise<Map<string, RobotsStatus>> {
  const hosts = [...new Set(urls.map(robotsHost).flatMap((host) => (host ? [host, wwwToggled(host)] : [])))];
  const out = new Map<string, RobotsStatus>();
  if (!hosts.length) return out;
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT host,outcome,http_status,error,disallow,checked_at,readable_at FROM robots_observations WHERE host IN (?)',
    [hosts],
  );
  for (const row of rows) {
    let disallow: unknown = row.disallow;
    if (typeof disallow === 'string') {
      try {
        disallow = JSON.parse(disallow);
      } catch {
        disallow = [];
      }
    }
    out.set(row.host, {
      outcome: row.outcome,
      httpStatus: row.http_status === null ? null : Number(row.http_status),
      error: row.error,
      disallow: Array.isArray(disallow) ? disallow.map(String) : [],
      checkedAt: iso(row.checked_at)!,
      readableAt: iso(row.readable_at),
    });
  }
  return out;
}
