/** Test-only immutable Next preload: propagate a synthetic request correlation ID to the isolated gateway.
 * It never changes content, caching, SQL predicates, response headers, or credentials.
 */
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Server } from 'node:http';

assert.equal(process.env.B0_BARRIER_CONTEXT, 'true', 'explicit isolated instrumentation flag required');
assert.equal(process.env.PORT, '18177', 'only isolated Next port permitted');
assert.equal(process.env.BLOG_GATEWAY_INTERNAL_URL, 'http://127.0.0.1:18176', 'only isolated gateway permitted');
const database = new URL(process.env.BLOG_DB_URL);
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '18169');
assert.match(database.pathname, /^\/blog_observe_integration_[a-f0-9]{24}$/);
const context = new AsyncLocalStorage(),
  originalEmit = Server.prototype.emit,
  originalFetch = globalThis.fetch;
Server.prototype.emit = function (name, ...args) {
  if (name !== 'request') return originalEmit.call(this, name, ...args);
  const header = args[0]?.headers?.['x-b0-correlation'];
  const token = typeof header === 'string' && /^b0-\d+-(?:A|B)$/.test(header) ? header : null;
  return context.run(token, () => originalEmit.call(this, name, ...args));
};
globalThis.fetch = (input, init) => {
  const token = context.getStore();
  let url;
  try {
    url = new URL(input instanceof Request ? input.url : String(input));
  } catch {
    return originalFetch(input, init);
  }
  if (!token || url.origin !== 'http://127.0.0.1:18176' || !url.pathname.startsWith('/api/')) return originalFetch(input, init);
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  for (const [name, value] of new Headers(init?.headers)) headers.set(name, value);
  headers.set('x-b0-correlation', token);
  return originalFetch(input, { ...init, headers });
};
