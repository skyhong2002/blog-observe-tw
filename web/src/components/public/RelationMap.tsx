'use client';

// One view for the prerendered 90-day relation map and the browser's ?days=7|30; see app/relations/page.tsx.

import { useSearchParams } from 'next/navigation';
import BlogIcon from '@/components/BlogIcon';
import BlogRelationGraph from '@/components/BlogRelationGraph';
import FooterMethod, { methodHeading } from '@/components/FooterMethod';
import MethodLink from '@/components/MethodLink';
import Link from '@/components/NoPrefetchLink';
import SectionTabs from '@/components/SectionTabs';
import { taipei } from '@/lib/api';
import { blogLink } from '@/lib/page-links';
import { type Period, periodOf, RELATIONS_PERIOD, relationsApiPath } from '@/lib/public-query';
import { countText, type Relations, shareLabel, sharePercent } from '@/lib/relations';
import { asIs, type PublicLoad, usePublicJson } from '@/lib/use-public-json';

export default function RelationMapView({ days, load }: { days: Period; load: PublicLoad<Relations> }) {
  return (
    <div className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">部落格關係圖</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          誰在文章中提到誰 · <MethodLink />
        </p>
      </header>
      <SectionTabs
        label="觀察期間"
        tabs={[7, 30, 90].map((d) => ({ href: `/relations/?days=${d}`, label: `近 ${d} 天`, current: String(d) === days }))}
      />
      {load.status === 'ready' ? (
        <RelationDetails data={load.data} />
      ) : load.status === 'pending' ? (
        <p role="status" aria-busy="true" className="text-zinc-500">
          正在載入近 {days} 天的關係資料…
        </p>
      ) : (
        <p role="status">關係資料暫時無法讀取，請稍後再試。</p>
      )}
      <FooterMethod page notes={load.status === 'ready' ? <RelationNotes data={load.data} /> : null} />
    </div>
  );
}

