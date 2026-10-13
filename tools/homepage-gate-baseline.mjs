// Explicit user-approved baseline. Whole HTML response, not TTFB or browser load.
export const HOMEPAGE_BASELINE = Object.freeze({
  startedAt: '2026-10-13T05:47:30Z',
  endedAt: '2026-10-13T05:48:30Z',
  receipt: '/tmp/babysit/gate-baseline-receipt.md',
  method: 'curl DNT:1 Accept:text/html; 5 samples/site, 3s interval, median time_total; no cookies or cache-busting; HTML only, no JS/GA',
  interpretation: 'Public URL end-to-end HTML response includes origin rendering, Cloudflare edge and network; not an isolated measurement of origin rendering time.',
  formula: 'max(2 seconds, 2 * median whole-response seconds)',
  mediansSeconds: Object.freeze({ 'blog.observe.tw': 3.085, 'tag.observe.tw': 0.256, 'youtube.observe.tw': 0.289 }),
  cacheAtBaseline: Object.freeze({ 'blog.observe.tw': 'DYNAMIC/no-store', 'tag.observe.tw': 'HIT', 'youtube.observe.tw': 'HIT/EXPIRED' }),
});
export const HOMEPAGE_LIMIT_SECONDS = Object.freeze(Object.fromEntries(
  Object.entries(HOMEPAGE_BASELINE.mediansSeconds).map(([host, seconds]) => [host, Math.max(2, 2 * seconds)]),
));
