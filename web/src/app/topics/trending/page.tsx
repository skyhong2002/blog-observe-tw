import TopicRankingPage from '@/components/public/TopicRankingPage';
import { staticPageMetadata } from '@/lib/seo';

// Rendered per request (no-store reads, public-read.ts): topics rising against their long-term share (heat ×
// breadth, the homepage's order). A static segment, so it wins over /topics/[id]/; the gateway never gives a topic
// the key "trending" (app/src/seo/page-routes.ts RESERVED_TOPIC_KEYS).
export const dynamic = 'force-dynamic';
export const metadata = staticPageMetadata('/topics/trending/');

export default function Page() {
  return <TopicRankingPage order="heat" />;
}
