// Server entry for blog traffic: /traffic/ gets tag's TrafficComparison layout
// (BlogTrafficComparison), /blogs/[slug]/ gets the MediaTrafficProfile layout
// (BlogTrafficProfile). Reads only the local gateway's /api/traffic.
import { Suspense } from 'react';
import BlogTrafficComparison from '@/components/BlogTrafficComparison';
import BlogTrafficProfile from '@/components/BlogTrafficProfile';
import TrafficComparisonFromUrl from '@/components/public/TrafficComparisonFromUrl';
import { publicJson } from '@/lib/public-api';
import { PublicGatewayError } from '@/lib/public-read';
import { normalizeTraffic } from '@/lib/traffic';

const NO_QUERY: Record<string, string | undefined> = {};

export default async function SimilarwebTraffic({ slug, compact = false }: { slug?: string; compact?: boolean }) {
  const path = `/api/traffic${slug ? `?${new URLSearchParams({ blog: slug })}` : ''}`;
  const data = normalizeTraffic(await publicJson<unknown>(path));
  // public-contracts.ts already requires `blogs`; an unreadable payload must not be cached as a "no data" page.
  if (!data) throw new PublicGatewayError(path, 200, 'unexpected traffic payload');
  if (compact || slug) {
    const blog = data.blogs.find((b) => b.slug === slug);
    // Not listed: unverified, or a shared platform whose domain-wide figures are not one writer's.
    if (!blog) return null;
    return <BlogTrafficProfile blog={blog} limitations={data.limitations} />;
  }
  if (!data.blogs.length)
    return (
      <p className="rounded-xl border border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        目前沒有可列出流量的已核准部落格。共用平台的全站流量不會套用到個別作者。
      </p>
    );
  return (
    <div className="space-y-4">
      {/* The page is prerendered without a query; the URL's own (sort, month, q, state, view, page, compare) is read in the browser. */}
      <Suspense fallback={<BlogTrafficComparison data={data} initial={NO_QUERY} />}>
        <TrafficComparisonFromUrl data={data} />
      </Suspense>
      <section aria-labelledby="traffic-notes" className="rounded-xl border border-zinc-300 p-4 text-xs leading-6 dark:border-zinc-800">
        <h2 id="traffic-notes" className="mb-2 text-sm font-semibold">
          怎麼讀這些數字
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-zinc-600 dark:text-zinc-400">
          <li>數字是 Similarweb 對整個網域的月造訪估算，包含首頁與舊文；不是精確 page views、不重複讀者，也不代表文章品質。</li>
          <li>只列出使用獨立網域的已核准部落格；多位作者共用的平台網域，不把全站流量算到個別作者。</li>
          <li>低流量網站常沒有估計。「來源無估計」「等待抓取」不代表沒有讀者，表中以「—」表示，不補零。</li>
          <li>「保留上次估計」表示這次更新沒成功，顯示的仍是上次取得的數字；「來源暫緩」是資料來源暫時不提供。</li>
          <li>排名、類別與來源國家是最新一期；月份選單只影響月造訪欄。導流管道（直接、搜尋、社群等）目前沒有資料，因此不列出。</li>
          {data.limitations && <li>{data.limitations}</li>}
        </ul>
      </section>
    </div>
  );
}
