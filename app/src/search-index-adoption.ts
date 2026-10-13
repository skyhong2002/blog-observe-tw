/** Source-only commit notification contract. No environment, database, network or native caller. */
export const SEARCH_INDEX_ADOPTION_LIMIT = 10;
export type CommittedBodyAdoption = {
  commitState: 'committed';
  status: 'ok';
  changed: true;
  publicationStatus: 'verified';
  postId: number;
  blogId: number;
  postOwnerBlogId: number;
  bodyOwnerBlogId: number;
};
export type AdoptionOwner = { postId: number; blogId: number };
export type AdoptionEnqueue = (postIds: readonly number[]) => Promise<{ acceptedPostIds: readonly number[] }>;
export type AdoptionState = 'disabled' | 'collecting' | 'flushing' | 'queued' | 'discarded' | 'needs-repair';
const validId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Create per durable transaction/batch boundary. A successful commit is a caller assertion, not proved here. */
export function createSearchIndexAdoption(options: { enabled?: boolean; enqueue?: AdoptionEnqueue } = {}) {
  const enabled = options.enabled === true;
  const enqueue = options.enqueue;
  const pending = new Map<number, number>();
  let state: AdoptionState = enabled ? 'collecting' : 'disabled';
  let overflow = false;
  let acknowledged: number[] = [];
  const snapshot = () => ({
    state,
    pending: [...pending].map(([postId, blogId]): AdoptionOwner => ({ postId, blogId })),
    acknowledgedPostIds: [...acknowledged],
    overflow,
    indexed: false as const,
    retryPolicy: 'no-automatic-retry; operator-reconcile-and-fresh-producer-recheck' as const,
  });
  return {
    recordCommitted(raw: unknown) {
      if (!enabled) return { status: 'disabled' as const };
      if (state !== 'collecting') return { status: 'closed' as const };
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { status: 'skipped' as const };
      let event: Partial<CommittedBodyAdoption>;
      try {
        const value = raw as Partial<CommittedBodyAdoption>;
        event = {
          commitState: value.commitState,
          status: value.status,
          changed: value.changed,
          publicationStatus: value.publicationStatus,
          postId: value.postId,
          blogId: value.blogId,
          postOwnerBlogId: value.postOwnerBlogId,
          bodyOwnerBlogId: value.bodyOwnerBlogId,
        };
      } catch {
        return { status: 'skipped' as const };
      }
      // Accessors may reenter trusted caller code. Never resume a batch that was closed during capture.
      if (state !== 'collecting') return { status: 'skipped' as const };
      if (
        event.commitState !== 'committed' ||
        event.status !== 'ok' ||
        event.changed !== true ||
        event.publicationStatus !== 'verified' ||
        !validId(event.postId) ||
        !validId(event.blogId) ||
        event.postOwnerBlogId !== event.blogId ||
        event.bodyOwnerBlogId !== event.blogId
      )
        return { status: 'skipped' as const };
      if (pending.has(event.postId)) {
        if (pending.get(event.postId) !== event.blogId) return { status: 'skipped' as const };
        return { status: 'duplicate' as const };
      }
      if (pending.size >= SEARCH_INDEX_ADOPTION_LIMIT) {
        overflow = true;
        return { status: 'full' as const };
      }
      // Only primitive allowlisted IDs are retained. Never retain raw event, URL, body, hash or extra properties.
      pending.set(event.postId, event.blogId);
      return { status: 'recorded' as const };
    },
    discard() {
      if (state === 'flushing') return { status: 'in-flight' as const, cancellation: 'not-guaranteed' as const };
      if (state === 'collecting') {
        pending.clear();
        state = 'discarded';
      }
      return snapshot();
    },
    async flush() {
      if (state !== 'collecting') return snapshot();
      if (!pending.size) {
        state = 'queued';
        return snapshot();
      }
      if (typeof enqueue !== 'function') {
        state = 'needs-repair';
        return snapshot();
      }
      state = 'flushing';
      const requested = [...pending.keys()];
      try {
        const result = await enqueue(Object.freeze([...requested]));
        const accepted = result?.acceptedPostIds;
        if (!Array.isArray(accepted)) throw Error('unverified_enqueue_ack');
        const length = accepted.length;
        if (!Number.isSafeInteger(length) || length < 0 || length > SEARCH_INDEX_ADOPTION_LIMIT || length > requested.length)
          throw Error('unverified_enqueue_ack');
        // Capture bounded indexed entries once into an ordinary local array; never invoke an input iterator.
        const copy: unknown[] = [];
        for (let index = 0; index < length; index++) copy.push(accepted[index]);
        const verified: number[] = [],
          seen = new Set<number>();
        for (let index = 0; index < copy.length; index++) {
          const id = copy[index];
          if (!validId(id) || seen.has(id) || !requested.includes(id)) throw Error('unverified_enqueue_ack');
          seen.add(id);
          verified.push(id);
        }
        acknowledged = verified;
        for (const id of acknowledged) pending.delete(id);
        state = pending.size ? 'needs-repair' : 'queued';
      } catch {
        // Queue side effects may already exist. Do not fabricate success or replay after an unknown outcome.
        state = 'needs-repair';
      }
      return snapshot();
    },
    snapshot,
  };
}
