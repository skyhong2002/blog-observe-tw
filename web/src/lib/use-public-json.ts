'use client';

import { useEffect, useState } from 'react';
import { createPublicLoader, type PublicLoad, type PublicParser } from './public-loader';
import { usePublicRefreshEpoch } from './use-public-refresh';

/**
 * React binding of public-loader.ts for the part of a public page that depends
 * on the URL's query. Rules (same-origin, no cookies, whitelist, contracts,
 * no-store and nothing remembered, timeout, latest query wins) live there.
 * The query is read again when public-refresh.ts says the page was kept
 * around (tab visible again, bfcache restore, back/forward); until that answer
 * arrives the view keeps what it shows.
 */
export type { PublicLoad, PublicParser };

const loader = createPublicLoader();

/**
 * `null` path: nothing to read (the page shows its server-rendered baseline).
 * `parse` must be stable (module level); each run captures the one it was given.
 */
export function usePublicJson<T>(path: string | null, parse: PublicParser<T>): PublicLoad<T> | null {
  const [settled, setSettled] = useState<{ path: string; load: PublicLoad<T> } | null>(null);
  const epoch = usePublicRefreshEpoch();
  useEffect(() => {
    if (!path) return;
    const runner = loader.runner<T>((done, load) => setSettled({ path: done, load }));
    runner.run(path, parse);
    return runner.stop;
  }, [path, parse, epoch]);
  if (!path) return null;
  // A different query than the last settled one is pending until its own answer arrives.
  return settled?.path === path ? settled.load : { status: 'pending' };
}

/** For payloads public-contracts.ts has already checked and the view renders as-is. */
export const asIs = <T>(raw: unknown): T => raw as T;
