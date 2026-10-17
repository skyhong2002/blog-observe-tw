import { defineConfig } from 'vitest/config';
// Production crawls do not obey robots.txt (crawl/feed.ts obeyRobots); the suite keeps exercising the obeying mode,
// and the default is tested with an explicit `obeyRobots: false`.
export default defineConfig({
  test: { environment: 'node', include: ['app/test/**/*.spec.ts', 'app/src/**/*.spec.ts'], env: { BLOG_CRAWL_OBEY_ROBOTS: 'true' } },
});
