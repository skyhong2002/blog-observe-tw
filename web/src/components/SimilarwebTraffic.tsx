// Server entry for blog traffic: /traffic/ gets tag's TrafficComparison layout
// (BlogTrafficComparison), /blogs/[slug]/ gets the MediaTrafficProfile layout
// (BlogTrafficProfile). Reads only the local gateway's /api/traffic.
import { Suspense } from 'react';
import BlogTrafficComparison from '@/components/BlogTrafficComparison';
import BlogTrafficProfile from '@/components/BlogTrafficProfile';
import FooterMethod, { methodHeading } from '@/components/FooterMethod';
import TrafficComparisonFromUrl from '@/components/public/TrafficComparisonFromUrl';
import { publicJson } from '@/lib/public-api';
import { PublicGatewayError } from '@/lib/public-read';
import { COMPARE_LIMIT, normalizeTraffic } from '@/lib/traffic';

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
  const notes = (
    <>
      <h3 className={methodHeading}>怎麼讀這些數字</h3>
      <p>數字是 Similarweb 對整個網域的月造訪估算，包含首頁與舊文；只是外部參考，不是精確 page views、不重複讀者，也不代表文章品質。</p>
      <p>只列出使用獨立網域的已核准部落格；多位作者共用的平台網域，不把全站流量算到個別作者。</p>
      <p>低流量網站常沒有估計。「來源無估計」「等待抓取」不代表沒有讀者，表中以「—」表示，不補零。</p>
      <p>「保留上次估計」表示這次更新沒成功，顯示的仍是上次取得的數字；「來源暫緩」是資料來源暫時不提供。</p>
      <p>排名、類別與來源國家是最新一期；月份選單只影響月造訪欄。導流管道（直接、搜尋、社群等）目前沒有資料，因此不列出。</p>
      <p>月造訪趨勢比較只畫有兩個月以上估計的部落格；沒有資料的月份留白，不補零。在表格「比較」欄勾選加入，最多 {COMPARE_LIMIT} 個。</p>
      {data.limitations && <p>{data.limitations}</p>}
    </>
  );
  if (!data.blogs.length)
    return (
      <>
        <p className="rounded-xl border border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          目前沒有可列出流量的已核准部落格。
        </p>
        <FooterMethod page notes={notes} />
      </>
    );
  return (
    <div className="space-y-4">
      {/* The page is prerendered without a query; the URL's own (sort, month, q, state, view, page, compare) is read in the browser. */}
      <Suspense fallback={<BlogTrafficComparison data={data} initial={NO_QUERY} />}>
        <TrafficComparisonFromUrl data={data} />
      </Suspense>
      <FooterMethod page notes={notes} />
    </div>
  );
}
