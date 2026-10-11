import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type SimilarWebOptions = {
  enabled?: boolean;
  lockPath?: string;
  budgetPath?: string;
  maxPerDay?: number;
  endpoint?: string;
  fetcher?: typeof fetch;
};
export type SimilarWebResult = {
  enabled: boolean;
  domain: string;
  candidates: string[];
  status: 'ok' | 'disabled' | 'budget' | 'blocked' | 'error';
  httpStatus?: number;
};

const DEFAULT_LOCK = '/home/deck/.local/share/observe-similarweb-rate-limit.lock';
const DEFAULT_BUDGET = '/home/deck/.local/share/observe-similarweb-rate-budget.json';
const DEFAULT_ENDPOINT = 'https://data.similarweb.com/api/v1/similar-sites?domain={domain}';
const LOCK_TTL_MS = 15 * 60_000;
const BLOCK_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

type Budget = { date: string; count: number; blockedUntil?: number };

function dateKey(at = new Date()) {
  return at.toISOString().slice(0, 10);
}

async function readBudget(path: string): Promise<Budget> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<Budget>;
    const count = parsed.count;
    if (parsed.date === dateKey() && typeof count === 'number' && Number.isInteger(count) && count >= 0)
      return { date: parsed.date, count, blockedUntil: parsed.blockedUntil };
  } catch {
    // A missing/corrupt local budget starts conservatively at zero.
  }
  return { date: dateKey(), count: 0 };
}

async function saveBudget(path: string, budget: Budget) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(budget)}\n`, { mode: 0o600 });
}

async function acquireLock(path: string): Promise<(() => Promise<void>) | null> {
  await mkdir(dirname(path), { recursive: true });
  try {
    await mkdir(path);
    await writeFile(`${path}/owner`, `${process.pid} ${Date.now()}\n`, { mode: 0o600 });
    return async () => rm(path, { recursive: true, force: true });
  } catch {
    try {
      const info = await stat(path);
      if (Date.now() - info.mtimeMs > LOCK_TTL_MS) {
        await rm(path, { recursive: true, force: true });
        return acquireLock(path);
      }
    } catch {
      // A race with another process means the lock remains held.
    }
    return null;
  }
}

function candidatesFromPayload(payload: unknown): string[] {
  const values: unknown[] = [];
  const walk = (value: unknown, depth: number) => {
    if (depth > 4 || value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        walk(item, depth + 1);
      });
      return;
    }
    if (typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    for (const key of ['domain', 'site', 'url', 'domain_name', 'domainName']) {
      const item = object[key];
      if (typeof item === 'string') values.push(item);
    }
    for (const key of ['similar_sites', 'similarSites', 'results', 'sites', 'data']) walk(object[key], depth + 1);
  };
  walk(payload, 0);
  const result = new Set<string>();
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const value = raw;
    try {
      const url = /^https?:\/\//i.test(value) ? new URL(value) : new URL(`https://${value}`);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      if (host.includes('.') && !host.includes('similarweb')) result.add(host);
    } catch {
      // Ignore malformed entries supplied by the upstream endpoint.
    }
  }
  return [...result];
}

/**
 * Similarweb is opt-in and globally budgeted.  The lock/budget paths are
 * intentionally host-level so a blog worker cannot consume tag's burst quota
 * concurrently.  The default returns disabled without making a request.
 */
export async function discoverSimilarSites(domain: string, options: SimilarWebOptions = {}): Promise<SimilarWebResult> {
  const cleanDomain = domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  const enabled = options.enabled ?? (process.env.BLOG_SIMILARWEB_ENABLED === '1' || process.env.BLOG_SIMILARWEB_ENABLED === 'true');
  const result = (status: SimilarWebResult['status'], extras: Partial<SimilarWebResult> = {}): SimilarWebResult => ({
    enabled,
    domain: cleanDomain,
    candidates: [],
    status,
    ...extras,
  });
  if (!enabled) return result('disabled');
  if (!cleanDomain.includes('.')) return result('error');

  const lockPath = options.lockPath || process.env.BLOG_SIMILARWEB_LOCK_PATH || DEFAULT_LOCK;
  const budgetPath = options.budgetPath || process.env.BLOG_SIMILARWEB_BUDGET_PATH || DEFAULT_BUDGET;
  const release = await acquireLock(lockPath);
  if (!release) return result('budget');
  try {
    const budget = await readBudget(budgetPath);
    if (budget.blockedUntil && budget.blockedUntil > Date.now()) return result('blocked');
    const maxPerDay = Math.max(1, Math.min(20, options.maxPerDay ?? Number(process.env.BLOG_SIMILARWEB_MAX_PER_DAY || 10)));
    if ((budget.count ?? 0) >= maxPerDay) return result('budget');
    if (Date.now() - new Date(`${budget.date}T00:00:00Z`).getTime() > DAY_MS) {
      budget.date = dateKey();
      budget.count = 0;
    }
    const endpoint = (options.endpoint || process.env.BLOG_SIMILARWEB_ENDPOINT || DEFAULT_ENDPOINT).replace(
      '{domain}',
      encodeURIComponent(cleanDomain),
    );
    const response = await (options.fetcher || fetch)(endpoint, {
      headers: {
        // Similarweb's browser extension sends a browser-shaped request. Keep
        // this low-frequency and never share cookies with either sibling app.
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
        accept: 'application/json, text/plain, */*',
        referer: 'https://www.similarweb.com/',
        origin: 'https://www.similarweb.com',
      },
      signal: AbortSignal.timeout(15_000),
    });
    budget.count += 1;
    if ([401, 403, 429].includes(response.status)) {
      budget.blockedUntil = Date.now() + BLOCK_MS;
      await saveBudget(budgetPath, budget);
      return result('blocked', { httpStatus: response.status });
    }
    if (!response.ok) {
      await saveBudget(budgetPath, budget);
      return result('error', { httpStatus: response.status });
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      await saveBudget(budgetPath, budget);
      return result('error', { httpStatus: response.status });
    }
    await saveBudget(budgetPath, budget);
    return { ...result('ok', { httpStatus: response.status }), candidates: candidatesFromPayload(payload) };
  } finally {
    await release();
  }
}
