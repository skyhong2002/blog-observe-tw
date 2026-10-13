import { isDeepStrictEqual } from 'node:util';
import {
  hash,
  MAX_SNAPSHOT_MANIFEST_BYTES,
  MAX_SNAPSHOT_PAGE_BYTES,
  MAX_SNAPSHOT_TERMS,
  SOURCE,
  strictIso,
  validateManifest,
  validatePage,
} from './snapshot-client.ts';

export const CHANGES_SOURCE_COMMIT = 'a89908a650c42a1224d657e6c908d5fd3c7be5a0';
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const sha = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const invalid = (): never => {
  throw Error('invalid_snapshot_changes');
};
/** Plain JSON only; no getters/toJSON/iterators are executed. Opaque metadata remains pinned. */
function jsonCopy(value: unknown, cap: number): Record<string, unknown> {
  let nodes = 0;
  function copy(v: unknown, depth = 0): unknown {
    if (++nodes > 200000 || depth > 32) return invalid();
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (!v || typeof v !== 'object') return invalid();
    const desc = Object.getOwnPropertyDescriptors(v);
    const array = Array.isArray(v);
    const result: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
    for (const key of Reflect.ownKeys(desc)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string' || !desc[key].enumerable || !Object.hasOwn(desc[key], 'value')) return invalid();
      if (array && !/^(0|[1-9]\d*)$/.test(key)) return invalid();
      Object.defineProperty(result, key, { value: copy(desc[key].value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    if (array && Object.keys(result).length !== (v as unknown[]).length) return invalid();
    return result;
  }
  const out = copy(value);
  if (!out || typeof out !== 'object' || Array.isArray(out) || Buffer.byteLength(JSON.stringify(out)) > cap) return invalid();
  return out as Record<string, unknown>;
}
export function validateChangesGeneration(raw: unknown) {
  const g = jsonCopy(raw, MAX_SNAPSHOT_MANIFEST_BYTES);
  if (g.kind !== undefined && g.kind !== 'delta') return invalid();
  if (g.kind === 'delta') {
    if (
      g.schemaVersion !== 1 ||
      !uuid(g.id) ||
      !uuid(g.previousId) ||
      !uuid(g.baseSnapshotId) ||
      !strictIso(g.generatedAt) ||
      g.source !== SOURCE ||
      !Number.isSafeInteger(g.total) ||
      Number(g.total) < 0 ||
      Number(g.total) > MAX_SNAPSHOT_TERMS ||
      g.pageSize !== 500
    )
      return invalid();
  } else validateManifest(g);
  if (
    !Number.isSafeInteger(g.changeCount) ||
    Number(g.changeCount) < 0 ||
    Number(g.changeCount) > MAX_SNAPSHOT_TERMS * 2 ||
    !Array.isArray(g.changePages) ||
    g.changePages.length !== Math.ceil(Number(g.changeCount) / 500) ||
    g.changePages.some((v) => !sha(v)) ||
    typeof g.noisePolicyVersion !== 'string' ||
    !g.noisePolicyVersion.trim() ||
    g.noisePolicyVersion.length > 2000
  )
    return invalid();
  return g;
}
export function pinChangesGeneration(after: string, raw: unknown) {
  if (!uuid(after)) return invalid();
  const generation = validateChangesGeneration(raw);
  return { after, target: generation.id as string, generation, generationDigest: hash(JSON.stringify(generation)) };
}
/** Local request binding, not invented response fields. Chain page catalog is absent upstream. */
export function validateChangesPage(raw: unknown, pin: ReturnType<typeof pinChangesGeneration>, cursor: string) {
  pin = jsonCopy(pin, MAX_SNAPSHOT_MANIFEST_BYTES + 1000) as unknown as ReturnType<typeof pinChangesGeneration>;
  validateChangesGeneration(pin.generation);
  if (
    !uuid(pin.after) ||
    !uuid(pin.target) ||
    !/^(0|[1-9]\d{0,5})$/.test(cursor) ||
    pin.generation.id !== pin.target ||
    hash(JSON.stringify(pin.generation)) !== pin.generationDigest
  )
    return invalid();
  const page = jsonCopy(raw, MAX_SNAPSHOT_PAGE_BYTES);
  const generation = validateChangesGeneration(page.snapshot);
  if (
    !isDeepStrictEqual(generation, pin.generation) ||
    page.cursor !== cursor ||
    (page.nextCursor !== null && page.nextCursor !== String(Number(cursor) + 1)) ||
    !Array.isArray(page.entries) ||
    page.entries.length > 500 ||
    !sha(page.sha256) ||
    hash(JSON.stringify(page.entries) + '\n') !== page.sha256
  )
    return invalid();
  if (pin.after === pin.target && (cursor !== '0' || page.entries.length !== 0 || page.nextCursor !== null)) return invalid();
  for (const rawChange of page.entries) {
    if (!rawChange || typeof rawChange !== 'object' || Array.isArray(rawChange)) return invalid();
    const change = rawChange as Record<string, unknown>;
    if ('active' in change && typeof change.active !== 'boolean') return invalid();
    if (change.action === 'upsert') {
      const entries = [change.term],
        checksum = hash(JSON.stringify(entries) + '\n');
      const synthetic = {
        schemaVersion: 1,
        id: pin.target,
        previousId: null,
        generatedAt: generation.generatedAt,
        source: SOURCE,
        attribution: 'contract-validation',
        coverage: 'all-current-indexed-article-tags',
        provenance: 'mixed',
        identity: 'sha256-exact-utf8-label',
        total: 1,
        pageSize: 500,
        pages: [checksum],
        sha256: hash(JSON.stringify(change.term) + '\n'),
        changeCount: 0,
        changePages: [],
      };
      validatePage({ snapshot: synthetic, entries, cursor: '0', nextCursor: null, sha256: checksum }, validateManifest(synthetic), 0);
    } else if (change.action === 'absent-from-index') {
      if (
        typeof change.label !== 'string' ||
        !change.label.trim() ||
        /[\uD800-\uDFFF]/u.test(change.label) ||
        [...change.label].length > 60 ||
        change.id !== hash(change.label)
      )
        return invalid();
    } else return invalid();
  }
  return {
    page,
    integrity: 'per-page-checksum' as const,
    chain: 'unverified' as const,
    completeGeneration: false as const,
    cutoverAllowed: false as const,
    absenceMeaning: 'upstream-index-only; not blog-evidence revocation or pool/SEO deletion' as const,
  };
}
export function changesHttpStatus(status: number) {
  return status === 409
    ? { status: 'need-full-rebase' as const, retainCurrent: true as const }
    : { status: 'unavailable' as const, retainCurrent: true as const };
}
