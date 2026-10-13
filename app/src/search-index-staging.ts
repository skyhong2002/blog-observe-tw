import { type AdoptionEnqueue, createSearchIndexAdoption } from './search-index-adoption.ts';

type BodyStage = {
  postId: number;
  blogId: number;
  postOwnerBlogId: number;
  bodyOwnerBlogId: number;
  publicationStatus: 'verified';
  status: 'ok';
  changed: true;
};
export type IndexAdoptionReport = {
  channel: 'feed' | 'history' | 'relations';
  state: 'disabled' | 'queued' | 'needs-repair';
  partial: boolean;
  acknowledgedPostIds: number[];
  pendingPostIds: number[];
  overflowEvents: number;
  overflowed: boolean;
  scopeRepair: number[];
  reason: 'none' | 'overflow' | 'queue-unknown' | 'unproven-transaction';
  indexed: false;
  reporting: 'not-configured' | 'attempted' | 'failed';
};
export type BodyIndexOptions = {
  indexAdoptionEnabled?: boolean;
  enqueueIndex?: AdoptionEnqueue;
  onIndexAdoptionReport?: (report: IndexAdoptionReport) => void | Promise<void>;
};
const id = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
/** Transaction-local staged IDs are never committed events. No raw evidence survives this boundary. */
export function createBodyIndexStages(options: BodyIndexOptions, channel: IndexAdoptionReport['channel']) {
  const enabled = options.indexAdoptionEnabled === true;
  const adoption = createSearchIndexAdoption({ enabled, enqueue: options.enqueueIndex });
  let overflowEvents = 0,
    unproven = false;
  const scopes = new Set<number>();
  function transaction() {
    const pending = new Map<number, BodyStage>();
    let overflow = 0,
      closed = false;
    return {
      stage(raw: unknown) {
        if (!enabled || closed || !raw || typeof raw !== 'object' || Array.isArray(raw)) return;
        let v: Partial<BodyStage>;
        try {
          const input = raw as Partial<BodyStage>;
          v = {
            postId: input.postId,
            blogId: input.blogId,
            postOwnerBlogId: input.postOwnerBlogId,
            bodyOwnerBlogId: input.bodyOwnerBlogId,
            publicationStatus: input.publicationStatus,
            status: input.status,
            changed: input.changed,
          };
        } catch {
          return;
        }
        if (
          closed ||
          !id(v.postId) ||
          !id(v.blogId) ||
          v.postOwnerBlogId !== v.blogId ||
          v.bodyOwnerBlogId !== v.blogId ||
          v.publicationStatus !== 'verified' ||
          v.status !== 'ok' ||
          v.changed !== true
        )
          return;
        if (pending.has(v.postId)) return;
        if (pending.size >= 10) {
          overflow++;
          return;
        }
        pending.set(v.postId, v as BodyStage);
      },
      discard() {
        closed = true;
        pending.clear();
        overflow = 0;
      },
      /** Caller assertion: SQL COMMIT and connection release both returned successfully. */
      committed() {
        if (closed) return;
        closed = true;
        overflowEvents += overflow;
        for (const event of pending.values()) {
          if (scopes.size < 10) scopes.add(event.blogId);
          if (adoption.recordCommitted({ commitState: 'committed', ...event }).status === 'full') overflowEvents++;
        }
        pending.clear();
      },
      unproven() {
        if (closed) return;
        closed = true;
        if (pending.size || overflow) {
          unproven = true;
          for (const event of pending.values()) if (scopes.size < 10) scopes.add(event.blogId);
        }
        pending.clear();
      },
    };
  }
  let last: IndexAdoptionReport | undefined;
  let flushing: Promise<IndexAdoptionReport> | undefined;
  async function finish(): Promise<IndexAdoptionReport> {
    const result = await adoption.flush();
    const repair = result.state === 'needs-repair' || overflowEvents > 0 || unproven;
    last = {
      channel,
      state: !enabled ? 'disabled' : repair ? 'needs-repair' : 'queued',
      partial: enabled && repair,
      acknowledgedPostIds: result.acknowledgedPostIds,
      pendingPostIds: result.pending.map((v) => v.postId),
      overflowEvents,
      overflowed: overflowEvents > 0,
      scopeRepair: repair ? [...scopes] : [],
      reason: unproven ? 'unproven-transaction' : overflowEvents ? 'overflow' : result.state === 'needs-repair' ? 'queue-unknown' : 'none',
      indexed: false,
      reporting: options.onIndexAdoptionReport ? 'attempted' : 'not-configured',
    };
    // Reporting cannot roll back committed content or fail an already completed history task.
    try {
      const reported = options.onIndexAdoptionReport?.(last);
      if (reported)
        void Promise.resolve(reported).catch(() => {
          if (last) last.reporting = 'failed';
        });
    } catch {
      last.reporting = 'failed';
    }
    return last;
  }
  function flush() {
    flushing ??= finish();
    return flushing;
  }
  return { transaction, flush };
}
