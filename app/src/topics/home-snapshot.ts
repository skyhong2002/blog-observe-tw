/** The topic rankings (homepage, /topics/, /topics/trending/), each at most once per refresh interval and shared by every request.
 * The user accepted (2026-10-21, extended to the ranking pages 2026-10-22) that rankings may lag a few minutes behind new or
 * hidden articles, in exchange for not running the 30-day aggregation on each visit while the host is busy.
 * - younger than refreshMs: served as is;
 * - older, but younger than maxAgeMs: served as is while one background read replaces it;
 * - missing or older than maxAgeMs: the request waits for a read (shared by concurrent requests).
 * refreshMs 0 turns the snapshot off: every request runs its own read, as before.
 * clear() drops the snapshot and orphans reads in flight, so the next request reads fresh.
 */
export const HOME_RANKING_REFRESH_MS = 5 * 60_000;

export class HomeRankingSnapshot<T> {
  private entries = new Map<string, { at: number; value: T }>();
  private flights = new Map<string, Promise<T>>();
  private generation = 0;
  readonly refreshMs: number;
  readonly maxAgeMs: number;
  private now: () => number;
  constructor(refreshMs = HOME_RANKING_REFRESH_MS, maxAgeMs = refreshMs * 6, now = Date.now) {
    this.refreshMs = refreshMs;
    this.maxAgeMs = maxAgeMs;
    this.now = now;
  }
  async get(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.refreshMs) return load();
    const entry = this.entries.get(key);
    const age = entry ? this.now() - entry.at : Number.POSITIVE_INFINITY;
    if (entry && age < this.refreshMs) return entry.value;
    if (entry && age < this.maxAgeMs) {
      // A failed background read keeps the current snapshot; the next request tries again.
      this.refresh(key, load).catch(() => {});
      return entry.value;
    }
    return this.refresh(key, load);
  }
  private refresh(key: string, load: () => Promise<T>) {
    const pending = this.flights.get(key);
    if (pending) return pending;
    const generation = this.generation;
    const at = this.now();
    const read = load()
      .then((value) => {
        if (generation === this.generation) this.entries.set(key, { at, value });
        return value;
      })
      .finally(() => {
        if (this.flights.get(key) === read) this.flights.delete(key);
      });
    this.flights.set(key, read);
    return read;
  }
  clear() {
    this.generation++;
    this.entries.clear();
    this.flights.clear();
  }
}
