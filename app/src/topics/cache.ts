/** Bounded result and in-flight maps. Cold callers for the same key share one SQL computation. */
export class TopicResponseCache {
  private readonly values = new Map<string, { value: unknown; expires: number }>();
  private readonly pending = new Map<string, Promise<unknown>>();
  readonly ttlMs: number;
  private readonly capacity: number;
  private readonly now: () => number;
  constructor(ttlMs = 120000, capacity = 256, now = Date.now) {
    this.ttlMs = Math.max(60000, Math.min(300000, ttlMs));
    this.capacity = Math.max(1, Math.min(256, capacity));
    this.now = now;
  }
  async get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.values.get(key);
    if (hit && hit.expires > this.now()) return hit.value as T;
    const inflight = this.pending.get(key);
    if (inflight) return inflight as Promise<T>;
    if (this.pending.size >= Math.min(8, this.capacity)) throw Object.assign(Error('topic_cache_busy'), { statusCode: 503 });
    const promise = Promise.resolve()
      .then(load)
      .then((value) => {
        this.values.delete(key);
        this.values.set(key, { value, expires: this.now() + this.ttlMs });
        while (this.values.size > this.capacity) this.values.delete(this.values.keys().next().value!);
        return value;
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, promise);
    return promise;
  }
  clear() {
    this.values.clear();
  }
}
