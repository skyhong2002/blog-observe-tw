/** The status page's public JSON (status.skyhong.tw): every gateway host reports its CLIProxyAPI accounts with
 * their remaining quota, refreshed every five minutes. No key needed. Override with BLOG_QUOTA_STATUS_URL. */
const STATUS_URL = process.env.BLOG_QUOTA_STATUS_URL || 'https://status.skyhong.tw/api/status';
const CACHE_MS = 5 * 60_000;
/** A host report older than this is not current enough to spend quota on. */
const STALE_MS = 20 * 60_000;
export type CodexQuota = {
  /** Mean remaining percent over the usable Codex accounts sky-quality draws from. */
  remainingPercent: number;
  accounts: { label: string; remainingPercent: number }[];
  checkedAt: string;
};
type Options = { fetch?: typeof fetch; now?: () => number };
const object = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};

/** Codex accounts from fresh host reports, once each (hosts mirror the same logins); unusable ones are left out. */
export function codexQuotaOf(status: unknown, now = Date.now()): CodexQuota | null {
  const accounts = new Map<string, CodexQuota['accounts'][number]>();
  let checkedAt = 0;
  for (const raw of Array.isArray(object(object(status).gateway).hosts) ? (object(object(status).gateway).hosts as unknown[]) : []) {
    const host = object(raw);
    const report = object(host.accounts);
    const at = Date.parse(String(report.checkedAt));
    if (host.enabled === false || report.fresh !== true || !Number.isFinite(at) || now - at > STALE_MS) continue;
    checkedAt = Math.max(checkedAt, at);
    for (const entry of Array.isArray(report.list) ? report.list : []) {
      const account = object(entry);
      const left = Number(account.remainingPercent);
      if (account.provider !== 'codex' || typeof account.id !== 'string' || accounts.has(account.id)) continue;
      if (account.disabled === true || account.loginRejected === true || account.error || account.up === false || !Number.isFinite(left))
        continue;
      accounts.set(account.id, {
        label: String(account.label || account.account || account.id).slice(0, 80),
        remainingPercent: Math.max(0, Math.min(100, left)),
      });
    }
  }
  if (!accounts.size) return null;
  const list = [...accounts.values()];
  return {
    remainingPercent: Math.round(list.reduce((sum, a) => sum + a.remainingPercent, 0) / list.length),
    accounts: list,
    checkedAt: new Date(checkedAt).toISOString(),
  };
}

let cached: { at: number; value: CodexQuota | null } | null = null;
/** Any failure, stale report or missing account reads as unknown (null), which callers treat as no headroom. */
export async function readCodexQuota(options: Options = {}): Promise<CodexQuota | null> {
  const now = options.now?.() ?? Date.now();
  if (cached && now - cached.at < CACHE_MS && !options.fetch) return cached.value;
  let value: CodexQuota | null = null;
  try {
    const response = await (options.fetch || fetch)(STATUS_URL, {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { accept: 'application/json' },
    });
    if (response.ok && Number(response.headers.get('content-length') || 0) <= 4 * 1024 * 1024)
      value = codexQuotaOf(await response.json(), now);
    else await response.body?.cancel();
  } catch {
    value = null;
  }
  if (!options.fetch) cached = { at: now, value };
  return value;
}
/** Generated-scraper targets per 30-minute run for the remaining Codex quota (the user's thresholds, 2026-10-17):
 * ≥ 80 % four, ≥ 50 % two, ≥ 20 % one, below 20 % or unknown none. */
export function scraperTargetsFor(quota: CodexQuota | null) {
  const left = quota?.remainingPercent ?? -1;
  return left >= 80 ? 4 : left >= 50 ? 2 : left >= 20 ? 1 : 0;
}
