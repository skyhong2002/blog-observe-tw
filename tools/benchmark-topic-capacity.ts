/** Offline capacity gate. Run in an isolated process: node --expose-gc --max-old-space-size=256 tools/benchmark-topic-capacity.ts */
import assert from 'node:assert/strict';
import { admitActiveTerm, startActiveSelection } from '../app/src/topics/active-set.ts';
import { TopicMatcher } from '../app/src/topics/matcher.ts';
import { ACTIVE_TOPIC_LIMITS, digest } from '../app/src/topics/policy.ts';

if (!globalThis.gc) throw Error('Run with --expose-gc');
const anchor = new Date('2026-10-12T00:00:00.000Z');
for (const shape of ['wide-prefix', 'shared-prefix', 'long'] as const) {
  const selection = startActiveSelection('benchmark', anchor);
  const terms: { id: string; label: string }[] = [];
  let inactive = 0;
  for (let i = 0; i < 300_000; i++) {
    const key = String.fromCodePoint(0x4e00 + (i % 18000)) + String.fromCodePoint(0x4e00 + Math.floor(i / 18000));
    const label = shape === 'wide-prefix' ? key + '詞' : shape === 'shared-prefix' ? '共同前綴觀測詞' + key : '長'.repeat(120) + key;
    const id = digest(label);
    const reason = admitActiveTerm(
      selection,
      { id, label, normalizedLabel: label, articleCount: 3, lastPublishedAt: anchor, exclusionReason: null },
      anchor,
    );
    if (reason) inactive++;
    else terms.push({ id, label });
  }
  globalThis.gc();
  const before = process.memoryUsage().heapUsed;
  const start = performance.now();
  const matcher = new TopicMatcher(terms);
  const constructedHeapDelta = Math.max(0, process.memoryUsage().heapUsed - before);
  globalThis.gc();
  const retainedHeapDelta = Math.max(0, process.memoryUsage().heapUsed - before);
  assert(retainedHeapDelta <= selection.estimatedBytes, 'retained trie heap exceeds conservative estimate');
  assert(constructedHeapDelta <= selection.estimatedBytes, 'construction heap exceeds conservative estimate');
  assert(selection.estimatedBytes <= ACTIVE_TOPIC_LIMITS.maxEstimatedBytes);
  for (let i = 0; i < 200; i++) matcher.match(('正文' + terms[i % terms.length].label + '。').repeat(100));
  console.log(
    JSON.stringify({
      shape,
      rawTerms: 300000,
      activeTerms: terms.length,
      inactive,
      codePoints: selection.codePoints,
      estimatedMiB: selection.estimatedBytes / 1048576,
      retainedHeapMiB: retainedHeapDelta / 1048576,
      constructionHeapMiB: constructedHeapDelta / 1048576,
      processMaxRssMiB: process.resourceUsage().maxRSS / 1024,
      buildAnd200DocumentsMs: Math.round(performance.now() - start),
      passed: true,
    }),
  );
}
