import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import bundled from '../../data/favicon-local.json' with { type: 'json' };

export type IconManifest = Record<string, IconRecord>;
type IconRecord = { revision?: string; dark?: 'invert' | 'outline' };
const repositoryRoot = new URL('../../../', import.meta.url).pathname;
const runtimeRoot = process.env.BLOG_FAVICON_ROOT;
export function publicIconManifest(data: unknown): Record<string, IconRecord> {
  const safe: Record<string, IconRecord> = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return safe;
  for (const [id, value] of Object.entries(data)) {
    const row = value as IconRecord;
    if (/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(id) && typeof row?.revision === 'string' && /^[a-f0-9]{8,64}$/.test(row.revision))
      safe[id] = { revision: row.revision, ...(row.dark === 'invert' || row.dark === 'outline' ? { dark: row.dark } : {}) };
  }
  return safe;
}
let snapshot: Record<string, IconRecord> = publicIconManifest(bundled);
let expires = 0;
export async function iconManifest(): Promise<Record<string, IconRecord>> {
  if (!runtimeRoot || Date.now() < expires) return snapshot;
  const safe: Record<string, IconRecord> = {};
  try {
    const data = JSON.parse(await readFile(join(runtimeRoot, 'app/data/favicon-local.json'), 'utf8'));
    Object.assign(safe, publicIconManifest(data));
  } catch {
    /* Keep the last projected snapshot during an unavailable refresh. */
    return snapshot;
  }
  snapshot = safe;
  expires = Date.now() + 5000;
  return snapshot;
}

export function registerFavicons(app: FastifyInstance) {
  app.get('/api/icons', async (_request, reply) => reply.header('cache-control', 'public, max-age=60').send(await iconManifest()));
  app.get<{ Params: { file: string } }>('/favicons/:file', async (request, reply) => {
    const file = request.params.file;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}\.png$/.test(file)) return reply.code(404).send();
    for (const root of runtimeRoot ? [runtimeRoot] : [repositoryRoot]) {
      try {
        const body = await readFile(resolve(root, 'web/public/favicons', file));
        if (body.length > 1024 * 1024 || !body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) continue;
        const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
        reply.header('etag', etag).header('cache-control', 'public, max-age=300').header('x-content-type-options', 'nosniff');
        if (request.headers['if-none-match'] === etag) return reply.code(304).send();
        return reply.type('image/png').send(body);
      } catch {
        /* Fall through to bundled image, then the frontend's initial. */
      }
    }
    return reply.code(404).header('cache-control', 'public, max-age=60').send();
  });
}
