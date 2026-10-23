import { defineConfig } from 'vitest/config';
// Production crawls do not obey robots.txt (crawl/feed.ts obeyRobots); the suite keeps exercising the obeying mode,
// and the default is tested with an explicit `obeyRobots: false`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['app/test/**/*.spec.ts', 'app/src/**/*.spec.ts'],
    // traffic.observe.tw's tag service is replaced in every spec (app/test/tag-client.ts).
    setupFiles: ['app/test/tag-client-setup.ts'],
    env: { BLOG_CRAWL_OBEY_ROBOTS: 'true' },
  },
});
