'use client';

// One view for the prerendered 30-day ranking and the browser's ?days=7|90; see app/topics/page.tsx.

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import FooterMethod from '@/components/FooterMethod';
import MethodLink from '@/components/MethodLink';
import Link from '@/components/NoPrefetchLink';
import { SectionUnavailable } from '@/components/SectionBoundary';
import SectionTabs from '@/components/SectionTabs';
import SortIndicator from '@/components/SortIndicator';
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
        <SectionUnavailable label="話題資料" />
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

type SortKey = 'rank' | 'blogs' | 'posts' | 'score' | 'lift';

/** "title / body-only"; a title-only term's body side was never counted, so it shows — rather than 0. */
const splitText = (t: Topics['items'][number]) =>
  t.matchingReason && typeof t.titlePosts === 'number' ? `${t.titlePosts.toLocaleString('zh-TW')} / —` : matchSplit(t);

function TopicRows({ days, data }: { days: Period; data: Topics }) {
  const liftTitle = liftExplanation(data.matchingPolicy?.frequency?.baselineDays);
  // The gateway's order is the ranking (heat × breadth); a header re-sorts this page's rows only, and the rank stays.
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'rank', descending: false });
  const ranked = data.items.map((t, i) => ({ t, rank: i + 1 }));
  const value = (row: (typeof ranked)[number]) =>
    sort.key === 'rank' ? row.rank : sort.key === 'lift' ? (row.t.lift ?? -1) : Number(row.t[sort.key]);
  const rows =
    sort.key === 'rank' && !sort.descending
      ? ranked
      : [...ranked].sort((a, b) => (sort.descending ? value(b) - value(a) : value(a) - value(b)) || a.rank - b.rank);
  const toggle = (key: SortKey) =>
    setSort((now) => (now.key === key ? { key, descending: !now.descending } : { key, descending: key !== 'rank' }));
  const header = (key: SortKey, label: string, className: string, title?: string) => (
    <th scope="col" className={className} aria-sort={sort.key === key ? (sort.descending ? 'descending' : 'ascending') : undefined}>
      <button
        type="button"
        onClick={() => toggle(key)}
        title={title}
        className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {label}
        <SortIndicator active={sort.key === key} descending={sort.descending} />
      </button>
    </th>
  );
  return (
    <>
      <TableScroller card label="共同話題表格，可左右捲動">
        <table className="w-full whitespace-nowrap text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              {header('rank', '#', `${table.num} w-12`)}
              <th scope="col" className={table.leadHead}>
                話題
              </th>
              {header('blogs', '部落格', table.num)}
              {header('posts', '文章', table.num)}
              <th scope="col" className={table.num}>
                標題／僅正文
              </th>
              {header('score', '加權貢獻', table.num)}
              {header('lift', '升溫倍率', table.num, liftTitle)}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map(({ t, rank }) => (
              <tr key={t.id} className={table.row}>
                <td className={`${table.num} text-xs text-zinc-500 dark:text-zinc-400`}>{rank}</td>
                <td className={table.lead}>
                  <div className={`${table.leadBox} flex items-baseline gap-2`}>
                    <Link
                      className={`${table.leadText} block text-brand-700 hover:underline dark:text-brand-400 sm:max-w-80`}
                      {...topicLink(t.id, t.canonicalPath, days)}
                      title={t.label}
                    >
                      {t.label}
                    </Link>
                    {t.source === 'rss-category' ? (
                      <span className={`${table.leadExtra} text-xs text-zinc-500 dark:text-zinc-400`}>RSS 標籤</span>
                    ) : null}
                  </div>
                </td>
                <td className={table.num}>{t.blogs.toLocaleString('zh-TW')}</td>
                <td className={table.num}>{t.posts.toLocaleString('zh-TW')}</td>
                <td className={table.num} title={t.matchingReason ? matchingReasonLabel(t.matchingReason) : undefined}>
                  {splitText(t)}
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
export function TopicRankingFromUrl({ baseline }: { baseline: Topics | null }) {
  const days = periodOf(useSearchParams(), TOPICS_PERIOD);
  // No server baseline (its read failed): the browser reads the 30-day ranking like the other periods.
  const load = usePublicJson(days === TOPICS_PERIOD && baseline ? null : topicsApiPath(days), parseTopics);
  return <TopicRankingView days={days} load={load ?? (baseline ? { status: 'ready', data: baseline } : { status: 'pending' })} />;
}
