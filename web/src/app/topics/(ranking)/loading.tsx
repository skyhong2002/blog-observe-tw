import { TopicRankingLoading } from '@/components/public/TopicRanking';

// /topics/ only. The (ranking) group keeps this boundary off /topics/[id]/, whose 404 for an unknown or withdrawn
// topic must stay an HTTP 404 (a loading boundary above it would send 200 before notFound()). The ranking page
// never fails on a gateway read (TopicRankingPage falls back to the browser's read), so streaming hides no 5xx.
export default function Loading() {
  return <TopicRankingLoading order="blogs" />;
}
