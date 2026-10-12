'use client';

import { useSyncExternalStore } from 'react';
import { createRefreshSignal } from './public-refresh';

/** One signal for the whole page; rules in public-refresh.ts. */
const signal = typeof window === 'undefined' ? null : createRefreshSignal({ window, document });
const none = () => () => {};

/** Moves when an already-shown public page must read the gateway again; 0 on the server. */
export function usePublicRefreshEpoch(): number {
  return useSyncExternalStore(signal?.subscribe ?? none, signal?.epoch ?? (() => 0), () => 0);
}
