import MediaTabs from '@/components/MediaTabs';
import SimilarwebTraffic from '@/components/SimilarwebTraffic';
export const dynamic = 'force-dynamic';
export default function TrafficPage() {
  return (
    <div className="space-y-5 pb-8">
      <MediaTabs current="traffic" />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">部落格流量與排名</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">查看已核准部落格的網域估計與資料時間，不以流量判定文章品質。</p>
      </header>
      <SimilarwebTraffic />
    </div>
  );
}
