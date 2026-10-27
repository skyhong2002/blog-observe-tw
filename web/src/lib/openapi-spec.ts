import generated from '../../../data/openapi.json' with { type: 'json' };
import type { Schema } from './openapi-fields.mts';

// The /api/ docs bundle the backend generator's data/openapi.json (repository
// root) at build time: the same document the gateway serves, never a second
// hand-written copy. A static import, so the bundle always contains it and no
// runtime working directory matters.

export interface Param {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  description?: string;
  required?: boolean;
  schema?: Schema;
  example?: unknown;
}
export interface Operation {
  operationId?: string;
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Param[];
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: Schema }> }>;
  'x-example'?: string;
}
export interface Quickstart {
  label: string;
  lang?: string;
  code: string;
}
export type PathItem = { parameters?: Param[] } & Partial<
  Record<'get' | 'put' | 'post' | 'delete' | 'patch' | 'head' | 'options', Operation>
>;
export interface OpenApi {
  info: { title: string; summary?: string; description?: string; 'x-quickstart'?: Quickstart[] };
  servers?: Array<{ url: string }>;
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, PathItem>;
  components?: { schemas?: Record<string, Schema> };
}

export const SITE_ORIGIN = 'https://weblog.tw';
export const GITHUB_DOC = 'https://github.com/skyhong2002/blog-observe-tw/blob/main/docs/api.md';
const METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options']);

let cached: OpenApi | null = null;

/** Throws when the generated spec is malformed; a missing file already fails the build at the import. */
export function loadSpec(): OpenApi {
  cached ??= parseSpec(generated);
  return cached;
}

export function parseSpec(value: unknown): OpenApi {
  const spec = value as OpenApi;
  if (!spec || typeof spec !== 'object' || typeof spec.info?.title !== 'string' || !spec.paths || typeof spec.paths !== 'object')
    throw new Error('data/openapi.json is not an OpenAPI document with info.title and paths');
  return spec;
}

export interface OperationEntry {
  path: string;
  method: string;
  op: Operation;
  /** A HEAD twin of this GET exists and is documented here rather than separately. */
  head?: boolean;
}

/** Every operation in document order, with path-level parameters folded in and
 *  each HEAD folded into its path's GET (same parameters and headers, no body). */
export function operations(spec: OpenApi): OperationEntry[] {
  return Object.entries(spec.paths).flatMap(([p, item]) => {
    const shared = (item.parameters ?? []).filter(Boolean);
    return Object.entries(item)
      .filter((pair): pair is [string, Operation] => METHODS.has(pair[0]) && !!pair[1])
      .filter(([method]) => !(method === 'head' && item.get))
      .map(([method, op]) => {
        const own = op.parameters ?? [];
        const parameters = [...shared.filter((s) => !own.some((o) => o.name === s.name && o.in === s.in)), ...own];
        return { path: fullPath(spec, p), method: method.toUpperCase(), op: { ...op, parameters }, head: method === 'get' && !!item.head };
      });
  });
}

/** Paths in the document may be relative to the first server URL (`/api/v1`). */
export function fullPath(spec: OpenApi, p: string): string {
  if (p.startsWith('/api/')) return p;
  const server = spec.servers?.[0]?.url ?? '';
  const base = server.startsWith('/') ? server : server ? new URL(server).pathname : '';
  return `${base.replace(/\/+$/, '')}${p}`;
}

const sample = (p: Param): unknown => p.example ?? p.schema?.example ?? p.schema?.default ?? p.schema?.enum?.[0];

/**
 * A request example derived from the spec: path parameters filled with their
 * documented example (or default / first enum value), required query
 * parameters and any query parameter with an explicit example appended.
 * Null when a path parameter has no example to fill it with.
 */
export function exampleUrl({ path: p, op }: OperationEntry): string | null {
  if (op['x-example']) return op['x-example'];
  const params = op.parameters ?? [];
  let unresolved = false;
  const filled = p.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = sample(params.find((x) => x.in === 'path' && x.name === name) ?? { name, in: 'path' });
    if (value === undefined || value === null) {
      unresolved = true;
      return `{${name}}`;
    }
    return encodeURIComponent(String(value));
  });
  if (unresolved) return null;
  const query = new URLSearchParams();
  for (const q of params) {
    if (q.in !== 'query') continue;
    const value = q.example ?? q.schema?.example ?? (q.required ? sample(q) : undefined);
    if (value !== undefined && value !== null) query.set(q.name, String(value));
  }
  const qs = query.toString();
  return qs ? `${filled}?${qs}` : filled;
}

/** Anchor ids such as `api-v1-blogs-slug-get`. */
export const anchor = (p: string) =>
  p
    .replace(/^\/api\/v1\/?/, 'api-v1-')
    .replace(/[{}]/g, '')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/-+$/, '');
export const endpointAnchor = (method: string, p: string) => `${anchor(p)}-${method.toLowerCase()}`;
