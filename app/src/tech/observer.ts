import type { Pool } from 'mysql2/promise';
import type { PassiveFetchObservation, PassiveFetchObserver } from '../crawl/feed.ts';
import type { RecordTechObservationInput, RecordTechObservationResult } from './contracts.ts';
import { detectTechnology } from './detector.ts';
import { recordTechObservation, sameTechPublication } from './store.ts';

type Writer = (pool: Pool, input: RecordTechObservationInput) => Promise<RecordTechObservationResult>;
/** Process-wide admission: one in-flight DB write plus at most 31 pending bounded DTOs. No HTML is retained. */
export class TechObservationQueue {
  private readonly waiting: { pool: Pool; input: RecordTechObservationInput }[] = [];
  private running = false;
  private readonly writer: Writer;
  private readonly idleWaiters: (() => void)[] = [];
  private accepted = 0;
  private dropped = 0;
  private failures = 0;
  constructor(writer: Writer = recordTechObservation) {
    this.writer = writer;
  }
  hasCapacity() {
    return this.waiting.length + Number(this.running) < 32;
  }
  /** Count a rejected event before parsing/allocating its optional observation. */
  recordDrop() {
    this.dropped++;
  }
  enqueue(pool: Pool, input: RecordTechObservationInput): boolean {
    if (!this.hasCapacity()) {
      this.recordDrop();
      return false;
    }
    this.waiting.push({ pool, input });
    this.accepted++;
    void this.run();
    return true;
  }
  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.waiting.length) {
        const next = this.waiting.shift()!;
        try {
          if (!(await this.writer(next.pool, next.input)).written) this.failures++;
        } catch {
          this.failures++;
        }
      }
    } finally {
      this.running = false;
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }
  /** Worker/test shutdown hook. Optional; normal crawls never wait for observations. */
  idle(): Promise<void> {
    if (!this.running && !this.waiting.length) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }
  stats() {
    return {
      active: Number(this.running),
      pending: this.waiting.length,
      accepted: this.accepted,
      dropped: this.dropped,
      failures: this.failures,
    };
  }
}
export const techObservationQueue = new TechObservationQueue();
export type TechObserverContext = { blogId: number; blogUrl: string; sourcePostId?: number | null };

/** Return undefined while disabled so politeFetch does not even allocate an HTML prefix. */
export function createTechObserver(
  pool: Pool,
  context: TechObserverContext,
  options: { enabled?: boolean; queue?: TechObservationQueue } = {},
): PassiveFetchObserver | undefined {
  if (!(options.enabled ?? process.env.BLOG_TECH_ENABLED === 'true')) return undefined;
  if (!Number.isSafeInteger(context.blogId) || context.blogId < 1) return undefined;
  if (
    context.sourcePostId !== undefined &&
    context.sourcePostId !== null &&
    (!Number.isSafeInteger(context.sourcePostId) || context.sourcePostId < 1)
  )
    return undefined;
  const queue = options.queue ?? techObservationQueue;
  return (event: PassiveFetchObservation) => {
    try {
      if (event.url.length > 4096 || event.requestedUrl.length > 4096) return;
      // Redirect/robots errors belong to their actual target, never to the original publication automatically.
      if (!sameTechPublication(event.url, context.blogUrl) || !sameTechPublication(event.requestedUrl, context.blogUrl)) return;
      if (!context.sourcePostId && new URL(event.url).pathname.replace(/\/$/, '') !== new URL(context.blogUrl).pathname.replace(/\/$/, ''))
        return;
      if (event.status === 304) return;
      if (!queue.hasCapacity()) {
        queue.recordDrop();
        return;
      }
      const observation = detectTechnology({
        url: event.url,
        html: event.html,
        headers: event.headers,
        httpStatus: event.status,
        sourceType: event.html === undefined ? 'header' : 'html',
        observedAt: event.observedAt,
        ...(event.error === 'robots' ? { blockedReason: 'robots' as const } : event.error ? { failureReason: event.error } : {}),
      });
      observation.coverage.htmlTruncated ||= event.htmlTruncated;
      // Only sanitized fixed-vocabulary observation remains; event/HTML/headers are not closed over by queued work.
      queue.enqueue(pool, { blogId: context.blogId, sourcePostId: context.sourcePostId, sourceUrl: event.url, observation });
    } catch {
      /* Pure parser/admission failures are optional metadata, never crawler failures. */
    }
  };
}
