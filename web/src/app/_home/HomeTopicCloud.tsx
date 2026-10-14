// The masthead's word cloud, streamed in its own Suspense. It reads the same /api/topics?days=30&view=home path
// as HomeTopicRanking, so React's per-request cache (public-api.ts) makes it one no-store read for both. Words come
// from that ranked pool only; raw RSS categories are never drawn. A failed read throws to the error boundary, as the
// ranking's does; an empty ranking is said as empty, never filled from another source.

import { publicJson } from '@/lib/public-api';
import { homeTopicsApiPath } from '@/lib/public-query';
import { topicCloudWords } from '@/lib/topic-cloud';
import type { HomeTopics } from './HomeTopics';
import { MastheadWords } from './MastheadCloud';

export default async function HomeTopicCloud() {
  const topics = await publicJson<HomeTopics>(homeTopicsApiPath('30'));
  const words = topicCloudWords(topics.items, '30');
  return words.length ? (
    <MastheadWords words={words} />
  ) : (
    <p role="status" className="sr-only" data-cloud-state="empty">
      近 30 天尚無足夠的共同話題可以畫成文字雲。
    </p>
  );
}
