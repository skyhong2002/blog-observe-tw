'use client';

// One view for the prerendered 30-day ranking and the browser's ?days=7|90; see app/topics/page.tsx.

import { useSearchParams } from 'next/navigation';
import FooterMethod from '@/components/FooterMethod';
import MethodLink from '@/components/MethodLink';
import Link from '@/components/NoPrefetchLink';
import SectionTabs from '@/components/SectionTabs';
import TableScroller from '@/components/TableScroller';
import { VocabularySummary } from '@/components/VocabularyNotice';
import { topicLink } from '@/lib/page-links';
import { type Period, periodOf, TOPICS_PERIOD, topicsApiPath } from '@/lib/public-query';
import { table } from '@/lib/table-styles';
import { formatLift, liftExplanation, matchingReasonLabel, matchSplit, type Topics } from '@/lib/topics';
import { asIs, type PublicLoad, usePublicJson } from '@/lib/use-public-json';
import TopicMethod from './TopicMethod';

// The ranking comes first; how it is computed and the vocabulary's full record
// sit in this page's 資料來源與計算方式 (TopicMethod), closed until asked for.
export default function TopicRankingView({ days, load }: { days: Period; load: PublicLoad<Topics> }) {
  const data = load.status === 'ready' ? load.data : null;
  return (
    <div className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">大家正在寫什麼</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          不同部落格持續在寫的話題 · <MethodLink />
        </p>
      </header>
      <SectionTabs
        label="話題期間"
        tabs={[7, 30, 90].map((d) => ({ href: `/topics/?days=${d}`, label: `近 ${d} 天`, current: String(d) === days }))}
      />
      {data ? (
        <TopicRows days={days} data={data} />
      ) : load.status === 'pending' ? (
        <p role="status" aria-busy="true" className="text-zinc-500 dark:text-zinc-400">
          正在載入近 {days} 天的話題…
        </p>
      ) : (
        <p role="status">話題資料暫時無法讀取，請稍後再試。</p>
      )}
      <FooterMethod
        page
        notes={
          data ? (
            <TopicMethod
              vocabulary={data.vocabulary}
              matchingPolicy={data.matchingPolicy}
              coverage={data.coverage}
              ranking
              truncated={data.truncated ? `排行只顯示前 ${data.items.length} 項。` : undefined}
            />
          ) : null
        }
      />
    </div>
  );
}

function TopicRows({ days, data }: { days: Period; data: Topics }) {
  const liftTitle = liftExplanation(data.matchingPolicy?.frequency?.baselineDays);
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
              <th scope="col" className={table.num} title={liftTitle}>
                升溫倍率
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
                      {...topicLink(t.id, t.canonicalPath, days)}
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
                <td className={table.num}>
                  {matchSplit(t)}
                  {t.matchingReason ? (
                    <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400" title={matchingReasonLabel(t.matchingReason)}>
                      只計標題
                    </span>
                  ) : null}
                </td>
                <td className={table.num}>{Number(t.score).toFixed(2)}</td>
                <td className={`${table.num}${t.lift == null ? ' text-xs text-zinc-500 dark:text-zinc-400' : ''}`} title={liftTitle}>
                  {formatLift(t.lift)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
      <VocabularySummary data={data.vocabulary} />
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
