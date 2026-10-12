/** Compatibility wrapper for bounded fresh reads, not a response cache.
 * Each request runs its own loader, even while the same key is in flight:
 * a request starting after a visibility commit must not inherit an older read.
 */
export class TopicResponseCache {
  private active = 0;
  readonly ttlMs = 0;
  // These arguments used to configure cache retention/key count. Keep callers
  // compatible, but use eight real concurrent reads even for overview's old 1-key cache.
  // biome-ignore lint/complexity/noUselessConstructor: retain the existing typed constructor call contract
  constructor(_ttlMs = 0, _capacity = 256, _now = Date.now) {}
  async get<T>(_key: string, load: () => Promise<T>): Promise<T> {
    if (this.active >= 8) throw Object.assign(Error('topic_cache_busy'), { statusCode: 503 });
    this.active++;
    try {
      return await load();
    } finally {
      this.active--;
    }
  }
  clear() {
    // No stored results. Never reset active reads: that would bypass the limit.
  }
}