function RelationDetails({ data }: { data: Relations }) {
  const nodes = new Map(data.nodes.map((n) => [n.id, n]));
  const blog = (id: number) => {
    const n = nodes.get(id);
    return n ? (
      // Icon and name stay on one line: the icon is an <img>, which the base styles make a block of its own.
      <Link
        className="inline-flex min-w-0 items-center gap-1.5 align-middle text-brand-700 hover:underline dark:text-brand-400"
        {...blogLink(n.slug, n.canonicalPath)}
      >
        <BlogIcon media={n.slug} iconUrl={n.iconUrl} title={n.name} size={16} />
        <span className="min-w-0 break-words">{n.name}</span>
      </Link>
    ) : (
      <span>部落格 #{id}</span>
    );
  };
  // The homepage's blog chip (home.module.css .mentionChip): icon and name in one bordered pill.
  const chip = (id: number) => {
    const n = nodes.get(id);
    return n ? (
      <Link
        className="inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-zinc-300 pr-2.5 pl-1.5 text-xs leading-none text-zinc-900 hover:border-brand-700 dark:border-zinc-800 dark:text-zinc-100 dark:hover:border-brand-400"
        {...blogLink(n.slug, n.canonicalPath)}
        title={n.name}
      >
        <BlogIcon media={n.slug} iconUrl={n.iconUrl} title={n.name} size={16} />
        <span className="min-w-0 truncate">{n.name}</span>
      </Link>
    ) : (
      <span className="text-xs">部落格 #{id}</span>
    );
  };
  return (
    <>
      <section className="rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        {data.edges.length ? (
          <BlogRelationGraph nodes={data.nodes} edges={data.edges} />
        ) : (
          <p className="py-16 text-center text-zinc-500">目前期間尚無可確認的正文提及。文章會依每日預算逐批分析。</p>
        )}
      </section>
      {/* min-w-0: a grid item is otherwise as wide as its widest row, and two long chips pushed the page sideways. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-zinc-300 p-4 dark:border-zinc-800">
          <h2 className="font-semibold">最常被提及</h2>
          <ol className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            {data.mostMentioned.map((r) => (
              <li className="flex items-center justify-between gap-4 py-2.5 text-sm" key={r.blogId}>
                {chip(r.blogId)}
                <span className="shrink-0 text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                  {r.incomingBlogs} 站 · {r.mentions} 篇
                </span>
              </li>
            ))}
          </ol>
          {!data.mostMentioned.length ? <p className="py-6 text-sm text-zinc-500">尚無足夠資料。</p> : null}
        </section>
        <section className="min-w-0 rounded-xl border border-zinc-300 p-4 dark:border-zinc-800">
          <h2 className="font-semibold">互相提及</h2>
          {/* Same pills as the homepage's citation cards. Each direction is its own articles and dates (see the foot's
              引用與交流), so the counts stay per direction and the pair is never called a same-time exchange. */}
          <ol className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            {data.mutual.map((r) => (
              <li className="py-2.5" key={`${r.sourceBlogId}:${r.targetBlogId}`}>
                <p className="flex min-w-0 items-center gap-1.5">
                  {chip(r.sourceBlogId)}
                  <span aria-hidden="true" className="text-xs text-zinc-500">
                    ⇄
                  </span>
                  <span className="sr-only">與</span>
                  {chip(r.targetBlogId)}
                </p>
                <p className="mt-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                  分別提及 {r.forwardCount}／{r.reverseCount} 篇
                </p>
              </li>
            ))}
          </ol>
          {!data.mutual.length ? <p className="py-6 text-sm text-zinc-500">這段期間尚未觀察到雙向提及。</p> : null}
        </section>
      </div>
      <details className="rounded-xl border border-zinc-300 p-4 dark:border-zinc-800">
        <summary className="cursor-pointer text-sm font-medium">圖中連結明細（{data.edges.length} 條）</summary>
        <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
          {data.edges.map((e) => (
            <li key={`${e.sourceBlogId}:${e.targetBlogId}`} className="min-w-0 break-words py-2 text-sm">
              {blog(e.sourceBlogId)} → {blog(e.targetBlogId)}{' '}
              <span className="whitespace-nowrap tabular-nums text-zinc-600 dark:text-zinc-400">
                · {e.count} 篇 · {shareLabel} {sharePercent(e.share)}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

/** This period's coverage, for the page's 本頁的資料來源與計算方式. */
function RelationNotes({ data }: { data: Relations }) {
  return (
    <>
      <h3 className={methodHeading}>這段期間的關係圖</h3>
      <p>
        每條線都是正文裡的直接連結，箭頭指向被提及的站。同篇文章重複連到同一站計一次；側欄、blogroll
        與留言不混入正文排行，共同標籤與文字相似也不畫成線。
        {data.coverage.graphTruncated ? '圖中只顯示部分節點與連結。' : ''}
      </p>
      <p>連結明細的「篇」是提及方提到目標站的文章數。</p>
      {data.coverage.aggregationTruncated ? <p>關係統計超過 10,000 條上限，排行僅呈現目前可載入的部分。</p> : null}
      {/* countText: a count the gateway did not send is 未提供, never 0. */}
      <p>
        未辨識正文 {countText(data.coverage.noBodyPosts)} 篇。另記 blogroll {countText(data.coverage.nonBodyLinks.blogroll)}、側欄{' '}
        {countText(data.coverage.nonBodyLinks.sidebar)}、留言 {countText(data.coverage.nonBodyLinks.comment)} 條，與正文分開。
      </p>
      <p>
        已分析 {countText(data.coverage.observedPosts)}／{countText(data.coverage.totalPosts)} 篇，抓取未成功{' '}
        {countText(data.coverage.failedPosts)} 篇；日期未知 {countText(data.coverage.unknownDatePosts)} 篇不列入期間排行。尚未辨識目標{' '}
        {countText(data.coverage.unresolvedLinks)} 條，解析達上限 {countText(data.coverage.truncatedPosts)} 篇。
      </p>
      <p>互相提及：期間內兩個方向都有正文提及；各自的文章日期可能相隔很久，不代表同時期互相回應。</p>
      <p>{taipei(data.generatedAt)} 計算。已收錄資料的連結觀測不代表實際造訪來源或完整網路關係。</p>
    </>
  );
}

// public-contracts.ts has checked nodes, edges, rankings and coverage; an empty period is a valid answer.
const parseRelations = asIs<Relations>;

/** Reads ?days= (inside the page's Suspense boundary); periods other than the prerendered one come from /api/relations. */
export function RelationMapFromUrl({ baseline }: { baseline: Relations }) {
  const days = periodOf(useSearchParams(), RELATIONS_PERIOD);
  const load = usePublicJson(days === RELATIONS_PERIOD ? null : relationsApiPath(days), parseRelations);
  return <RelationMapView days={days} load={load ?? { status: 'ready', data: baseline }} />;
}
