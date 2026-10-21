// The homepage's 最近共同話題 list, read on its own so the rest of the page (hero, articles, meta) streams
// without waiting for the ranking. A server read the gateway did not answer in time (network, timeout, 5xx: the
// shared host is often slow) hands the list to the browser, which reads the same path itself
// (HomeTopicsFromBrowser); a wrong answer (bad payload, 404) still throws to the section's boundary. It is never an
// empty list.

import { publicJson } from '@/lib/public-api';
import { homeTopicsApiPath } from '@/lib/public-query';
import { PublicGatewayError } from '@/lib/public-read';
import HomeTopicList, { type HomeTopics } from './HomeTopicList';
import { HomeTopicRankingFromBrowser } from './HomeTopicsFromBrowser';

export { type HomeTopics, HomeTopicsPending } from './HomeTopicList';

/** A read worth trying again from the browser: no answer in time, or the gateway's own failure. */
const transient = (error: unknown) =>
  error instanceof PublicGatewayError && (error.status === null || error.status >= 500) && !/unreadable|unexpected/.test(error.message);

/** The home topic read on the server, or null when the gateway did not answer in time. */
export const serverHomeTopics = () =>
  publicJson<HomeTopics>(homeTopicsApiPath('30')).catch((error: unknown) => {
    if (transient(error)) return null;
    throw error;
  });

export default async function HomeTopicRanking() {
  const topics = await serverHomeTopics();
  return topics ? <HomeTopicList topics={topics} /> : <HomeTopicRankingFromBrowser />;
}
