import MethodLink from '@/components/MethodLink';
import Link from '@/components/NoPrefetchLink';
import SectionTabs from '@/components/SectionTabs';
import StateNotice from '@/components/StateNotice';
import TableScroller from '@/components/TableScroller';
import TagCountChartLoader from '@/components/TagCountChartLoader';
import { taipei } from '@/lib/api';
import { overview } from '@/lib/public-api';
import { staticPageMetadata } from '@/lib/seo';
import { table } from '@/lib/table-styles';
// Rendered per request (no-store reads, public-read.ts).
export const dynamic = 'force-dynamic';
export const metadata = staticPageMetadata('/ranking/');
export default async function RankingPage() {
  const data = await overview();
  return (
    <div className="space-y-5 pb-8">
      <SectionTabs
        label="文章瀏覽"
        tabs={[
          { href: '/articles/', label: '最新文章' },
          { href: '/tags/', label: '文章標籤' },
          { href: '/ranking/', label: '標籤收錄排行', current: true },
        ]}
      />
      <header>
        <h1 className="text-2xl font-semibold">標籤收錄排行</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {data.updatedAt ? `更新於 ${taipei(data.updatedAt)}` : '等待資料更新'} · <MethodLink />
        </p>
      </header>
      {data.tags.length ? (
        <>
          <section className="rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-3 text-sm font-semibold">前十個標籤 · 參與部落格數</h2>
            <TagCountChartLoader rows={data.tags.slice(0, 10).map((t) => ({ label: t.label, blogCount: t.blogCount }))} />
          </section>
          <TableScroller card label="標籤收錄排行表格，可左右捲動">
            <table className="w-full whitespace-nowrap text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th scope="col" className={table.leadHead}>
                    名次 · 標籤
                  </th>
                  <th scope="col" className={table.num}>
                    部落格
                  </th>
                  <th scope="col" className={table.num}>
                    收錄文章
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {data.tags.map((tag, i) => (
                  <tr className={table.row} key={tag.slug}>
                    <td className={table.lead}>
                      <div className={`${table.leadBox} flex items-center gap-2`}>
                        <span className={`${table.leadExtra} w-7 shrink-0 text-right text-xs tabular-nums text-zinc-500`}>{i + 1}</span>
                        <Link
                          className={`${table.leadText} text-brand-700 hover:underline dark:text-brand-400 sm:max-w-80`}
                          href={`/tags/?tag=${encodeURIComponent(tag.slug)}`}
                          title={`第 ${i + 1} 名：${tag.label}`}
                        >
                          {tag.label}
                        </Link>
                      </div>
                    </td>
                    <td className={table.num}>{tag.blogCount.toLocaleString('zh-TW')}</td>
                    <td className={table.num}>{tag.postCount.toLocaleString('zh-TW')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        </>
      ) : (
        <StateNotice tone="notice" title="排行還沒有資料" actions={[{ href: '/articles/', label: '看最新文章', primary: true }]}>
          收錄的文章帶有標籤後，這裡會依參與的部落格數排出前幾名。
        </StateNotice>
      )}
    </div>
  );
}
