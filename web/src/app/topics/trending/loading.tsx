import { TopicRankingLoading } from '@/components/public/TopicRanking';

// /topics/trending/: the rising-topics ranking's pending view while the server reads (see (ranking)/loading.tsx).
export default function Loading() {
  return <TopicRankingLoading order="heat" />;
}
