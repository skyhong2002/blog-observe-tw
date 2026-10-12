import Link from 'next/link';
import SectionTabs from '@/components/SectionTabs';
import TableScroller from '@/components/TableScroller';
import VocabularyNotice from '@/components/VocabularyNotice';
import { gateway } from '@/lib/api';
import { table } from '@/lib/table-styles';
import type { Topics } from '@/lib/topics';
export const dynamic = 'force-dynamic';
export const metadata = { title: '大家正在寫什麼' };
export default async function Page({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const p = await searchParams;
  const days = ['7', '30', '90'].includes(p.days ?? '') ? p.days! : '30';
  const data = await gateway<Topics>(`/api/topics?days=${days}`);
  return (
    <div className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">大家正在寫什麼</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          從不同部落格的文章，看持續被書寫的話題。同站對同一詞依序貢獻 1、0.5、0.25…，讓大量發文的站不會獨占排行。
        </p>
      </header>
      <SectionTabs
        label="話題期間"
        tabs={[7, 30, 90].map((d) => ({ href: `/topics/?days=${d}`, label: `近 ${d} 天`, current: String(d) === days }))}
      />
      {data ? (
        <>
          <TableScroller card>
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th className={table.cell}>話題</th>
                  <th className={table.cell}>來源</th>
                  <th className={table.num}>部落格</th>
                  <th className={table.num}>文章</th>
                  <th className={table.num}>加權貢獻</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {data.items.map((t) => (
                  <tr key={t.id} className={table.row}>
                    <td className={table.cell}>
                      <Link
                        className="text-brand-700 hover:underline dark:text-brand-400"
                        href={`/topics/${encodeURIComponent(t.id)}/?days=${days}`}
                      >
                        {t.label}
                      </Link>
                    </td>
                    <td className={table.cell}>{t.source === 'rss-category' ? 'RSS 標籤' : '共同關鍵字'}</td>
                    <td className={table.num}>{t.blogs}</td>
                    <td className={table.num}>{t.posts}</td>
                    <td className={table.num}>{Number(t.score).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
          {!data.items.length ? (
            <p className="py-8 text-zinc-500">這段期間尚無跨至少 {data.minimumBlogs} 個部落格的共同話題；個別站的主題可在部落格頁查看。</p>
          ) : null}
          <VocabularyNotice data={data.vocabulary} />
          {data.coverage ? (
            <p className="text-xs text-zinc-500">
              期間內 {data.coverage.datedPosts} 篇；可辨識正文 {data.coverage.bodyObservedPosts} 篇，有 RSS 標籤或共同詞彙線索{' '}
              {data.coverage.matchedPosts} 篇。比對達上限 {data.coverage.cappedPosts} 篇保留未完整標記。日期未知{' '}
              {data.coverage.unknownDatePosts} 篇不列入期間排行。
              {data.truncated ? '僅顯示前 100 項。' : ''}
            </p>
          ) : null}
        </>
      ) : (
        <p role="status">話題資料暫時無法讀取，請稍後再試。</p>
      )}
    </div>
  );
}
