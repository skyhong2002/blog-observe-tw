import { afterEach, describe, expect, it } from 'vitest';
import { crawlIntervalHours, postingIntervalHours } from './posting-interval.js';

const day = (n: number) => new Date(Date.UTC(2026, 9, 16) - n * 86_400_000);
describe('blog cadence shown on its page', () => {
  it('is the median gap between the latest posts, newest first; too few posts say nothing', () => {
    // A daily writer with one long break still reads as daily.
    expect(postingIntervalHours([day(0), day(1), day(2), day(3), day(30)])).toBe(24);
    expect(postingIntervalHours([day(0), day(7), day(14)])).toBe(168);
    expect(postingIntervalHours([day(0), day(2)])).toBeNull();
    expect(postingIntervalHours([day(0), 'not a date', day(1), day(2)])).toBe(24);
    // Several posts the same hour never read as 0 hours.
    expect(postingIntervalHours([day(0), day(0), day(0)])).toBe(1);
  });
  const saved = process.env.BLOG_CRAWL_INTERVAL_MS;
  afterEach(() => {
    if (saved === undefined) delete process.env.BLOG_CRAWL_INTERVAL_MS;
    else process.env.BLOG_CRAWL_INTERVAL_MS = saved;
  });
  it("reports the worker's RSS round, as worker.ts computes it", () => {
    delete process.env.BLOG_CRAWL_INTERVAL_MS;
    expect(crawlIntervalHours()).toBe(6);
    process.env.BLOG_CRAWL_INTERVAL_MS = '60000';
    expect(crawlIntervalHours()).toBe(0.5);
  });
});
