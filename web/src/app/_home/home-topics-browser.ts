// The browser's own read of the home topic ranking, used when the server's read failed. The list and the masthead
// cloud share one read per attempt (the in-flight promise), with a longer timeout than a page read and one retry,
// since a slow ranking is the usual reason the server gave up. Nothing is kept once a read settles.

import { useEffect, useState } from 'react';
import { createPublicLoader, type PublicLoad } from '@/lib/public-loader';
import { homeTopicsApiPath } from '@/lib/public-query';
import { asIs } from '@/lib/use-public-json';
import type { HomeTopics } from './HomeTopicList';

/** Long enough for the ranking on a loaded host; the section shows its placeholder meanwhile. */
export const HOME_BROWSER_TIMEOUT_MS = 25_000;
const loader = createPublicLoader({ timeoutMs: HOME_BROWSER_TIMEOUT_MS });
let flight: Promise<PublicLoad<HomeTopics>> | null = null;

function readHomeTopics() {
  if (flight) return flight;
  const read = (async () => {
    for (let attempt = 0; ; attempt++) {
      const result = await loader.load(homeTopicsApiPath('30'), asIs<HomeTopics>, new AbortController().signal);
      if (result?.status === 'ready' || attempt >= 1) return result ?? ({ status: 'error' } as const);
    }
  })();
  flight = read;
  void read.finally(() => {
    if (flight === read) flight = null;
  });
  return read;
}

/** The ranking as the browser reads it, and a retry that reads again. */
export function useHomeTopics() {
  const [load, setLoad] = useState<PublicLoad<HomeTopics>>({ status: 'pending' });
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry trigger.
  useEffect(() => {
    let live = true;
    setLoad({ status: 'pending' });
    void readHomeTopics().then((result) => live && setLoad(result));
    return () => {
      live = false;
    };
  }, [attempt]);
  return [load, () => setAttempt((n) => n + 1)] as const;
}
