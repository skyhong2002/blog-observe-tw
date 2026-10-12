/**
 * Browser reads of public gateway paths for the query part of a public page,
 * as plain logic (clock, fetch and timers injectable) so node --test can drive
 * it; use-public-json.ts binds it to React.
 *
 * - Same-origin, `credentials: 'omit'`, only public-paths.ts paths; a 200 must
 *   pass public-contracts.ts and the caller's parser, else it is an error.
 * - Answers are remembered for PUBLIC_REVALIDATE_SECONDS (the pages' own ISR
 *   period), at most CLIENT_CACHE_MAX paths, least recently used first out.
 *   An expired answer is read again the next time its query is shown.
 * - Each read has its own timeout, separate from the caller's abort: a timeout
 *   is an error the page shows; an abort (the query changed or the view went
 *   away) settles nothing and remembers nothing.
 * - A runner keeps only the latest query: an older read that finishes late,
 *   or is parsed late, never overwrites a newer one.
 */
import { validPublicPayload } from './public-contracts.ts';
import { PUBLIC_REVALIDATE_SECONDS, publicKindOf } from './public-paths.ts';

export type PublicLoad<T> = { status: 'pending' } | { status: 'ready'; data: T } | { status: 'missing' } | { status: 'error' };
/** Turns a contract-checked payload into what the view renders; null is an error. */
export type PublicParser<T> = (raw: unknown, path: string) => T | null;

export const CLIENT_CACHE_TTL_MS = PUBLIC_REVALIDATE_SECONDS * 1000;
export const CLIENT_CACHE_MAX = 24;
export const CLIENT_TIMEOUT_MS = 10_000;

type Timer = unknown;
export type LoaderOptions = {
  fetch?: (path: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  ttlMs?: number;
  max?: number;
  timeoutMs?: number;
};

const ERROR = { status: 'error' } as const;
const MISSING = { status: 'missing' } as const;

export function createPublicLoader(options: LoaderOptions = {}) {
  const {
    fetch: fetcher = (path, init) => fetch(path, init),
    now = Date.now,
    setTimer = (run, ms) => setTimeout(run, ms),
    clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    ttlMs = CLIENT_CACHE_TTL_MS,
    max = CLIENT_CACHE_MAX,
    timeoutMs = CLIENT_TIMEOUT_MS,
  } = options;
  const entries = new Map<string, { data: unknown; at: number }>();

  /** A remembered answer still inside its TTL (expired ones are dropped). */
  function fresh<T>(path: string): { data: T } | undefined {
    const entry = entries.get(path);
    if (!entry) return undefined;
    if (now() - entry.at >= ttlMs) {
      entries.delete(path);
      return undefined;
    }
    return { data: entry.data as T };
  }

  function remember(path: string, data: unknown) {
    entries.delete(path);
    entries.set(path, { data, at: now() });
    while (entries.size > max) entries.delete(entries.keys().next().value as string);
  }

  /** Resolves to null when `signal` aborted it; never rejects. */
  async function load<T>(path: string, parse: PublicParser<T>, signal: AbortSignal): Promise<PublicLoad<T> | null> {
    const kind = publicKindOf(path);
    if (!kind) return ERROR;
    const request = new AbortController();
    const stop = () => request.abort();
    signal.addEventListener('abort', stop);
    const timer = setTimer(stop, timeoutMs);
    try {
      const response = await fetcher(path, { credentials: 'omit', headers: { accept: 'application/json' }, signal: request.signal });
      if (signal.aborted) return null;
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return response.status === 404 ? MISSING : ERROR;
      }
      const raw: unknown = await response.json();
      if (signal.aborted) return null;
      if (!validPublicPayload(kind, raw)) return ERROR;
      const data = parse(raw, path);
      if (data === null) return ERROR;
      if (signal.aborted) return null;
      remember(path, data);
      return { status: 'ready', data };
    } catch {
      // The timeout aborts `request` only; the caller's abort is `signal`.
      return signal.aborted ? null : ERROR;
    } finally {
      clearTimer(timer);
      signal.removeEventListener('abort', stop);
    }
  }

  /**
   * One query at a time for one view: `run` aborts the previous read and only
   * the latest run may call `settle`. `stop` abandons the current one.
   */
  function runner<T>(settle: (path: string, load: PublicLoad<T>) => void) {
    let generation = 0;
    let current: AbortController | null = null;
    const stop = () => {
      generation++;
      current?.abort();
      current = null;
    };
    const run = (path: string, parse: PublicParser<T>) => {
      stop();
      const mine = generation;
      const cached = fresh<T>(path);
      if (cached) {
        settle(path, { status: 'ready', data: cached.data });
        return;
      }
      const controller = new AbortController();
      current = controller;
      void load(path, parse, controller.signal).then((result) => {
        if (result && mine === generation && !controller.signal.aborted) settle(path, result);
      });
    };
    return { run, stop };
  }

  return { fresh, load, runner, size: () => entries.size };
}

export type PublicLoader = ReturnType<typeof createPublicLoader>;
