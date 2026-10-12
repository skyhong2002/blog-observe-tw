import { Suspense } from 'react';
import TopicRankingView, { TopicRankingFromUrl } from '@/components/public/TopicRanking';
import { publicJson } from '@/lib/public-api';
import { TOPICS_PERIOD, topicsApiPath } from '@/lib/public-query';
import { staticPageMetadata } from '@/lib/seo';
import type { Topics } from '@/lib/topics';

// Rendered per request (no-store reads, public-read.ts): the server page is the 30-day ranking;
// ?days=7|90 are read in the browser from the same public /api/topics.
export const dynamic = 'force-dynamic';
export const metadata = staticPageMetadata('/topics/');

export default async function Page() {
  const baseline = await publicJson<Topics>(topicsApiPath(TOPICS_PERIOD));
  return (
    <Suspense fallback={<TopicRankingView days={TOPICS_PERIOD} load={{ status: 'ready', data: baseline }} />}>
      <TopicRankingFromUrl baseline={baseline} />
    </Suspense>
  );
}
