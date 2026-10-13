import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { afterEach, expect, it, vi } from 'vitest';
import { loadTextSimilarity } from './text-similarity-reader.ts';
import { registerTextSimilarityRoute } from './text-similarity-routes.ts';

vi.mock('./text-similarity-reader.ts', () => ({ loadTextSimilarity: vi.fn() }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(loadTextSimilarity).mockReset();
});
it('flag off does not read a selected article and returns no-store 404', async () => {
  vi.stubEnv('BLOG_TEXT_SIMILARITY_ENABLED', 'false');
  const app = Fastify();
  registerTextSimilarityRoute(app, {} as Pool);
  try {
    const response = await app.inject('/api/relations/text-similarity?source=1&target=2');
    expect(response.statusCode).toBe(404);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(loadTextSimilarity).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
it('only accepts one explicit nonself pair, with distinct missing and database-failure states', async () => {
  vi.stubEnv('BLOG_TEXT_SIMILARITY_ENABLED', 'true');
  const app = Fastify();
  registerTextSimilarityRoute(app, {} as Pool);
  try {
    for (const query of ['source=1&target=1', 'source=0&target=2', 'source=1%20&target=2', 'source=1&source=2&target=3'])
      expect((await app.inject(`/api/relations/text-similarity?${query}`)).statusCode).toBe(400);
    expect(loadTextSimilarity).not.toHaveBeenCalled();
    vi.mocked(loadTextSimilarity).mockResolvedValueOnce({ status: 'ready', items: [{ status: 'unavailable' }] } as never);
    const unavailable = await app.inject('/api/relations/text-similarity?source=1&target=2');
    expect(unavailable.statusCode).toBe(404);
    expect(unavailable.headers['cache-control']).toBe('no-store');
    vi.mocked(loadTextSimilarity).mockRejectedValueOnce(Error('private_database_error'));
    const failure = await app.inject('/api/relations/text-similarity?source=1&target=2');
    expect(failure.statusCode).toBe(503);
    expect(failure.json()).toEqual({ error: 'text_similarity_unavailable' });
  } finally {
    await app.close();
  }
});
