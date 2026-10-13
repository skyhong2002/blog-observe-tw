import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  exportSnapshotCheckpoint,
  importSnapshotCheckpoint,
  SNAPSHOT_CHECKPOINT_MAX_BYTES,
  SnapshotSha256,
} from './snapshot-checkpoint.ts';

const oracle = (input: Uint8Array | string) => createHash('sha256').update(input).digest('hex');
const id = { snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', manifestSha256: 'b'.repeat(64) };
const counts = (bytes: number) => ({ nextPage: bytes ? 1 : 0, nextOrdinal: bytes ? 1 : 0, termCount: bytes ? 1 : 0, verifiedBytes: bytes });
const encode = (s: string) => new TextEncoder().encode(s);
const checkpoint = (input = 'a'.repeat(65)) =>
  exportSnapshotCheckpoint(new SnapshotSha256().update(encode(input)), id, counts(encode(input).length));
describe('portable exact SHA256 checkpoint', () => {
  it.each(['', 'abc', 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', 'a'.repeat(1000000)])(
    'matches standard vectors (%s)',
    (text) => {
      expect(new SnapshotSha256().update(encode(text)).digestHex()).toBe(oracle(text));
    },
  );
  it('matches every padding/64byte boundary across chunking and serialized resume', () => {
    for (let length = 0; length <= 257; length++) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 19) % 256);
      for (const cut of [...new Set([0, Math.floor(length / 2), length])]) {
        const start = new SnapshotSha256().update(bytes.subarray(0, cut));
        const raw = JSON.parse(JSON.stringify(exportSnapshotCheckpoint(start, id, counts(cut))));
        const stream = importSnapshotCheckpoint(raw, id, counts(cut));
        for (let n = cut; n < length; n += 7) stream.update(bytes.subarray(n, n + 7));
        expect(stream.digestHex()).toBe(oracle(bytes));
      }
    }
  });
  it('matches deterministic randomized UTF8 streams without normalizing or stripping BOM', () => {
    let random = 173;
    const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
    const alphabet = ['蛤蜊絲瓜', 'e\u0301', 'Ａ', '\uFEFF', '🌳', '\n', '\u0000', 'straße'];
    for (let trial = 0; trial < 80; trial++) {
      const text = Array.from({ length: 20 + (next() % 200) }, () => alphabet[next() % alphabet.length]).join('');
      const bytes = encode(text),
        stream = new SnapshotSha256();
      for (let offset = 0; offset < bytes.length; ) {
        const n = 1 + (next() % 97);
        stream.update(bytes.subarray(offset, offset + n));
        offset += n;
      }
      expect(stream.digestHex()).toBe(oracle(bytes));
    }
  });
  it('resumes the serialized state in another Node process with no live hash instance', () => {
    const prefix = '蛤蜊絲瓜\n'.repeat(31),
      suffix = '\uFEFFtail🌳\n';
    const raw = checkpoint(prefix);
    const module = new URL('./snapshot-checkpoint.ts', import.meta.url).href;
    const script = `import {readFileSync} from 'node:fs'; import {importSnapshotCheckpoint} from ${JSON.stringify(module)}; const p=JSON.parse(readFileSync(0,'utf8')); const s=importSnapshotCheckpoint(p.raw,p.id,p.counts); console.log(s.update(new TextEncoder().encode(p.suffix)).digestHex());`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      input: JSON.stringify({ raw, id, counts: counts(encode(prefix).length), suffix }),
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout.trim()).toBe(oracle(prefix + suffix));
    expect(fileURLToPath(module)).toContain('snapshot-checkpoint.ts');
  });
  it('copies caller inputs and exports; digest finalizes only its own stream', () => {
    const input = Buffer.from('abcdef'),
      stream = new SnapshotSha256().update(input);
    input.fill(0);
    const state = stream.exportState();
    state.pending.fill(0);
    state.words.fill(0);
    expect(stream.digestHex()).toBe(oracle('abcdef'));
    expect(stream.digestHex()).toBe(oracle('abcdef'));
    expect(() => stream.update(encode('x'))).toThrow('finalized');
    expect(() => stream.exportState()).toThrow('finalized');
  });
  it('rejects invalid binary state and overflow before allocating or updating', () => {
    const good = checkpoint().state;
    for (const state of [
      { ...good, words: good.words.slice(1) },
      { ...good, words: [...good.words.slice(0, 7), 2 ** 32] },
      { ...good, pending: [256] },
      { ...good, pending: Array(64).fill(0) },
      { ...good, pending: Array(1) },
      { ...good, totalBytes: 64 },
      { ...good, totalBytes: -0 },
      { ...good, totalBytes: NaN },
      { ...good, totalBytes: SNAPSHOT_CHECKPOINT_MAX_BYTES + 1 },
      { ...good, extra: true },
      { words: Array(8).fill(0), pending: [], totalBytes: 0 },
    ])
      expect(() => SnapshotSha256.fromState(state)).toThrow();
    const full = SnapshotSha256.fromState({ words: good.words, pending: [], totalBytes: SNAPSHOT_CHECKPOINT_MAX_BYTES });
    expect(() => full.update(new Uint8Array(1))).toThrow('byte_cap');
    expect(full.exportState().totalBytes).toBe(SNAPSHOT_CHECKPOINT_MAX_BYTES);
    expect(() => new SnapshotSha256().update('x' as never)).toThrow();
  });
  it('rejects tampering, wrong identity/version/counters and unknown keys without consuming getters', () => {
    const raw = checkpoint();
    const mutate = (fn: (v: typeof raw) => void) => {
      const value = structuredClone(raw);
      fn(value);
      return value;
    };
    for (const value of [
      mutate((v) => {
        v.version = 'unknown' as never;
      }),
      mutate((v) => {
        v.state.words[0] ^= 1;
      }),
      mutate((v) => {
        v.state.pending[0] ^= 1;
      }),
      mutate((v) => {
        v.stateDigest = 'c'.repeat(64);
      }),
      mutate((v) => {
        v.counters.nextPage = 2;
      }),
      mutate((v) => {
        v.counters.termCount = 2;
      }),
      mutate((v) => {
        v.counters.verifiedBytes++;
      }),
      { ...raw, extra: true },
    ])
      expect(() => importSnapshotCheckpoint(value, id, counts(65))).toThrow();
    expect(() => importSnapshotCheckpoint(raw, { ...id, manifestSha256: 'c'.repeat(64) }, counts(65))).toThrow();
    expect(() => importSnapshotCheckpoint(raw, { ...id, snapshotId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, counts(65))).toThrow();
    expect(() => importSnapshotCheckpoint(raw, id, { ...counts(65), verifiedBytes: 66 })).toThrow();
    let invoked = false;
    const getter = { ...raw };
    Object.defineProperty(getter, 'state', {
      enumerable: true,
      get() {
        invoked = true;
        return raw.state;
      },
    });
    expect(() => importSnapshotCheckpoint(getter, id, counts(65))).toThrow();
    expect(invoked).toBe(false);
  });
  it('state digest binds page/ordinal and manifest metadata, not only binary words', () => {
    const stream = new SnapshotSha256().update(encode('a'.repeat(501)));
    const first = exportSnapshotCheckpoint(stream, id, { nextPage: 1, nextOrdinal: 1, termCount: 1, verifiedBytes: 501 });
    const second = exportSnapshotCheckpoint(stream, id, { nextPage: 1, nextOrdinal: 2, termCount: 2, verifiedBytes: 501 });
    expect(first.stateDigest).not.toBe(second.stateDigest);
    expect(() => importSnapshotCheckpoint(second, id, first.counters)).toThrow();
    for (const count of [
      { ...first.counters, nextPage: 20001 },
      { ...first.counters, nextOrdinal: 10000001 },
      { ...first.counters, termCount: -1 },
      { ...first.counters, nextPage: 0 },
      { ...first.counters, verifiedBytes: Number.MAX_SAFE_INTEGER },
    ])
      expect(() => exportSnapshotCheckpoint(stream, id, count)).toThrow();
  });
});
