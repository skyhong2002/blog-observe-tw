/** Bounded single-flight only: completed public results are never retained across
 * requests. Visibility changes must not wait behind stacked API/SEO cache TTLs. */
export class TopicResponseCache {
  private readonly pending = new Map<string, Promise<unknown>>();
  readonly ttlMs = 0;
  private readonly capacity: number;
  constructor(_ttlMs = 0, capacity = 256, _now = Date.now) {
    this.capacity = Math.max(1, Math.min(256, capacity));
  }
  async get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const inflight = this.pending.get(key);
    if (inflight) return inflight as Promise<T>;
    if (this.pending.size >= Math.min(8, this.capacity)) throw Object.assign(Error('topic_cache_busy'), { statusCode: 503 });
    const promise = Promise.resolve()
      .then(load)
      .finally(() => {
        if (this.pending.get(key) === promise) this.pending.delete(key);
      });
    this.pending.set(key, promise);
    return promise;
  }
  clear() {
    this.pending.clear();
  }
}
