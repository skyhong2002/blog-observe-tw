import TopicRankingPage from '@/components/public/TopicRankingPage';
import { staticPageMetadata } from '@/lib/seo';

// Rendered per request (no-store reads, public-read.ts): what the most blogs are writing about (order=blogs).
// The rising topics are the second tab, /topics/trending/.
export const dynamic = 'force-dynamic';
export const metadata = staticPageMetadata('/topics/');

export default function Page() {
  return <TopicRankingPage order="blogs" />;
}
