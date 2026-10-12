/** Public v1 contract. Public reads only; API keys never authenticate reader/admin sessions. */
export const PUBLIC_PATHS = [
  '/api/v1/articles',
  '/api/v1/blogs',
  '/api/v1/blogs/:slug',
  '/api/v1/blogs/:slug/articles',
  '/api/v1/relations',
  '/api/v1/blogs/:slug/relations',
  '/api/v1/topics',
  '/api/v1/topics/:id',
  '/api/v1/openapi.json',
] as const;
export const API_CACHE = 'no-store';
export const API_LIMITS = { anonymous: 60, key: 1000, activeKeys: 3, defaultLimit: 50, maxLimit: 200 } as const;
export const API_ERRORS = [
  'invalid_query',
  'invalid_cursor',
  'not_found',
  'invalid_api_key',
  'rate_limit_exceeded',
  'unavailable',
] as const;
