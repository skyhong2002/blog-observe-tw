import { Suspense } from 'react';
import TopicRankingView, { TopicRankingFromUrl } from '@/components/public/TopicRanking';
import { publicJson } from '@/lib/public-api';
import { TOPICS_PERIOD, topicsApiPath } from '@/lib/public-query';
import { pageMetadata } from '@/lib/seo';
import type { Topics } from '@/lib/topics';

// ISR (PUBLIC_REVALIDATE_SECONDS): the prerendered page is the 30-day ranking;
// ?days=7|90 are read in the browser from the same public /api/topics.
export const revalidate = 120;
export const metadata = pageMetadata(
  '/topics/',
  '大家正在寫什麼',
  '台灣部落格近期共同話題排行：依參與部落格數與文章數，看大家最近都在寫什麼。',
);

export default async function Page() {
  const baseline = await publicJson<Topics>(topicsApiPath(TOPICS_PERIOD));
  return (
    <Suspense fallback={<TopicRankingView days={TOPICS_PERIOD} load={{ status: 'ready', data: baseline }} />}>
      <TopicRankingFromUrl baseline={baseline} />
    </Suspense>
  );
}
