import { describe, expect, it, vi } from 'vitest';
import type { DetectorInput } from './contracts.ts';
import { detectTechnology, validTechObservation } from './detector.ts';

// Deliberately synthetic: these bytes are not captures of Alina, Carol, or timdream.
const base = { url: 'https://synthetic.example/', observedAt: new Date('2026-01-02T03:04:05.006Z') };
const cases: { name: string; input: DetectorInput; status: string }[] = [
  { name: 'explicit generator', input: { ...base, html: '<meta name="generator" content="WordPress 6.8">' }, status: 'detected' },
  { name: 'successful unrecognized HTML', input: { ...base, html: '<html><p>My diary</p></html>', httpStatus: 200 }, status: 'unknown' },
  { name: 'recorded timeout', input: { ...base, failureReason: 'timeout' }, status: 'failed' },
  { name: 'recorded HTTP refusal', input: { ...base, httpStatus: 403 }, status: 'blocked' },
];

describe('synthetic offline evidence, not real-site acceptance', () => {
  it.each(cases)('$name has the evidenced status $status without network access', ({ input, status }) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('offline_network_forbidden');
    });
    try {
      const result = detectTechnology(input);
      expect(result.status).toBe(status);
      expect(validTechObservation(result)).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
      if (status === 'failed' || status === 'blocked') {
        expect(result.observedAt).toBeNull();
        expect(result.detections).toEqual([]);
      }
    } finally {
      fetch.mockRestore();
    }
  });
  it('separates explicit CMS evidence from low-confidence hosting and CDN hints', () => {
    const result = detectTechnology({
      ...base,
      html: '<meta name="generator" content="Blogger">',
      headers: { server: 'cloudflare', 'x-vercel-id': 'synthetic-id', 'x-nf-request-id': 'synthetic-request' },
    });
    expect(result.detections.find((d) => d.id === 'blogger')).toMatchObject({ category: 'cms', confidence: 0.95, version: 'unknown' });
    expect(result.detections.find((d) => d.id === 'cloudflare')).toMatchObject({ category: 'cdn', confidence: 0.3, version: 'unknown' });
    for (const id of ['vercel', 'netlify'])
      expect(result.detections.find((d) => d.id === id)).toMatchObject({ category: 'hosting', confidence: 0.3, version: 'unknown' });
    expect(JSON.stringify(result)).not.toMatch(/synthetic-id|synthetic-request/);
  });
  it('never upgrades an asset query or header version to a CMS version', () => {
    const result = detectTechnology({
      ...base,
      html: '<link href="/wp-content/themes/astra/style.css?ver=7.1.3">',
      headers: { server: 'WordPress/7.1.3' },
    });
    expect(result.detections.length).toBeGreaterThan(0);
    expect(result.detections.every((d) => d.version === 'unknown')).toBe(true);
    const explicit = detectTechnology({ ...base, html: '<meta name="generator" content="WordPress 7.1.3">' });
    expect(explicit.detections[0]).toMatchObject({ version: '7.1.3', evidence: [{ kind: 'generator', value: 'WordPress 7.1.3' }] });
  });
});
