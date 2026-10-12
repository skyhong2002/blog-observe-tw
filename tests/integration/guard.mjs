import assert from 'node:assert/strict';
/** Suites may mutate fixtures only in the runner's disposable local database. */
export function assertEphemeralDatabase(pool) {
  const config = pool?.pool?.config?.connectionConfig;
  assert.equal(config?.host, '127.0.0.1', 'integration database must use loopback');
  assert.equal(config?.port, 18169, 'integration database must use isolated port 18169');
  assert.match(config?.database || '', /^blog_observe_integration_[a-f0-9]{24}$/, 'use the disposable integration runner');
}
