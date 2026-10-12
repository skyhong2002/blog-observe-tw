// Layout follows tag.observe.tw /media/traffic/ (afe0a65), adapted for blogs.
import Link from 'next/link';
import MediaTabs from '@/components/MediaTabs';
import SimilarwebTraffic from '@/components/SimilarwebTraffic';

// ISR (PUBLIC_REVALIDATE_SECONDS): one prerendered table of every listed blog;
// the comparison's URL state is applied in the browser (TrafficComparisonFromUrl).
export const revalidate = 120;
export const metadata = { title: '部落格流量與排名', description: '對照已核准部落格的網域流量估算、排名與資料時間；估算不代表文章品質。' };
export default function TrafficPage() {
  return (
    <div className="space-y-5 pb-8">
      <header>
        <MediaTabs current="traffic" />
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">部落格流量與排名</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          Similarweb 對各部落格網域的月造訪估算與排名，只是外部參考，不以流量判定文章品質 ·{' '}
          <Link href="#traffic-notes" className="hover:text-brand-700 hover:underline dark:hover:text-brand-400">
            怎麼讀這些數字 ⓘ
          </Link>
        </p>
      </header>
      <SimilarwebTraffic />
    </div>
  );
}
