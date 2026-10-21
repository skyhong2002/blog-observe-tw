'use client';

// The two topic rankings, one view each for the prerendered 30-day read and the browser's ?days=7|90:
// /topics/ (order=blogs, what the most blogs are writing about) and /topics/trending/ (heat, what is rising).
// Each opens like the homepage, its title in the middle of its own ranking's word cloud; see app/topics/page.tsx.

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import FilterChips from '@/components/FilterChips';
import FooterMethod from '@/components/FooterMethod';
import MethodLink from '@/components/MethodLink';
import Link from '@/components/NoPrefetchLink';
import { SectionUnavailable } from '@/components/SectionBoundary';
import SectionTabs from '@/components/SectionTabs';
import SortIndicator from '@/components/SortIndicator';
import TableScroller from '@/components/TableScroller';
import { VocabularySummary } from '@/components/VocabularyNotice';
import { topicLink } from '@/lib/page-links';
import { PERIODS, type Period, periodOf, TOPICS_PERIOD, type TopicOrder, topicsApiPath } from '@/lib/public-query';
import { table } from '@/lib/table-styles';
import type { CloudVisual } from '@/lib/tag-visuals';
import { topicCloudWords } from '@/lib/topic-cloud';
import { formatLift, liftExplanation, matchingReasonLabel, matchSplit, type Topics } from '@/lib/topics';
import { asIs, type PublicLoad, usePublicJson } from '@/lib/use-public-json';
import TopicCloudMasthead from './TopicCloudMasthead';
import TopicMethod from './TopicMethod';

/** Each ranking's page, title and the words under it. */
export const TOPIC_VIEWS: Record<TopicOrder, { path: string; tab: string; title: string; line: string }> = {
  blogs: { path: '/topics/', tab: '大家在寫', title: '大家正在寫什麼', line: '最多部落格在寫的話題' },
  heat: { path: '/topics/trending/', tab: '正在升溫', title: '正在升溫的話題', line: '比平常明顯變多的話題' },
};
const periodHref = (order: TopicOrder, days: Period) => `${TOPIC_VIEWS[order].path}${days === TOPICS_PERIOD ? '' : `?days=${days}`}`;

// The ranking comes first; how it is computed and the vocabulary's full record
// sit in this page's 資料來源與計算方式 (TopicMethod), closed until asked for.
export default function TopicRankingView({
  order,
  days,
  load,
  visuals = [],
}: {
  order: TopicOrder;
  days: Period;
  load: PublicLoad<Topics>;
  /** tag.observe.tw's pictures for cloud words (lib/tag-visuals.ts), read on the server. */
  visuals?: Array<[string, CloudVisual]>;
}) {
  const data = load.status === 'ready' ? load.data : null;
  const view = TOPIC_VIEWS[order];
  const line = `近 ${days} 天${view.line}`;
  const words = data ? topicCloudWords(data.items, days, 30, new Map(visuals)) : [];
  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTabs
          label="話題排行"
          tabs={(['blogs', 'heat'] as const).map((o) => ({ href: periodHref(o, days), label: TOPIC_VIEWS[o].tab, current: o === order }))}
        />
        <FilterChips
          label="話題期間"
          items={PERIODS.map((d) => ({ href: periodHref(order, d), label: `近 ${d} 天`, current: d === days }))}
        />
      </div>
      <TopicCloudMasthead
        title={view.title}
        line={
          <>
            {line} · <MethodLink />
          </>
        }
        lineText={`${line} · 資料來源與計算方式 ⓘ`}
        words={words}
        label={`近 ${days} 天${order === 'heat' ? '升溫' : '共同'}話題文字雲`}
      />
      {data ? (
        <TopicRows order={order} days={days} data={data} />
      ) : load.status === 'pending' ? (
        <p role="status" aria-busy="true" className="text-center text-zinc-500 dark:text-zinc-400">
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
              ranking={order}
              truncated={data.truncated ? `排行只顯示前 ${data.items.length} 項。` : undefined}
            />
          ) : null
        }
      />
    </div>
  );
}

type SortKey = 'rank' | 'blogs' | 'posts' | 'lift';

/** "title / body-only"; a title-only term's body side was never counted, so it shows — rather than 0. */
const splitText = (t: Topics['items'][number]) =>
  t.matchingReason && typeof t.titlePosts === 'number' ? `${t.titlePosts.toLocaleString('zh-TW')} / —` : matchSplit(t);

function TopicRows({ order, days, data }: { order: TopicOrder; days: Period; data: Topics }) {
  const liftTitle = liftExplanation(data.matchingPolicy?.frequency?.baselineDays);
  // The gateway's order is the ranking (blogs, or heat × breadth); a header re-sorts this page's rows only, and the rank stays.
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
              {order === 'heat' ? header('lift', '升溫倍率', table.num, liftTitle) : null}
              {header('blogs', '部落格', table.num)}
              {header('posts', '文章', table.num)}
              <th scope="col" className={table.num}>
                標題／僅正文
              </th>
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
                {order === 'heat' ? (
                  <td className={`${table.num}${t.lift == null ? ' text-xs text-zinc-500 dark:text-zinc-400' : ''}`} title={liftTitle}>
                    {formatLift(t.lift)}
                  </td>
                ) : null}
                <td className={table.num}>{t.blogs.toLocaleString('zh-TW')}</td>
                <td className={table.num}>{t.posts.toLocaleString('zh-TW')}</td>
                <td className={table.num} title={t.matchingReason ? matchingReasonLabel(t.matchingReason) : undefined}>
                  {splitText(t)}
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
export function TopicRankingFromUrl({
  order,
  baseline,
  visuals,
}: {
  order: TopicOrder;
  baseline: Topics | null;
  visuals: Array<[string, CloudVisual]>;
}) {
  const days = periodOf(useSearchParams(), TOPICS_PERIOD);
  // No server baseline (its read failed): the browser reads the 30-day ranking like the other periods.
  const load = usePublicJson(days === TOPICS_PERIOD && baseline ? null : topicsApiPath(days, order), parseTopics);
  return (
    <TopicRankingView
      order={order}
      days={days}
      load={load ?? (baseline ? { status: 'ready', data: baseline } : { status: 'pending' })}
      visuals={visuals}
    />
  );
}
