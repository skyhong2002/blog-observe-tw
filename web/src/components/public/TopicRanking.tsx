'use client';
// One view for the prerendered 30-day ranking and the browser's ?days=7|90; see app/topics/page.tsx.

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import SectionTabs from '@/components/SectionTabs';
import TableScroller from '@/components/TableScroller';
import VocabularyNotice from '@/components/VocabularyNotice';
import { type Period, periodOf, TOPICS_PERIOD, topicsApiPath } from '@/lib/public-query';
import { table } from '@/lib/table-styles';
import { matchingPolicyText, matchSplit, type Topics } from '@/lib/topics';
import { asIs, type PublicLoad, usePublicJson } from '@/lib/use-public-json';

export default function TopicRankingView({ days, load }: { days: Period; load: PublicLoad<Topics> }) {
  return (
    <div className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">大家正在寫什麼</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          從不同部落格的文章，看持續被書寫的話題。同站對同一詞的貢獻逐篇遞減，讓大量發文的站不會獨占排行。
        </p>
      </header>
      <SectionTabs
        label="話題期間"
        tabs={[7, 30, 90].map((d) => ({ href: `/topics/?days=${d}`, label: `近 ${d} 天`, current: String(d) === days }))}
      />
      {load.status === 'ready' ? (
        <TopicRows days={days} data={load.data} />
      ) : load.status === 'pending' ? (
        <p role="status" aria-busy="true" className="text-zinc-500">
          正在載入近 {days} 天的話題…
        </p>
      ) : (
        <p role="status">話題資料暫時無法讀取，請稍後再試。</p>
      )}
    </div>
  );
}

function TopicRows({ days, data }: { days: Period; data: Topics }) {
  return (
    <>
      <TableScroller card label="共同話題表格，可左右捲動">
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th scope="col" className={table.leadHead}>
                話題
              </th>
              <th scope="col" className={table.cell}>
                來源
              </th>
              <th scope="col" className={table.num}>
                部落格
              </th>
              <th scope="col" className={table.num}>
                文章
              </th>
              <th scope="col" className={table.num}>
                標題／僅正文
              </th>
              <th scope="col" className={table.num}>
                加權貢獻
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {data.items.map((t) => (
              <tr key={t.id} className={table.row}>
                <td className={table.lead}>
                  <div className={table.leadBox}>
                    <Link
                      className={`${table.leadText} block text-brand-700 hover:underline dark:text-brand-400 sm:max-w-80`}
                      href={`/topics/${encodeURIComponent(t.id)}/?days=${days}`}
                      title={t.label}
                    >
                      {t.label}
                    </Link>
                  </div>
                </td>
                <td className={`${table.cell} text-xs text-zinc-600 dark:text-zinc-400`}>
                  {t.source === 'rss-category' ? 'RSS 標籤' : '共同關鍵字'}
                </td>
                <td className={table.num}>{t.blogs.toLocaleString('zh-TW')}</td>
                <td className={table.num}>{t.posts.toLocaleString('zh-TW')}</td>
                <td className={table.num}>{matchSplit(t)}</td>
                <td className={table.num}>{Number(t.score).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
      {!data.items.length ? (
        <p className="py-8 text-zinc-500">這段期間尚無跨至少 {data.minimumBlogs} 個部落格的共同話題；個別站的主題可在部落格頁查看。</p>
      ) : null}
      <p className="text-xs text-zinc-500">{matchingPolicyText(data.matchingPolicy)}</p>
      <VocabularyNotice data={data.vocabulary} />
      {data.coverage ? (
        <p className="text-xs text-zinc-500">
          期間內 {data.coverage.datedPosts} 篇；可辨識正文 {data.coverage.bodyObservedPosts} 篇，標題或正文命中共同關鍵字{' '}
          {data.coverage.matchedPosts} 篇。比對達上限 {data.coverage.cappedPosts} 篇保留未完整標記。日期未知{' '}
          {data.coverage.unknownDatePosts} 篇不列入期間排行。
          {data.truncated ? '僅顯示前 100 項。' : ''}
        </p>
      ) : null}
    </>
  );
}

// public-contracts.ts has checked items and vocabulary; an empty ranking is a valid answer.
const parseTopics = asIs<Topics>;

/** Reads ?days= (inside the page's Suspense boundary); periods other than the prerendered one come from /api/topics. */
export function TopicRankingFromUrl({ baseline }: { baseline: Topics }) {
  const days = periodOf(useSearchParams(), TOPICS_PERIOD);
  const load = usePublicJson(days === TOPICS_PERIOD ? null : topicsApiPath(days), parseTopics);
  return <TopicRankingView days={days} load={load ?? { status: 'ready', data: baseline }} />;
}
