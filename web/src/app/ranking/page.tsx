import MethodLink from '@/components/MethodLink';
import Link from '@/components/NoPrefetchLink';
import SectionTabs from '@/components/SectionTabs';
import StateNotice from '@/components/StateNotice';
import TableScroller from '@/components/TableScroller';
import TagCountChartLoader from '@/components/TagCountChartLoader';
import { taipei } from '@/lib/api';
import { isPlatformDefaultTag } from '@/lib/platform-tags';
import { overview } from '@/lib/public-api';
import { staticPageMetadata } from '@/lib/seo';
import { table } from '@/lib/table-styles';
// Rendered per request (no-store reads, public-read.ts).
export const dynamic = 'force-dynamic';
export const metadata = staticPageMetadata('/ranking/');
/** The first rows on the page; the rest open below. */
const SHOWN = 30;
/** Rows per column of the shown part on a desktop. */
const HALF = SHOWN / 2;

export default async function RankingPage() {
  const all = await overview();
  const skipped = all.tags.filter((t) => isPlatformDefaultTag(t.label));
  const data = { ...all, tags: all.tags.filter((t) => !isPlatformDefaultTag(t.label)) };
  const cols = (
    <colgroup>
      <col />
      <col className="w-24" />
      <col className="w-28" />
    </colgroup>
  );
  const row = (tag: (typeof data.tags)[number], i: number) => (
    <tr className={table.row} key={tag.slug}>
      <td className={table.lead}>
        <div className={`${table.leadBox} flex items-center gap-2`}>
          <span
            className={`${table.leadExtra} w-7 shrink-0 text-right text-sm font-semibold tabular-nums ${i < 3 ? 'text-brand-700 dark:text-brand-400' : 'text-zinc-700 dark:text-zinc-300'}`}
          >
            {i + 1}
          </span>
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
  );
  return (
    <div className="space-y-5 pb-8">
      <SectionTabs
        label="標籤"
        tabs={[
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
        // The chart and its summary span the page; the top 30 then read in two columns of 15 on a desktop (one column
        // on a phone), so neither column runs on alone under the other.
        <div className="space-y-5">
          <section className="grid gap-5 rounded-xl border border-zinc-300 bg-white p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center lg:gap-8 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="min-w-0">
              <h2 className="mb-3 text-sm font-semibold">前十個標籤 · 參與部落格數</h2>
              <TagCountChartLoader rows={data.tags.slice(0, 10).map((t) => ({ label: t.label, blogCount: t.blogCount }))} />
            </div>
            <div className="min-w-0 border-t border-zinc-200 pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8 dark:border-zinc-800">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-zinc-600 dark:text-zinc-400">列出的標籤</dt>
                  <dd className="mt-0.5 text-xl font-semibold tabular-nums">{data.tags.length.toLocaleString('zh-TW')}</dd>
                </div>
                <div>
                  <dt className="text-zinc-600 dark:text-zinc-400">最多部落格在用</dt>
                  <dd className="mt-0.5 truncate text-xl font-semibold" title={data.tags[0].label}>
                    {data.tags[0].label}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
                先比有多少部落格用過這個標籤，再比收錄的文章數。這是「多少人在寫」，不是熱度或品質評分。
                {skipped.length > 0 && ` 已略過部落格平台的預設分類（${skipped.map((t) => t.label).join('、')}）。`}
              </p>
              <p className="mt-3">
                <Link href="/tags/" className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-400">
                  依標籤看文章 →
                </Link>
              </p>
            </div>
          </section>
          <div className="grid items-start gap-5 lg:grid-cols-2">
            {[0, HALF].map((from) =>
              data.tags.length > from ? (
                <TableScroller key={from} card label={`標籤收錄排行表格，第 ${from + 1} 名起，可左右捲動`}>
                  <table className="w-full table-fixed whitespace-nowrap text-sm">
                    {cols}
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
                      {data.tags.slice(from, Math.min(from + HALF, SHOWN)).map((tag, i) => row(tag, from + i))}
                    </tbody>
                  </table>
                </TableScroller>
              ) : null,
            )}
          </div>
          {data.tags.length > SHOWN && (
            <details className="group rounded-xl border border-zinc-300 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                顯示第 {SHOWN + 1}–{data.tags.length} 名
                <span aria-hidden="true" className="text-zinc-500 transition-transform group-open:rotate-180">
                  ▾
                </span>
              </summary>
              <table className="w-full table-fixed whitespace-nowrap border-t border-zinc-200 text-sm dark:border-zinc-800">
                {cols}
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {data.tags.slice(SHOWN).map((tag, i) => row(tag, i + SHOWN))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      ) : (
        <StateNotice tone="notice" title="排行還沒有資料" actions={[{ href: '/articles/', label: '看最新文章', primary: true }]}>
          收錄的文章帶有標籤後，這裡會依參與的部落格數排出前幾名。
        </StateNotice>
      )}
    </div>
  );
}
