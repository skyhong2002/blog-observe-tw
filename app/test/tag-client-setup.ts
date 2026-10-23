import { beforeEach } from 'vitest';

// Specs that need tags install their own fakeTagClient; everything else sees traffic.observe.tw as unavailable.
// Imported lazily, after each spec's vi.mock calls (similarweb.spec.ts mocks node:os under the token reader).
beforeEach(async () => {
  const [{ forgetTagSnapshot }, { setTagClient }, { offlineTagClient }] = await Promise.all([
    import('../src/blog-genres/store.ts'),
    import('../src/blog-genres/traffic.ts'),
    import('./tag-client.ts'),
  ]);
  setTagClient(offlineTagClient);
  forgetTagSnapshot();
});
