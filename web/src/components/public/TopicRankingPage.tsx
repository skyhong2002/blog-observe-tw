import { Suspense } from 'react';
import TopicRankingView, { TopicRankingFromUrl } from '@/components/public/TopicRanking';
import { publicJson } from '@/lib/public-api';
import { TOPICS_PERIOD, type TopicOrder, topicsApiPath } from '@/lib/public-query';
import { PublicGatewayError } from '@/lib/public-read';
import { tagCloudVisuals } from '@/lib/tag-visuals';
import type { Topics } from '@/lib/topics';

// The server half of /topics/ and /topics/trending/: the 30-day ranking in the page's order, and tag's pictures
// for the cloud (optional decoration; tagCloudVisuals never throws). ?days=7|90 are read in the browser from the
// same public /api/topics. A 30-day read that fails on the server does not fail the page: the browser reads it
// again itself (as relations/page.tsx does).
export default async function TopicRankingPage({ order }: { order: TopicOrder }) {
  const [baseline, visualMap] = await Promise.all([
    publicJson<Topics>(topicsApiPath(TOPICS_PERIOD, order)).catch((error: unknown) => {
      if (error instanceof PublicGatewayError) return null;
      throw error;
    }),
    tagCloudVisuals(),
  ]);
  const visuals = [...visualMap];
  const load = baseline ? ({ status: 'ready', data: baseline } as const) : ({ status: 'pending' } as const);
  return (
    <Suspense fallback={<TopicRankingView order={order} days={TOPICS_PERIOD} load={load} visuals={visuals} />}>
      <TopicRankingFromUrl order={order} baseline={baseline} visuals={visuals} />
    </Suspense>
  );
}
