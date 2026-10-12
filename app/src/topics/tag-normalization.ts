export const TAG_NORMALIZATION = 'boundary-whitespace-format-skip-invalid-v2';
export type InvalidTagEvidence = { index: number; reason: 'type' | 'too-long' | 'empty' | 'control' | 'count-cap'; preview?: string };
/** Preserve a bounded source excerpt, never turn one malformed label into a failed article window. */
export function normalizeSourceTags(values: unknown[]) {
  const tags: string[] = [];
  const rawTags: string[] = [];
  const invalidTagSamples: InvalidTagEvidence[] = [];
  let invalidTagCount = Math.max(0, values.length - 500);
  let normalizedTagCount = 0;
  if (values.length > 500) invalidTagSamples.push({ index: 500, reason: 'count-cap' });
  for (let index = 0; index < Math.min(500, values.length); index++) {
    const value = values[index];
    let reason: InvalidTagEvidence['reason'] | null = null;
    let normalized = '';
    if (typeof value !== 'string') reason = 'type';
    else if (value.length > 240) reason = 'too-long';
    else {
      normalized = value.replace(/^[\s\p{Cf}]+|[\s\p{Cf}]+$/gu, '');
      if (!normalized) reason = 'empty';
      else if (/[\p{Cc}\p{Cf}\uD800-\uDFFF]/u.test(normalized)) reason = 'control';
    }
    if (reason) {
      invalidTagCount++;
      if (invalidTagSamples.length < 8)
        invalidTagSamples.push({ index, reason, ...(typeof value === 'string' ? { preview: value.slice(0, 80) } : {}) });
      continue;
    }
    tags.push(normalized);
    rawTags.push(value as string);
    if (normalized !== value) normalizedTagCount++;
  }
  return {
    tags,
    ...(normalizedTagCount ? { rawTags } : {}),
    invalidTagCount,
    normalizedTagCount,
    invalidTagSamples,
    tagNormalization: TAG_NORMALIZATION,
  };
}
