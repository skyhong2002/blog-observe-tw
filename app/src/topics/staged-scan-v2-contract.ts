import {
  advancePublicationScan,
  type FreshArticleFact,
  type PublicationContinuation,
  type PublicationPins,
  parsePublicationContinuation,
} from './snapshot-publication-contract.ts';
export type ScanV2Pins = Omit<PublicationPins, 'expectedCurrent'>;
export type ScanV2State = Omit<PublicationContinuation, 'expectedCurrent' | 'version'> & { version: 'scan-v2'; titleOnly: number };
export function parseScanV2(raw: unknown): ScanV2State {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('scan-invalid');
  const ds = Object.getOwnPropertyDescriptors(raw);
  if ('expectedCurrent' in ds) throw Error('scan-invalid');
  if (Reflect.ownKeys(raw).some((k) => typeof k !== 'string' || !('value' in ds[k]))) throw Error('scan-invalid');
  const { version, titleOnly, ...rest } = Object.fromEntries(Object.entries(ds).map(([k, d]) => [k, d.value]));
  if (version !== 'scan-v2' || !Number.isSafeInteger(titleOnly) || titleOnly < 0) throw Error('scan-invalid');
  const v1 = parsePublicationContinuation({ ...rest, version: 'staged-scan-v1', expectedCurrent: null });
  if (titleOnly > v1.eligible) throw Error('scan-invalid');
  const { expectedCurrent: _, version: __, ...state } = v1;
  return { ...state, version: 'scan-v2', titleOnly };
}
export function startScanV2(pins: ScanV2Pins, highWater: number, asOf: string): ScanV2State {
  return parseScanV2({
    ...pins,
    version: 'scan-v2',
    canVerify: false,
    state: highWater === 0 ? 'scanned-as-of' : 'scanning',
    highWater,
    asOf,
    cursor: 0,
    epoch: 0,
    checked: 0,
    eligible: 0,
    zeroHit: 0,
    skipped: 0,
    capped: 0,
    unresolved: 0,
    titleOnly: 0,
  });
}
export function advanceScanV2(
  raw: unknown,
  expectedCursor: number,
  fact: FreshArticleFact | undefined,
  exhausted: boolean,
  titleOnly = false,
): ScanV2State {
  const old = parseScanV2(raw);
  const { version: _, titleOnly: __, ...base } = old;
  const next = advancePublicationScan(
    { ...base, version: 'staged-scan-v1', expectedCurrent: null },
    { expectedCursor, observedCurrent: null, epoch: old.epoch, facts: fact ? [fact] : [], exhausted },
  );
  if ('status' in next) throw Error('scan-conflict');
  const { expectedCurrent: ___, version: ____, ...state } = next;
  return parseScanV2({ ...state, version: 'scan-v2', titleOnly: old.titleOnly + (titleOnly && next.eligible > old.eligible ? 1 : 0) });
}
