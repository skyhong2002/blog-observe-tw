'use client';

// One view for the prerendered 7-day relation map and the browser's ?days=30|90; see app/relations/page.tsx.

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import BlogIcon from '@/components/BlogIcon';
import BlogRelationGraph from '@/components/BlogRelationGraph';
import { filterChipClass, filterRowClass } from '@/components/FilterChips';
import FooterMethod, { methodHeading } from '@/components/FooterMethod';
import MethodLink from '@/components/MethodLink';
import Link from '@/components/NoPrefetchLink';
import PendingRows from '@/components/PendingRows';
import RelationTabs from '@/components/RelationTabs';
import { SectionUnavailable } from '@/components/SectionBoundary';
import SectionTabs from '@/components/SectionTabs';
import { taipei } from '@/lib/api';
import { blogLink } from '@/lib/page-links';
import { type Period, periodOf, RELATIONS_PERIOD, relationsApiPath } from '@/lib/public-query';
import { countText, type Relations, shareLabel, sharePercent } from '@/lib/relations';
import { asIs, type PublicLoad, usePublicJson } from '@/lib/use-public-json';

export default function RelationMapView({ days, load }: { days: Period; load: PublicLoad<Relations> }) {
  return (
    <div className="space-y-5 pb-8">
      {/* Same top row as the topic rankings: the section's tabs on the left, the period on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RelationTabs current="relations" className="" />
        <SectionTabs
          label="觀察期間"
          tabs={[7, 30, 90].map((d) => ({ href: `/relations/?days=${d}`, label: `近 ${d} 天`, current: String(d) === days }))}
        />
      </div>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">引用關係圖</h1>
        <p className="mt-1 text-[0.9375rem] text-zinc-700 dark:text-zinc-300">
          部落格在文章正文裡連到其他部落格，就是一次引用；箭頭指向被引用的一方。 <MethodLink />
        </p>
      </header>
      {load.status === 'ready' ? (
        <RelationDetails data={load.data} />
      ) : load.status === 'pending' ? (
        <>
          <p role="status" aria-busy="true" className="text-zinc-600 dark:text-zinc-400">
            正在載入近 {days} 天的關係資料…
          </p>
          {/* The same shape as the loaded page: the graph's frame, then the two ranking lists. */}
          <div
            aria-hidden="true"
            className="relative flex aspect-[4/3] max-h-[34rem] w-full items-center justify-center overflow-hidden rounded-xl border border-zinc-300 bg-white sm:aspect-[16/9] dark:border-zinc-800 dark:bg-zinc-900"
          >
            {[
              [22, 30, 5],
              [48, 44, 7],
              [70, 28, 4],
              [36, 68, 4],
              [62, 70, 5],
              [82, 56, 3],
              [14, 60, 3],
            ].map(([x, y, r]) => (
              <span
                key={`${x}-${y}`}
                className="absolute rounded-full bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800"
                style={{ left: `${x}%`, top: `${y}%`, width: `${r * 0.5}rem`, height: `${r * 0.5}rem` }}
              />
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <PendingRows rows={5} />
            <PendingRows rows={5} />
          </div>
        </>
      ) : (
        <SectionUnavailable label="關係資料" />
      )}
      <FooterMethod page notes={load.status === 'ready' ? <RelationNotes data={load.data} /> : null} />
    </div>
  );
}

const LIST_PREVIEW = 20;

/** Shows the rest of a long list in place; left out when the list is already short. */
function MoreButton({ total, open, onClick }: { total: number; open: boolean; onClick: () => void }) {
  if (total <= LIST_PREVIEW) return null;
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onClick}
      className="mt-2 inline-flex min-h-9 items-center rounded-full border border-zinc-300 px-3 text-xs text-zinc-700 hover:border-brand-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-brand-400"
    >
      {open ? '只看前 20 名' : `顯示全部 ${total} 筆`}
    </button>
  );
}

/** Narrower views of a dense period: links whose two blogs both mention each other, or links of 3+ articles. */
const GRAPH_VIEWS = [
  { key: 'all', label: '全部連結' },
  { key: 'mutual', label: '互相提及' },
  { key: 'repeat', label: '提及 3 篇以上' },
] as const;
type GraphView = (typeof GRAPH_VIEWS)[number]['key'];

/** The graph in one view; the lists below always cover the whole period. */
function graphFor(data: Relations, view: GraphView) {
  if (view === 'all') return { nodes: data.nodes, edges: data.edges };
  const edges = data.edges.filter((e) => (view === 'mutual' ? e.mutual : e.count >= 3));
  const kept = new Set(edges.flatMap((e) => [e.sourceBlogId, e.targetBlogId]));
  return { nodes: data.nodes.filter((n) => kept.has(n.id)), edges };
}

