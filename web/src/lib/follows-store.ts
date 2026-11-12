import { useSyncExternalStore } from 'react';
import type { Follow } from './api';

/**
 * The signed-in reader's follows (/api/me/follows), read once for every component mounted at the same time
 * (FollowButton, ReaderList) instead of once each. Personal data, so it is never kept past the components that
 * show it: when the last one unmounts the in-flight read is aborted and the answer dropped, and the next mount
 * (another page, the same page after back/forward, another account after signing in) reads it again. Nothing is
 * written to browser storage, and the server render always sees `loading` (no reader data in shared HTML).
 */
export type FollowsState = { status: 'loading' } | { status: 'login' } | { status: 'error' } | { status: 'ready'; follows: Follow[] };

const LOADING: FollowsState = { status: 'loading' };
let state: FollowsState = LOADING;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function publish(next: FollowsState) {
  state = next;
  for (const listener of listeners) listener();
}

function load(fetcher: typeof fetch) {
  const current = new AbortController();
  controller = current;
  fetcher('/api/me/follows', { credentials: 'same-origin', cache: 'no-store', signal: current.signal })
    .then(async (response) => {
      if (response.status === 401) return { status: 'login' } as const;
      if (!response.ok) throw new Error('Unable to load follows');
      const data = (await response.json()) as { follows?: unknown };
      if (!Array.isArray(data.follows)) throw new Error('Unexpected follows payload');
      return { status: 'ready', follows: data.follows as Follow[] } as const;
    })
    .catch(() => ({ status: 'error' }) as const)
    .then((next) => {
      // A read aborted because every reader unmounted (or replaced by a newer one) publishes nothing.
      if (controller !== current || current.signal.aborted) return;
      controller = null;
      publish(next);
    });
}

/** Exported for tests; components use useFollows(). */
export function subscribeFollows(listener: () => void, fetcher: typeof fetch = fetch) {
  listeners.add(listener);
  if (listeners.size === 1 && state === LOADING && !controller) load(fetcher);
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    controller?.abort();
    controller = null;
    state = LOADING;
  };
}

export const followsSnapshot = () => state;
const serverSnapshot = () => LOADING;
const subscribe = (listener: () => void) => subscribeFollows(listener);

export function useFollows(): FollowsState {
  return useSyncExternalStore(subscribe, followsSnapshot, serverSnapshot);
}
