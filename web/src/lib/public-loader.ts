/**
 * Browser reads of public gateway paths for the query part of a public page,
 * as plain logic (fetch and timers injectable) so node --test can drive it;
 * use-public-json.ts binds it to React.
 *
 * - Same-origin, `credentials: 'omit'`, only public-paths.ts paths; a 200 must
 *   pass public-contracts.ts and the caller's parser, else it is an error.
 * - Nothing is remembered: every read is fetched with `cache: 'no-store'` and
 *   no answer is kept once it settled, for any kind. Any public answer can
 *   carry an article the gateway may hide later, so showing a query again
 *   (back to an earlier filter, another view, a tab made visible again) asks
 *   the gateway again instead of reusing what this page read before.
 * - Each read has its own timeout, separate from the caller's abort: a timeout
 *   is an error the page shows; an abort (the query changed or the view went
 *   away) settles nothing.
 * - A runner keeps only the latest query: an older read that finishes late,
 *   or is parsed late, never overwrites a newer one.
 */
import { validPublicPayload } from './public-contracts.ts';
import { publicKindOf } from './public-paths.ts';

/** gone: the gateway's 410 (a topic whose evidence was all revoked), apart from an unknown path's missing. */
export type PublicLoad<T> =
  | { status: 'pending' }
  | { status: 'ready'; data: T }
  | { status: 'missing' }
  | { status: 'gone' }
  | { status: 'error' };
/** Turns a contract-checked payload into what the view renders; null is an error. */
export type PublicParser<T> = (raw: unknown, path: string) => T | null;

export const CLIENT_TIMEOUT_MS = 10_000;

type Timer = unknown;
export type LoaderOptions = {
  fetch?: (path: string, init: RequestInit) => Promise<Response>;
  setTimer?: (run: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  timeoutMs?: number;
};

const ERROR = { status: 'error' } as const;
const MISSING = { status: 'missing' } as const;
const GONE = { status: 'gone' } as const;

export function createPublicLoader(options: LoaderOptions = {}) {
  const {
    fetch: fetcher = (path, init) => fetch(path, init),
    setTimer = (run, ms) => setTimeout(run, ms),
    clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    timeoutMs = CLIENT_TIMEOUT_MS,
  } = options;

  /** Resolves to null when `signal` aborted it; never rejects. */
  async function load<T>(path: string, parse: PublicParser<T>, signal: AbortSignal): Promise<PublicLoad<T> | null> {
    const kind = publicKindOf(path);
    if (!kind) return ERROR;
    const request = new AbortController();
    const stop = () => request.abort();
    signal.addEventListener('abort', stop);
    const timer = setTimer(stop, timeoutMs);
    try {
      const init: RequestInit = {
        credentials: 'omit',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: request.signal,
      };
      const response = await fetcher(path, init);
      if (signal.aborted) return null;
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return response.status === 404 ? MISSING : response.status === 410 ? GONE : ERROR;
      }
      const raw: unknown = await response.json();
      if (signal.aborted) return null;
      if (!validPublicPayload(kind, raw)) return ERROR;
      const data = parse(raw, path);
      if (data === null) return ERROR;
      if (signal.aborted) return null;
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
      const controller = new AbortController();
      current = controller;
      void load(path, parse, controller.signal).then((result) => {
        if (result && mine === generation && !controller.signal.aborted) settle(path, result);
      });
    };
    return { run, stop };
  }

  return { load, runner };
}

export type PublicLoader = ReturnType<typeof createPublicLoader>;
