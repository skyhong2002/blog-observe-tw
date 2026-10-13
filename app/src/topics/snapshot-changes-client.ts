import { changesHttpStatus, pinChangesGeneration, validateChangesPage } from './snapshot-changes-contract.ts';
import { MAX_SNAPSHOT_PAGE_BYTES } from './snapshot-client.ts';
import { TagApiTransport, TagHttpError, TagRateLimitError, type TagTransportOptions } from './transport.ts';

type Pin = ReturnType<typeof pinChangesGeneration>;
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const cursorValid = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d{0,5})$/.test(v);
/** Read-only, explicit opt-in. No database, scheduler, automatic rebase or current-pointer publication. */
export class HttpSnapshotChangesSource {
  private readonly transport: TagApiTransport;
  private readonly enabled: boolean;
  constructor(request: typeof fetch = fetch, options: TagTransportOptions & { enabled?: boolean } = {}) {
    this.enabled = options.enabled === true;
    this.transport = new TagApiTransport(request, options);
  }
  private failure(error: unknown) {
    if (error instanceof TagRateLimitError)
      return { status: 'deferred' as const, nextAttemptAt: error.retryAt.toISOString(), retainCurrent: true as const };
    if (error instanceof TagHttpError) return changesHttpStatus(error.status);
    if (
      error instanceof Error &&
      (/^invalid_snapshot_changes$|^Invalid (upstream vocabulary|vocabulary)|^Vocabulary snapshot changed|^Vocabulary page/.test(
        error.message,
      ) ||
        ['Vocabulary changes exceeds byte cap', 'Vocabulary changes invalid JSON'].includes(error.message))
    )
      return { status: 'failed' as const, reason: 'invalid-contract' as const, retainCurrent: true as const };
    return { status: 'unavailable' as const, retainCurrent: true as const };
  }
  async first(after: string) {
    if (!this.enabled) return { status: 'disabled' as const, retainCurrent: true as const };
    if (!uuid(after)) return { status: 'invalid-selection' as const, retainCurrent: true as const };
    try {
      const raw = await this.transport.json(
        `/api/v1/vocabulary/changes?after=${after}&cursor=0`,
        MAX_SNAPSHOT_PAGE_BYTES,
        'Vocabulary changes',
      );
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('invalid_snapshot_changes');
      const pin = pinChangesGeneration(after, (raw as { snapshot?: unknown }).snapshot);
      return { status: 'ready' as const, pin, ...validateChangesPage(raw, pin, '0'), retainCurrent: true as const };
    } catch (error) {
      return this.failure(error);
    }
  }
  async page(pin: Pin, cursor: string) {
    if (!this.enabled) return { status: 'disabled' as const, retainCurrent: true as const };
    // Validate the persisted pin before it is interpolated into any URL.
    let checked: Pin;
    try {
      if (!pin || !uuid(pin.after) || !uuid(pin.target) || !cursorValid(cursor)) throw Error();
      checked = pinChangesGeneration(pin.after, pin.generation);
      if (checked.target !== pin.target || checked.generationDigest !== pin.generationDigest) throw Error();
    } catch {
      return { status: 'invalid-selection' as const, retainCurrent: true as const };
    }
    try {
      const raw = await this.transport.json(
        `/api/v1/vocabulary/changes?after=${checked.after}&target=${checked.target}&cursor=${cursor}`,
        MAX_SNAPSHOT_PAGE_BYTES,
        'Vocabulary changes',
      );
      return { status: 'ready' as const, pin: checked, ...validateChangesPage(raw, checked, cursor), retainCurrent: true as const };
    } catch (error) {
      return this.failure(error);
    }
  }
}
