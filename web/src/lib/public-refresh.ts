/**
 * When a public page the browser already shows must ask the gateway again, as
 * plain logic (window, document and clock injectable) so node --test can drive
 * it; use-public-refresh.ts binds it to React.
 *
 * A page that stays on screen is not polled. The epoch moves when the page may
 * have been kept around while the gateway changed its answer:
 * - the tab becomes visible again (`visibilitychange`),
 * - the page is restored from the back/forward cache (`pageshow`, persisted),
 * - an in-app back/forward (`popstate`), which Next answers from its router
 *   cache without asking the server.
 * Events within REFRESH_MERGE_MS of the last move are one move (a bfcache
 * restore fires both pageshow and visibilitychange).
 */

export const REFRESH_MERGE_MS = 1_000;

type Target = {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
};
export type RefreshEnv = { window: Target; document: Target & { visibilityState: string }; now?: () => number };

export function createRefreshSignal({ window, document, now = Date.now }: RefreshEnv) {
  let epoch = 0;
  let last = -Infinity;
  const listeners = new Set<() => void>();
  const move = () => {
    const at = now();
    if (at - last < REFRESH_MERGE_MS) return;
    last = at;
    epoch++;
    for (const listener of [...listeners]) listener();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') move();
  };
  const onPageShow = (event: Event) => {
    if ((event as Event & { persisted?: boolean }).persisted) move();
  };

  function subscribe(listener: () => void) {
    if (!listeners.size) {
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pageshow', onPageShow);
      window.addEventListener('popstate', move);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size) return;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('popstate', move);
    };
  }

  return { subscribe, epoch: () => epoch };
}
