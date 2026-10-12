import { describe, expect, it } from 'vitest';
import { FREQUENCY_POLICY, highDocumentFrequency } from './frequency.ts';

describe('long-term document frequency policy', () => {
  it('uses a strict greater-than 2% threshold over all public articles', () => {
    expect(FREQUENCY_POLICY.baselineDays).toBe(365);
    expect(FREQUENCY_POLICY.highFrequencyRatio).toBe(0.02);
    expect(highDocumentFrequency(3, 100)).toBe(true);
    expect(highDocumentFrequency(2, 100)).toBe(false);
    expect(highDocumentFrequency(1, 100)).toBe(false);
    expect(highDocumentFrequency(0, 0)).toBe(false);
  });
  it('versions the threshold and corpus definition for refreshing stored baseline rows', () => {
    expect(FREQUENCY_POLICY.reason).toBe('high-document-frequency-title-only');
    expect(FREQUENCY_POLICY.version).toMatch(/^topic-frequency-v1:[a-f0-9]{64}$/u);
  });
});
