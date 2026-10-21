// The masthead's word cloud, streamed in its own Suspense. It reads the same /api/topics?days=30&view=home path
// as HomeTopicRanking, so React's per-request cache (public-api.ts) makes it one no-store read for both. Words come
// from that ranked pool only; raw RSS categories are never drawn. When the gateway did not answer in time the
// browser reads the ranking itself (shared with the list, HomeTopicsFromBrowser); other failures throw to the
// section's quiet boundary. An empty ranking draws nothing, never words from another source.

import { tagCloudVisuals } from '@/lib/tag-visuals';
import { topicCloudWords } from '@/lib/topic-cloud';
import { serverHomeTopics } from './HomeTopics';
import { HomeTopicCloudFromBrowser } from './HomeTopicsFromBrowser';
import { MastheadWords } from './MastheadCloud';

export default async function HomeTopicCloud() {
  // tag's pictures are optional decoration: tagCloudVisuals never throws and is cached per process.
  const [topics, visuals] = await Promise.all([serverHomeTopics(), tagCloudVisuals()]);
  if (!topics) return <HomeTopicCloudFromBrowser visuals={[...visuals]} />;
  // cloudItems: the same ranked pool, up to 60 candidates for 30 words, in this one response; older gateways send
  // only the left list's items.
  const words = topicCloudWords(topics.cloudItems ?? topics.items, '30', 30, visuals);
  return words.length ? <MastheadWords words={words} /> : null;
}
