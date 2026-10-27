/** Read-only, preview-only: no DB, production pointer, worker, or full-pool download. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimatedMatcherBytes } from '../app/src/topics/active-set.ts';
import { TopicMatcher } from '../app/src/topics/matcher.ts';
import { ACTIVE_TOPIC_LIMITS, exclusionReason, mergeExclusionReasons } from '../app/src/topics/policy.ts';
import { readTagServiceToken } from '../app/src/topics/service-token.ts';
import { retryAfterMs } from '../app/src/topics/transport.ts';

const LOCAL = 'http://127.0.0.1:18130';
const PUBLIC = 'https://tag.observe.tw';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const uuid = new RegExp(`^${UUID}$`);
const sha = /^[0-9a-f]{64}$/;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
export const PREVIEW_LIMITS = { terms: 100_000, retainedBytes: 96 * 1024 ** 2, responseBytes: 2 * 1024 ** 2 } as const;
export class PreviewFailure extends Error {
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  constructor(code: string, status: number | null = null, retry: number | null = null) {
    super(code);
    this.status = status;
    this.retryAfterMs = retry;
  }
}
export type TransportOptions = {
  fetch?: typeof fetch;
  token?: () => Promise<string | null>;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
};
export class PreviewTransport {
  private request: typeof fetch;
  private token: () => Promise<string | null>;
  private now: () => number;
  private wait: (ms: number) => Promise<unknown>;
  private origin = LOCAL;
  private last = -Infinity;
  private tail: Promise<unknown> = Promise.resolve();
  readonly diagnostics = { requests: 0, retries: 0, fallbacks: 0, bytes: 0, minSpacingMs: Infinity };
  constructor(options: TransportOptions = {}) {
    this.request = options.fetch ?? fetch;
    this.token = options.token ?? readTagServiceToken;
    this.now = options.now ?? Date.now;
    this.wait = options.sleep ?? sleep;
  }
  json(path: string): Promise<unknown> {
    const current = path === '/api/v1/vocabulary/snapshots/current';
    const active = new RegExp(`^/api/v1/vocabulary/snapshots/${UUID}/active\\?cursor=\\d{1,3}&compact=1$`).test(path);
    const changes = new RegExp(`^/api/v1/vocabulary/changes\\?after=${UUID}(?:&target=${UUID})?(?:&cursor=\\d{1,6})?$`).test(path);
    if (!current && !active && !changes) return Promise.reject(new PreviewFailure('preview_path_forbidden'));
    const result = this.tail.then(() => this.perform(path));
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async perform(path: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const spacing = this.origin === LOCAL ? 500 : 1100;
      await this.wait(Math.max(0, this.last + spacing - this.now()));
      const headers: Record<string, string> = {
        accept: 'application/json',
        'user-agent': 'BlogObserveVocabularyPreview/1.0 (+https://weblog.tw/about/)',
      };
      if (this.origin === PUBLIC) {
        const token = await this.token();
        if (!token) throw new PreviewFailure('public_service_token_unavailable');
        headers['x-service-token'] = token;
      }
      const elapsed = this.now() - this.last;
      if (Number.isFinite(elapsed)) this.diagnostics.minSpacingMs = Math.min(this.diagnostics.minSpacingMs, elapsed);
      this.last = this.now();
      this.diagnostics.requests++;
      const signal = AbortSignal.timeout(30_000);
      let response: Response;
      try {
        response = await this.request(this.origin + path, { method: 'GET', redirect: 'error', signal, headers });
      } catch (error) {
        const code = (error as { code?: string; cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
        if (
          this.origin === LOCAL &&
          ['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code ?? '')
        ) {
          this.origin = PUBLIC;
          this.diagnostics.fallbacks++;
          continue;
        }
        throw new PreviewFailure('preview_transport_failed');
      }
      if (response.status === 429) {
        const pause = retryAfterMs(response.headers.get('retry-after'), attempt, this.now());
        await response.body?.cancel();
        if (attempt >= 2 || pause > 30_000) throw new PreviewFailure('preview_rate_limited', 429, pause);
        this.diagnostics.retries++;
        await this.wait(pause);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new PreviewFailure('preview_http_failed', response.status);
      }
      if (!response.body) throw new PreviewFailure('preview_empty_response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      const abort = () => {
        void reader.cancel().catch(() => {});
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        while (true) {
          signal.throwIfAborted();
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > PREVIEW_LIMITS.responseBytes) throw new PreviewFailure('preview_response_byte_cap');
          chunks.push(part.value);
        }
        signal.throwIfAborted();
        this.diagnostics.bytes += size;
        try {
          return JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          throw new PreviewFailure('preview_invalid_json');
        }
      } finally {
        signal.removeEventListener('abort', abort);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  }
}

export type ActiveManifest = {
  id: string;
  generatedAt: string;
  total: number;
  pageSize: 500;
  sha256: string;
  active: { total: number; pages: string[]; sha256: string; days: number; minRecentArticleCount: number };
};
export type PreviewTerm = { id: string; label: string; articleCount: number; noise?: boolean; noEqual?: boolean; [key: string]: unknown };
export function activeManifest(raw: unknown): ActiveManifest {
  if (
    !object(raw) ||
    raw.source !== PUBLIC ||
    typeof raw.id !== 'string' ||
    !uuid.test(raw.id) ||
    typeof raw.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(raw.generatedAt)) ||
    typeof raw.total !== 'number' ||
    !Number.isSafeInteger(raw.total) ||
    raw.total < 0 ||
    raw.pageSize !== 500 ||
    typeof raw.sha256 !== 'string' ||
    !sha.test(raw.sha256) ||
    !object(raw.active)
  )
    throw new PreviewFailure('preview_invalid_manifest');
  const a = raw.active;
  if (
    typeof a.total !== 'number' ||
    !Number.isSafeInteger(a.total) ||
    a.total < 0 ||
    a.total > PREVIEW_LIMITS.terms ||
    !Array.isArray(a.pages) ||
    a.pages.length !== Math.ceil(a.total / 500) ||
    a.pages.some((hash: unknown) => typeof hash !== 'string' || !sha.test(hash)) ||
    typeof a.sha256 !== 'string' ||
    !sha.test(a.sha256)
  )
    throw new PreviewFailure('preview_active_manifest_cap_or_schema');
  return raw as ActiveManifest;
}
export function activePage(raw: unknown, manifest: ActiveManifest, index: number): PreviewTerm[] {
  if (
    !object(raw) ||
    !object(raw.snapshot) ||
    !object(raw.subset) ||
    index < 0 ||
    index >= manifest.active.pages.length ||
    raw.snapshot.id !== manifest.id ||
    raw.snapshot.generatedAt !== manifest.generatedAt ||
    raw.snapshot.total !== manifest.total ||
    raw.snapshot.pageSize !== 500 ||
    raw.snapshot.sha256 !== manifest.sha256 ||
    raw.subset.total !== manifest.active.total ||
    raw.subset.sha256 !== manifest.active.sha256 ||
    raw.cursor !== String(index) ||
    raw.nextCursor !== (index + 1 < manifest.active.pages.length ? String(index + 1) : null) ||
    !Array.isArray(raw.entries) ||
    raw.entries.length !== Math.min(500, manifest.active.total - index * 500) ||
    raw.sha256 !== manifest.active.pages[index] ||
    digest(`${JSON.stringify(raw.entries)}\n`) !== raw.sha256
  )
    throw new PreviewFailure('preview_page_checksum_or_contract');
  for (const item of raw.entries) {
    if (
      !object(item) ||
      typeof item.label !== 'string' ||
      [...item.label].length > 240 ||
      item.id !== digest(item.label) ||
      typeof item.articleCount !== 'number' ||
      !Number.isSafeInteger(item.articleCount) ||
      item.articleCount < 0 ||
      ('noise' in item && typeof item.noise !== 'boolean') ||
      ('noEqual' in item && typeof item.noEqual !== 'boolean')
    )
      throw new PreviewFailure('preview_invalid_term');
  }
  return raw.entries as PreviewTerm[];
}
export const normalizePreview = (label: string) =>
  label
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ')
    .trim();
type Retained = {
  id: string;
  label: string;
  displayLabel: string;
  sourceId: string;
  articleCount: number;
  reason: string | null;
  aliases: number;
};
export class ActiveAccumulator {
  readonly terms = new Map<string, Retained>();
  readonly limits: { terms: number; retainedBytes: number };
  estimatedRetainedBytes = 0;
  received = 0;
  zeroWidthChanged = 0;
  duplicates = 0;
  readonly duplicateExamples: { normalized: string; display: string }[] = [];
  constructor(
    limits: { terms: number; retainedBytes: number } = { terms: PREVIEW_LIMITS.terms, retainedBytes: PREVIEW_LIMITS.retainedBytes },
  ) {
    this.limits = limits;
  }
  add(term: PreviewTerm) {
    this.received++;
    const label = normalizePreview(term.label);
    if (/\p{Cf}/u.test(term.label)) this.zeroWidthChanged++;
    const reason = exclusionReason(label, { noise: term.noise, noEqual: term.noEqual });
    const old = this.terms.get(label);
    if (old) {
      this.duplicates++;
      old.aliases++;
      old.reason = mergeExclusionReasons(old.reason, reason);
      if (this.duplicateExamples.length < 10) this.duplicateExamples.push({ normalized: label, display: term.label });
      if (term.articleCount > old.articleCount || (term.articleCount === old.articleCount && term.id < old.sourceId)) {
        old.articleCount = term.articleCount;
        old.displayLabel = term.label;
        old.sourceId = term.id;
      }
      return;
    }
    // A deliberately conservative allowance for Map/object/strings; the page
    // response is separately bounded and is discarded before the next page.
    const estimate = 1536 + label.length * 2 + term.label.length * 2;
    if (this.terms.size >= this.limits.terms || this.estimatedRetainedBytes + estimate > this.limits.retainedBytes)
      throw new PreviewFailure('preview_retained_memory_cap');
    this.estimatedRetainedBytes += estimate;
    this.terms.set(label, {
      id: digest(label),
      label,
      displayLabel: term.label,
      sourceId: term.id,
      articleCount: term.articleCount,
      reason,
      aliases: 1,
    });
  }
  select() {
    const exclusions: Record<string, number> = {};
    const selected: { id: string; label: string }[] = [];
    let points = 0;
    let capped = false;
    let budgetExcluded = 0;
    const sorted = [...this.terms.values()].sort((a, b) => b.articleCount - a.articleCount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const term of sorted) {
      if (term.reason) {
        exclusions[term.reason] = (exclusions[term.reason] ?? 0) + 1;
        continue;
      }
      const count = [...term.label].length;
      if (
        capped ||
        selected.length + 1 > ACTIVE_TOPIC_LIMITS.maxTerms ||
        points + count > ACTIVE_TOPIC_LIMITS.maxCodePoints ||
        estimatedMatcherBytes(points + count, selected.length + 1) > ACTIVE_TOPIC_LIMITS.maxEstimatedBytes
      ) {
        capped = true;
        budgetExcluded++;
        continue;
      }
      points += count;
      selected.push({ id: term.id, label: term.label });
    }
    return {
      selected,
      exclusions,
      budgetExcluded,
      codePoints: points,
      estimatedMatcherBytes: estimatedMatcherBytes(points, selected.length),
    };
  }
}

export async function previewChanges(transport: Pick<PreviewTransport, 'json'>, initialAfter: string, rounds = 3, maxPages = 8) {
  const results: Record<string, unknown>[] = [];
  let after = initialAfter;
  for (let round = 0; round < Math.min(3, Math.max(0, rounds)); round++) {
    const started = performance.now();
    let target: string | undefined;
    let cursor: string | null = null;
    let entries = 0;
    let pages = 0;
    try {
      do {
        const query = `after=${after}${target ? `&target=${target}` : ''}${cursor ? `&cursor=${cursor}` : ''}`;
        const raw = await transport.json(`/api/v1/vocabulary/changes?${query}`);
        if (
          !object(raw) ||
          !object(raw.snapshot) ||
          typeof raw.snapshot.id !== 'string' ||
          !uuid.test(raw.snapshot.id) ||
          (target && raw.snapshot.id !== target) ||
          !Array.isArray(raw.entries) ||
          raw.entries.length > 500 ||
          raw.cursor !== (cursor ?? '0') ||
          !(
            raw.nextCursor === null ||
            (typeof raw.nextCursor === 'string' && /^\d{1,6}$/.test(raw.nextCursor) && Number(raw.nextCursor) > Number(cursor ?? '0'))
          ) ||
          typeof raw.sha256 !== 'string' ||
          !sha.test(raw.sha256) ||
          digest(`${JSON.stringify(raw.entries)}\n`) !== raw.sha256
        )
          throw new PreviewFailure('preview_changes_contract');
        target = raw.snapshot.id;
        cursor = raw.nextCursor;
        entries += raw.entries.length;
        pages++;
      } while (cursor !== null && pages < maxPages);
      results.push({
        round,
        after,
        target,
        status: 200,
        pages,
        entries,
        complete: cursor === null,
        nextCursor: cursor,
        elapsedMs: Math.round(performance.now() - started),
      });
      if (cursor === null && target) after = target;
      else break;
    } catch (error) {
      const known = error instanceof PreviewFailure ? error : new PreviewFailure('preview_changes_failed');
      results.push({
        round,
        after,
        target,
        status: known.status,
        code: known.message,
        retryAfterMs: known.retryAfterMs,
        pages,
        entries,
        elapsedMs: Math.round(performance.now() - started),
        resetRequired: known.status === 409,
      });
      break;
    }
  }
  return results;
}

function memory() {
  const { heapUsed, heapTotal, rss, external } = process.memoryUsage();
  return { heapUsed, heapTotal, rss, external };
}
export async function runPreview(transport = new PreviewTransport(), progress: (value: unknown) => void = () => {}) {
  const started = performance.now();
  const manifest = activeManifest(await transport.json('/api/v1/vocabulary/snapshots/current'));
  const initialMemory = memory();
  const accumulator = new ActiveAccumulator();
  const fullHash = createHash('sha256');
  let previous: Buffer | null = null;
  let peakHeap = initialMemory.heapUsed;
  let peakRss = initialMemory.rss;
  for (let index = 0; index < manifest.active.pages.length; index++) {
    const terms = activePage(
      await transport.json(`/api/v1/vocabulary/snapshots/${manifest.id}/active?cursor=${index}&compact=1`),
      manifest,
      index,
    );
    for (const term of terms) {
      const label = Buffer.from(term.label);
      if (previous && Buffer.compare(previous, label) >= 0) throw new PreviewFailure('preview_source_order_or_duplicate');
      previous = label;
      fullHash.update(`${JSON.stringify(term)}\n`);
      accumulator.add(term);
    }
    const usage = memory();
    peakHeap = Math.max(peakHeap, usage.heapUsed);
    peakRss = Math.max(peakRss, usage.rss);
    if ((index + 1) % 10 === 0 || index + 1 === manifest.active.pages.length)
      progress({
        phase: 'active-pages',
        pages: index + 1,
        expectedPages: manifest.active.pages.length,
        terms: accumulator.received,
        canonical: accumulator.terms.size,
        elapsedMs: Math.round(performance.now() - started),
      });
  }
  const fullChecksum = fullHash.digest('hex');
  if (accumulator.received !== manifest.active.total || fullChecksum !== manifest.active.sha256)
    throw new PreviewFailure('preview_full_active_checksum');
  const selection = accumulator.select();
  globalThis.gc?.();
  const beforeMatcher = memory();
  const matcherStarted = performance.now();
  const matcher = new TopicMatcher(selection.selected);
  const matcherBuildMs = Math.round(performance.now() - matcherStarted);
  const afterBuild = memory();
  globalThis.gc?.();
  const afterGc = memory();
  const changes = await previewChanges(transport, manifest.id);
  return {
    previewOnly: true,
    productionChanged: false,
    snapshot: manifest.id,
    generatedAt: manifest.generatedAt,
    fullPoolTotal: manifest.total,
    activePolicy: { days: manifest.active.days, minRecentArticleCount: manifest.active.minRecentArticleCount },
    activeTotal: accumulator.received,
    pages: manifest.active.pages.length,
    pageChecksumsVerified: true,
    fullChecksumVerified: true,
    canonicalTotal: accumulator.terms.size,
    duplicateAliases: accumulator.duplicates,
    zeroWidthLabels: accumulator.zeroWidthChanged,
    duplicateExamples: accumulator.duplicateExamples,
    exclusions: selection.exclusions,
    memoryBudgetExcluded: selection.budgetExcluded,
    selected: selection.selected.length,
    matcher: matcher.statistics,
    matcherBuildMs,
    retainedEstimate: accumulator.estimatedRetainedBytes,
    memory: {
      gcAvailable: Boolean(globalThis.gc),
      initial: initialMemory,
      beforeMatcher,
      afterBuild,
      afterGc,
      matcherHeapDelta: afterGc.heapUsed - beforeMatcher.heapUsed,
      peakObservedHeap: Math.max(peakHeap, afterBuild.heapUsed),
      peakObservedRss: Math.max(peakRss, afterBuild.rss),
    },
    transport: transport.diagnostics,
    changes,
    elapsedMs: Math.round(performance.now() - started),
    caveats: [
      'active subset preview only; not the full pool or topic-page population',
      'heap delta includes runtime allocation and is not a hard RSS cap',
      'changes are validated/read only, never applied',
    ],
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.argv[2] ?? '.reviews/history/vocabulary-active-preview.json';
  const path = resolve(output);
  const root = resolve('.reviews/history');
  if (!path.startsWith(`${root}/`)) throw new PreviewFailure('preview_output_must_be_ignored_history');
  try {
    const report = await runPreview(undefined, (value) => console.log(JSON.stringify(value)));
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(
      JSON.stringify({ report: output, selected: report.selected, canonical: report.canonicalTotal, elapsedMs: report.elapsedMs }),
    );
  } catch (error) {
    const known = error instanceof PreviewFailure ? error : new PreviewFailure('preview_failed');
    console.error(JSON.stringify({ previewOnly: true, code: known.message, status: known.status, retryAfterMs: known.retryAfterMs }));
    process.exitCode = 1;
  }
}
