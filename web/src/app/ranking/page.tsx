import Link from 'next/link';
import SectionTabs from '@/components/SectionTabs';
import TableScroller from '@/components/TableScroller';
import TagCountChartLoader from '@/components/TagCountChartLoader';
import { overview, taipei } from '@/lib/api';
import { table } from '@/lib/table-styles';
export const dynamic = 'force-dynamic';
export default async function RankingPage() {
  const data = await overview();
  return (
    <div className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">標籤收錄排行</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          先依參與部落格數，再依已收錄文章數排列。這是收錄概況，不是品質評分、閱讀人次或升溫趨勢。
        </p>
        <p className="mt-2 text-xs text-zinc-500">{data.updatedAt ? `${taipei(data.updatedAt)} 更新` : '等待資料更新'}</p>
      </header>
      <SectionTabs
        label="標籤觀察"
        tabs={[
          { href: '/ranking/', label: '收錄排行', current: true },
          { href: '/tags/', label: '探索標籤' },
        ]}
      />
      {data.tags.length ? (
        <>
          <section className="rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-3 text-sm font-semibold">前十個標籤 · 參與部落格數</h2>
            <TagCountChartLoader rows={data.tags.slice(0, 10).map((t) => ({ label: t.label, blogCount: t.blogCount }))} />
          </section>
          <TableScroller card>
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th className={table.cell}>名次</th>
                  <th className={table.cell}>標籤</th>
                  <th className={table.num}>收錄文章</th>
                  <th className={table.num}>部落格</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {data.tags.map((tag, i) => (
                  <tr className={table.row} key={tag.slug}>
                    <td className={`${table.cell} text-zinc-500`}>{i + 1}</td>
                    <td className={table.cell}>
                      <Link
                        className="text-brand-700 hover:underline dark:text-brand-400"
                        href={`/tags/?tag=${encodeURIComponent(tag.slug)}`}
                      >
                        {tag.label}
                      </Link>
                    </td>
                    <td className={table.num}>{tag.postCount}</td>
                    <td className={table.num}>{tag.blogCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
        </>
      ) : (
        <p className="py-8 text-zinc-500">目前沒有可列出的標籤。</p>
      )}
    </div>
  );
}
