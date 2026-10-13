/** Standard SHA-256 resumable state, independent of OpenSSL internals.
 * A state digest detects corruption, not hostile rewriting/authentication.
 * The final digest must still equal the pinned upstream whole SHA-256.
 */
export const SNAPSHOT_CHECKPOINT_MAX_BYTES = 2 * 1024 ** 3;
export const SNAPSHOT_CHECKPOINT_VERSION = 'sha256-stream-checkpoint-v1' as const;
const INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
  0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const rotate = (x: number, n: number) => (x >>> n) | (x << (32 - n));
const fail = (): never => {
  throw Error('invalid_snapshot_checkpoint');
};
const uint = (x: unknown, maximum: number): x is number =>
  typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 && x <= maximum && !Object.is(x, -0);
const hex = (words: number[]) => words.map((word) => word.toString(16).padStart(8, '0')).join('');
export type Sha256State = { words: number[]; pending: number[]; totalBytes: number };
function exactObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some((key) => !Object.hasOwn(descriptors, key))) return fail();
  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return fail();
    copy[key] = descriptor.value;
  }
  return copy;
}
function numberArray(value: unknown, length: number | null, maximum: number): number[] {
  if (!Array.isArray(value) || (length !== null ? value.length !== length : value.length > 63)) return fail();
  // Reject holes, accessors, extra keys and values outside their binary width.
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) return fail();
  const output: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const d = descriptors[String(i)];
    if (!d || !Object.hasOwn(d, 'value') || !uint(d.value, maximum)) return fail();
    output.push(d.value);
  }
  return output;
}
function validateState(raw: unknown): Sha256State {
  const obj = exactObject(raw, ['words', 'pending', 'totalBytes']);
  const words = numberArray(obj.words, 8, 0xffffffff),
    pending = numberArray(obj.pending, null, 255);
  if (!uint(obj.totalBytes, SNAPSHOT_CHECKPOINT_MAX_BYTES) || obj.totalBytes % 64 !== pending.length) return fail();
  if (obj.totalBytes < 64 && words.some((word, i) => word !== INITIAL[i])) return fail();
  return { words, pending, totalBytes: obj.totalBytes };
}
export class SnapshotSha256 {
  private words = [...INITIAL];
  private pending = new Uint8Array(0);
  private totalBytes = 0;
  private finalized: string | undefined;
  static fromState(raw: unknown) {
    const state = validateState(raw),
      stream = new SnapshotSha256();
    stream.words = state.words;
    stream.pending = Uint8Array.from(state.pending);
    stream.totalBytes = state.totalBytes;
    return stream;
  }
  exportState(): Sha256State {
    if (this.finalized !== undefined) throw Error('snapshot_sha256_finalized');
    return { words: [...this.words], pending: [...this.pending], totalBytes: this.totalBytes };
  }
  private block(bytes: Uint8Array, offset = 0) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) {
      const p = offset + i * 4;
      w[i] = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15],
        b = w[i - 2];
      w[i] = (w[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.words;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [a, b, c, d, e, f, g, h] = [(t1 + t2) >>> 0, a, b, c, (d + t1) >>> 0, e, f, g];
    }
    this.words = this.words.map((word, i) => (word + [a, b, c, d, e, f, g, h][i]) >>> 0);
  }
  update(bytes: Uint8Array): this {
    if (this.finalized !== undefined) throw Error('snapshot_sha256_finalized');
    if (!(bytes instanceof Uint8Array) || bytes.length > SNAPSHOT_CHECKPOINT_MAX_BYTES - this.totalBytes)
      throw Error('snapshot_sha256_byte_cap');
    this.totalBytes += bytes.length;
    let offset = 0;
    if (this.pending.length) {
      const take = Math.min(64 - this.pending.length, bytes.length),
        combined = new Uint8Array(this.pending.length + take);
      combined.set(this.pending);
      combined.set(bytes.subarray(0, take), this.pending.length);
      offset = take;
      if (combined.length < 64) {
        this.pending = combined;
        return this;
      }
      this.block(combined);
      this.pending = new Uint8Array(0);
    }
    while (offset + 64 <= bytes.length) {
      this.block(bytes, offset);
      offset += 64;
    }
    this.pending = Uint8Array.from(bytes.subarray(offset));
    return this;
  }
  digestHex(): string {
    if (this.finalized !== undefined) return this.finalized;
    const tail = new Uint8Array(this.pending.length < 56 ? 64 : 128);
    tail.set(this.pending);
    tail[this.pending.length] = 0x80;
    const bits = this.totalBytes * 8,
      view = new DataView(tail.buffer);
    view.setUint32(tail.length - 8, Math.floor(bits / 2 ** 32), false);
    view.setUint32(tail.length - 4, bits >>> 0, false);
    for (let offset = 0; offset < tail.length; offset += 64) this.block(tail, offset);
    this.finalized = hex(this.words);
    this.pending = new Uint8Array(0);
    return this.finalized;
  }
}
export type SnapshotCheckpointIdentity = { snapshotId: string; manifestSha256: string };
export type SnapshotCheckpointCounters = { nextPage: number; nextOrdinal: number; termCount: number; verifiedBytes: number };
export type SnapshotCheckpoint = {
  version: typeof SNAPSHOT_CHECKPOINT_VERSION;
  identity: SnapshotCheckpointIdentity;
  counters: SnapshotCheckpointCounters;
  state: Sha256State;
  stateDigest: string;
};
function identity(raw: unknown): SnapshotCheckpointIdentity {
  const v = exactObject(raw, ['snapshotId', 'manifestSha256']);
  if (
    typeof v.snapshotId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v.snapshotId) ||
    typeof v.manifestSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.manifestSha256)
  )
    return fail();
  return { snapshotId: v.snapshotId, manifestSha256: v.manifestSha256 };
}
function counters(raw: unknown, state: Sha256State): SnapshotCheckpointCounters {
  const v = exactObject(raw, ['nextPage', 'nextOrdinal', 'termCount', 'verifiedBytes']);
  if (
    !uint(v.nextPage, 20000) ||
    !uint(v.nextOrdinal, 10_000_000) ||
    !uint(v.termCount, 10_000_000) ||
    !uint(v.verifiedBytes, SNAPSHOT_CHECKPOINT_MAX_BYTES) ||
    v.termCount !== v.nextOrdinal ||
    v.verifiedBytes !== state.totalBytes ||
    v.nextPage !== Math.ceil(v.termCount / 500) ||
    v.verifiedBytes < v.termCount ||
    (v.nextPage === 0 && (v.termCount !== 0 || v.verifiedBytes !== 0)) ||
    (v.termCount === 0 && v.verifiedBytes !== 0)
  )
    return fail();
  return { nextPage: v.nextPage, nextOrdinal: v.nextOrdinal, termCount: v.termCount, verifiedBytes: v.verifiedBytes };
}
function stateDigest(core: Omit<SnapshotCheckpoint, 'stateDigest'>) {
  return new SnapshotSha256().update(new TextEncoder().encode(JSON.stringify(core))).digestHex();
}
export function exportSnapshotCheckpoint(
  stream: SnapshotSha256,
  pinned: SnapshotCheckpointIdentity,
  counts: SnapshotCheckpointCounters,
): SnapshotCheckpoint {
  const state = validateState(stream.exportState());
  const core = { version: SNAPSHOT_CHECKPOINT_VERSION, identity: identity(pinned), counters: counters(counts, state), state };
  return { ...core, stateDigest: stateDigest(core) };
}
export function importSnapshotCheckpoint(
  raw: unknown,
  expectedIdentity: SnapshotCheckpointIdentity,
  expectedCounters: SnapshotCheckpointCounters,
) {
  const v = exactObject(raw, ['version', 'identity', 'counters', 'state', 'stateDigest']);
  if (v.version !== SNAPSHOT_CHECKPOINT_VERSION || typeof v.stateDigest !== 'string' || !/^[a-f0-9]{64}$/.test(v.stateDigest))
    return fail();
  const state = validateState(v.state),
    actualIdentity = identity(v.identity),
    actualCounters = counters(v.counters, state);
  const pinned = identity(expectedIdentity),
    expected = counters(expectedCounters, state);
  const core = { version: SNAPSHOT_CHECKPOINT_VERSION, identity: actualIdentity, counters: actualCounters, state };
  if (
    actualIdentity.snapshotId !== pinned.snapshotId ||
    actualIdentity.manifestSha256 !== pinned.manifestSha256 ||
    JSON.stringify(actualCounters) !== JSON.stringify(expected) ||
    stateDigest(core) !== v.stateDigest
  )
    return fail();
  return SnapshotSha256.fromState(state);
}
