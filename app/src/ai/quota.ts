import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** CLIProxyAPI's management API (behind the gateway, on sky-mini). Override with BLOG_CPA_MANAGEMENT_URL. */
const MANAGEMENT_URL = process.env.BLOG_CPA_MANAGEMENT_URL || 'http://100.71.224.62:8318/v0/management';
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const CACHE_MS = 5 * 60_000;
export type CodexQuota = {
  /** Mean over usable Codex accounts of 100 minus the tighter of the 5-hour and weekly windows. */
  remainingPercent: number;
  accounts: { label: string; remainingPercent: number }[];
  checkedAt: string;
};
type Options = { fetch?: typeof fetch; key?: string; now?: () => number };

export async function readManagementKey(env = process.env, read = (path: string) => readFile(path, 'utf8')) {
  const key = (
    env.CLI_PROXY_MANAGEMENT_KEY?.trim() || (await read(join(homedir(), '.config/ai-gateway/cpa-management.key')).catch(() => ''))
  ).trim();
  if (!key || /[\r\n]/.test(key)) throw Error('management_key_unavailable');
  return key;
}
const object = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
const percent = (window: unknown) => {
  const used = Number(object(window).used_percent);
  return Number.isFinite(used) ? Math.max(0, Math.min(100, used)) : null;
};
/** wham/usage: rate_limit.primary_window (5 h) and secondary_window (week); a reached limit leaves nothing. */
export function remainingOf(usage: unknown): number | null {
  const limit = object(object(usage).rate_limit);
  const used = [percent(limit.primary_window), percent(limit.secondary_window)].filter((u): u is number => u !== null);
  if (limit.limit_reached === true || limit.allowed === false) return 0;
  return used.length ? 100 - Math.max(...used) : null;
}
/** The workspace an account's quota belongs to; without it wham/usage answers an unscoped, larger figure. */
function accountId(file: Record<string, unknown>) {
  for (const value of [file.account_id, file.chatgpt_account_id, object(file.metadata).account_id, object(file.account).id, file.account])
    if (typeof value === 'string' && /^[\w-]{6,80}$/.test(value)) return value;
  return null;
}

let cached: { at: number; value: CodexQuota | null } | null = null;
/** Each Codex account's own usage, fetched by the proxy with that account's token ($TOKEN$); the token never
 * reaches this process. Any failure reads as unknown (null), which callers treat as no headroom. */
export async function readCodexQuota(options: Options = {}): Promise<CodexQuota | null> {
  const now = options.now?.() ?? Date.now();
  if (cached && now - cached.at < CACHE_MS && !options.fetch) return cached.value;
  let value: CodexQuota | null = null;
  try {
    const key = options.key || (await readManagementKey());
    const call = async (path: string, init: RequestInit = {}) => {
      const response = await (options.fetch || fetch)(`${MANAGEMENT_URL}${path}`, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw Error(`management_http_${response.status}`);
      return response.json() as Promise<unknown>;
    };
    const files = (object(await call('/auth-files')).files as unknown[]) ?? [];
    const accounts: CodexQuota['accounts'] = [];
    for (const raw of Array.isArray(files) ? files : []) {
      const file = object(raw);
      if (file.provider !== 'codex' || file.disabled === true || file.unavailable === true || typeof file.auth_index !== 'string') continue;
      const id = accountId(file);
      const reply = object(
        await call('/api-call', {
          method: 'POST',
          body: JSON.stringify({
            auth_index: file.auth_index,
            method: 'GET',
            url: USAGE_URL,
            header: { Authorization: 'Bearer $TOKEN$', ...(id ? { 'ChatGPT-Account-Id': id } : {}), Accept: 'application/json' },
          }),
        }),
      );
      let remaining: number | null = null;
      if (Number(reply.status_code) === 200 && typeof reply.body === 'string')
        try {
          remaining = remainingOf(JSON.parse(reply.body));
        } catch {
          remaining = null;
        }
      if (remaining !== null)
        accounts.push({
          label: String(file.label || file.email || file.name || file.auth_index).slice(0, 80),
          remainingPercent: remaining,
        });
    }
    if (accounts.length)
      value = {
        remainingPercent: Math.round(accounts.reduce((sum, a) => sum + a.remainingPercent, 0) / accounts.length),
        accounts,
        checkedAt: new Date(now).toISOString(),
      };
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
