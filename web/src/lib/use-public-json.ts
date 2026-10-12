'use client';

import { useEffect, useState } from 'react';
import { createPublicLoader, type PublicLoad, type PublicParser } from './public-loader';

/**
 * React binding of public-loader.ts for the part of a public page that depends
 * on the URL's query. Rules (same-origin, no cookies, whitelist, contracts,
 * 120 s memory, timeout, latest query wins) live there.
 */
export type { PublicLoad, PublicParser };

/** Shared by every view on the page, so back/forward between queries is instant while fresh. */
const loader = createPublicLoader();

/**
 * `null` path: nothing to read (the page shows its prerendered baseline).
 * `parse` must be stable (module level); each run captures the one it was given.
 */
export function usePublicJson<T>(path: string | null, parse: PublicParser<T>): PublicLoad<T> | null {
  const [settled, setSettled] = useState<{ path: string; load: PublicLoad<T> } | null>(null);
  useEffect(() => {
    if (!path) return;
    const runner = loader.runner<T>((done, load) => setSettled({ path: done, load }));
    runner.run(path, parse);
    return runner.stop;
  }, [path, parse]);
  if (!path) return null;
  if (settled?.path === path) return settled.load;
  // A different query than the last settled one: a fresh answer shows at once, otherwise pending.
  const cached = loader.fresh<T>(path);
  return cached ? { status: 'ready', data: cached.data } : { status: 'pending' };
}

/** For payloads public-contracts.ts has already checked and the view renders as-is. */
export const asIs = <T>(raw: unknown): T => raw as T;
