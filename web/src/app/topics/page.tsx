import { Suspense } from 'react';
import TopicRankingView, { TopicRankingFromUrl } from '@/components/public/TopicRanking';
import { publicJson } from '@/lib/public-api';
import { TOPICS_PERIOD, topicsApiPath } from '@/lib/public-query';
import { PublicGatewayError } from '@/lib/public-read';
import { staticPageMetadata } from '@/lib/seo';
import type { Topics } from '@/lib/topics';

// Rendered per request (no-store reads, public-read.ts): the server page is the 30-day ranking;
// ?days=7|90 are read in the browser from the same public /api/topics. A 30-day read that fails on the server does
// not fail the page: the browser reads it again itself (as relations/page.tsx does).
export const dynamic = 'force-dynamic';
export const metadata = staticPageMetadata('/topics/');

export default async function Page() {
  const baseline = await publicJson<Topics>(topicsApiPath(TOPICS_PERIOD)).catch((error: unknown) => {
    if (error instanceof PublicGatewayError) return null;
    throw error;
  });
  const load = baseline ? ({ status: 'ready', data: baseline } as const) : ({ status: 'pending' } as const);
  return (
    <Suspense fallback={<TopicRankingView days={TOPICS_PERIOD} load={load} />}>
      <TopicRankingFromUrl baseline={baseline} />
    </Suspense>
  );
}
