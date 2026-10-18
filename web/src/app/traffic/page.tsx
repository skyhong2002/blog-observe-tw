// Layout follows tag.observe.tw /media/traffic/ (afe0a65), adapted for blogs.

import MediaTabs from '@/components/MediaTabs';
import MethodLink from '@/components/MethodLink';
import SimilarwebTraffic from '@/components/SimilarwebTraffic';
import { staticPageMetadata } from '@/lib/seo';

// Rendered per request (no-store reads, public-read.ts): one table of every listed blog;
// the comparison's URL state is applied in the browser (TrafficComparisonFromUrl).
export const dynamic = 'force-dynamic';
export const metadata = staticPageMetadata('/traffic/');
export default function TrafficPage() {
  return (
    <div className="space-y-5 pb-8">
      <header>
        <MediaTabs current="traffic" />
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">部落格流量與排名</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Similarweb 估算 · <MethodLink />
        </p>
      </header>
      <SimilarwebTraffic />
    </div>
  );
}
