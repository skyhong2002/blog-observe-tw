/** A public read computed at most once per refresh interval and shared by every request: the topic rankings
 * (homepage, /topics/, /topics/trending/), the relation map and the first page of /mentions/.
 * The user accepted (2026-10-21 for the homepage, 2026-10-22 for every often-visited page) that these may lag a few
 * minutes behind new or hidden articles, in exchange for not running the heavy aggregations on each visit while the
 * host is busy. The public v1 API stays fresh per request (v1/openapi.ts).
 * - younger than refreshMs: served as is;
 * - older, but younger than maxAgeMs: served as is while one background read replaces it;
 * - missing or older than maxAgeMs: the request waits for a read (shared by concurrent requests).
 * refreshMs 0 turns the snapshot off: every request runs its own read, as before.
 * clear() drops the snapshot and orphans reads in flight, so the next request reads fresh.
 */
export const SNAPSHOT_REFRESH_MS = 5 * 60_000;

export class SharedSnapshot<T> {
  private entries = new Map<string, { at: number; value: T }>();
  private flights = new Map<string, Promise<T>>();
  private generation = 0;
  readonly refreshMs: number;
  readonly maxAgeMs: number;
  private now: () => number;
  constructor(refreshMs = SNAPSHOT_REFRESH_MS, maxAgeMs = refreshMs * 6, now = Date.now) {
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