function RelationDetails({ data }: { data: Relations }) {
  const [showAll, setShowAll] = useState({ most: false, mutual: false });
  const [view, setView] = useState<GraphView>('all');
  // A crowded map is unreadable (a phone sooner than a desktop): start on a narrower view that still has a real
  // network (3+ articles, else mutual mentions, each kept only with enough blogs); the chips switch back.
  useEffect(() => {
    const phone = window.matchMedia('(max-width: 639px)').matches;
    if (data.nodes.length <= (phone ? 40 : 80)) return;
    const narrower = (['repeat', 'mutual'] as const).find((key) => graphFor(data, key).nodes.length >= (phone ? 8 : 12));
    if (narrower) setView(narrower);
  }, [data]);
  const graph = useMemo(() => graphFor(data, view), [data, view]);
  const nodes = new Map(data.nodes.map((n) => [n.id, n]));
  const name = (id: number) => nodes.get(id)?.name ?? `部落格 #${id}`;
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
      {data.edges.length > 0 && (
        <section className="space-y-3 rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className={`${filterRowClass} justify-between`}>
            <div role="group" aria-label="關係圖範圍" className={filterRowClass}>
              {GRAPH_VIEWS.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  aria-pressed={view === v.key}
                  onClick={() => setView(v.key)}
                  className={filterChipClass(view === v.key)}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <span role="status" className="text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
              {graph.nodes.length} 個部落格 · {graph.edges.length} 條連結
            </span>
          </div>
          <BlogRelationGraph nodes={graph.nodes} edges={graph.edges} />
        </section>
      )}
      {/* min-w-0: a grid item is otherwise as wide as its widest row, and two long chips pushed the page sideways. */}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-zinc-300 p-4 dark:border-zinc-800">
          <h2 className="font-semibold">最常被提及</h2>
          <ol className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            {(showAll.most ? data.mostMentioned : data.mostMentioned.slice(0, LIST_PREVIEW)).map((r, i) => (
              // Phones: the counts drop under the name, so the name keeps the row's width instead of a "…".
              <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm sm:flex-nowrap" key={r.blogId}>
                <span className="w-6 shrink-0 text-right text-sm font-medium tabular-nums text-zinc-600 dark:text-zinc-400">{i + 1}</span>
                <span className="min-w-0 flex-1">{chip(r.blogId)}</span>
                <span className="w-full shrink-0 pl-9 text-sm tabular-nums text-zinc-700 sm:w-auto sm:pl-0 dark:text-zinc-300">
                  {r.incomingBlogs} 個部落格提及 · {r.mentions} 篇
                </span>
              </li>
            ))}
          </ol>
          <MoreButton total={data.mostMentioned.length} open={showAll.most} onClick={() => setShowAll((s) => ({ ...s, most: !s.most }))} />
        </section>
        <section className="min-w-0 rounded-xl border border-zinc-300 p-4 dark:border-zinc-800">
          <h2 className="font-semibold">互相提及</h2>
          {/* Same pills as the homepage's citation cards. Each direction is its own articles and dates (see the foot's
              引用與交流), so the counts stay per direction and the pair is never called a same-time exchange. */}
          <ol className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            {(showAll.mutual ? data.mutual : data.mutual.slice(0, LIST_PREVIEW)).map((r) => (
              <li className="py-2.5" key={`${r.sourceBlogId}:${r.targetBlogId}`}>
                {/* Chips wrap rather than cut a name short; the arrows read from the first chip to the second. */}
                <p className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {chip(r.sourceBlogId)}
                  <span aria-hidden="true" className="text-xs text-zinc-500">
                    ⇄
                  </span>
                  <span className="sr-only">與</span>
                  {chip(r.targetBlogId)}
                </p>
                <p className="mt-1 text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
                  <span title={`${name(r.sourceBlogId)} 提及 ${name(r.targetBlogId)}`}>
                    <span aria-hidden="true">→</span>
                    <span className="sr-only">{name(r.sourceBlogId)} 提及對方</span> {r.forwardCount} 篇
                  </span>
                  <span aria-hidden="true"> · </span>
                  <span title={`${name(r.targetBlogId)} 提及 ${name(r.sourceBlogId)}`}>
                    <span aria-hidden="true">←</span>
                    <span className="sr-only">{name(r.targetBlogId)} 提及對方</span> {r.reverseCount} 篇
                  </span>
                </p>
              </li>
            ))}
          </ol>
          <MoreButton total={data.mutual.length} open={showAll.mutual} onClick={() => setShowAll((s) => ({ ...s, mutual: !s.mutual }))} />
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
      <p>
        關係圖上方的「互相提及」只畫兩個方向都有正文提及的連結，「提及 3 篇以上」只畫同一方向有 3
        篇以上文章的連結；最常被提及、互相提及與連結明細仍涵蓋整段期間。
      </p>
      <p>文章依每日預算逐批分析；這段期間沒有可確認的提及時，關係圖、最常被提及與互相提及留白，不代表各站之間沒有連結。</p>
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
      <p>
        {taipei(data.generatedAt)} 計算。關係圖每 5
        分鐘重新計算一次，所以新文章最多晚幾分鐘才出現；已撤回或隱藏的部落格、文章與連結在下一次讀取就不再顯示。已收錄資料的連結觀測不代表實際造訪來源或完整網路關係。
      </p>
    </>
  );
}

// public-contracts.ts has checked nodes, edges, rankings and coverage; an empty period is a valid answer.
const parseRelations = asIs<Relations>;

/** app/relations/loading.tsx: this page's own pending view for the URL's period while the server reads. */
export function RelationMapLoading() {
  return <RelationMapView days={periodOf(useSearchParams(), RELATIONS_PERIOD)} load={{ status: 'pending' }} />;
}

/** Reads ?days= (inside the page's Suspense boundary); periods other than the prerendered one come from /api/relations. */
export function RelationMapFromUrl({ baseline }: { baseline: Relations | null }) {
  const days = periodOf(useSearchParams(), RELATIONS_PERIOD);
  // No server baseline (its read failed): the browser reads the 7-day map like the other periods.
  const load = usePublicJson(days === RELATIONS_PERIOD && baseline ? null : relationsApiPath(days), parseRelations);
  return <RelationMapView days={days} load={load ?? (baseline ? { status: 'ready', data: baseline } : { status: 'pending' })} />;
}
