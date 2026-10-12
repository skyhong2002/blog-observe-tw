'use client';
// One view for the prerendered 90-day relation map and the browser's ?days=7|30; see app/relations/page.tsx.

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import BlogIcon from '@/components/BlogIcon';
import BlogRelationGraph from '@/components/BlogRelationGraph';
import SectionTabs from '@/components/SectionTabs';
import { taipei } from '@/lib/api';
import { type Period, periodOf, RELATIONS_PERIOD, relationsApiPath } from '@/lib/public-query';
import { type Relations, shareExplanation, shareLabel, sharePercent } from '@/lib/relations';
import { asIs, type PublicLoad, usePublicJson } from '@/lib/use-public-json';

export default function RelationMapView({ days, load }: { days: Period; load: PublicLoad<Relations> }) {
  return (
    <div className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">部落格關係圖</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          誰在文章中提到誰？沿著連結，認識彼此交流的部落格。計算引用與交流，不判斷抄襲或品質。
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
    </div>
  );
}

function RelationDetails({ data }: { data: Relations }) {
  const nodes = new Map(data.nodes.map((n) => [n.id, n]));
  const blog = (id: number) => {
    const n = nodes.get(id);
    return n ? (
      <Link className="min-w-0 break-words text-brand-700 hover:underline dark:text-brand-400" href={`/blogs/${n.slug}/`}>
        <BlogIcon media={n.slug} title={n.name} size={16} />
        <span className="ml-1.5">{n.name}</span>
      </Link>
    ) : (
      <span>部落格 #{id}</span>
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
        <p className="text-xs text-zinc-500">
          箭頭指向被提及的站。同篇文章重複連到同一站計一次，側欄、blogroll 與留言不混入正文排行。
          {data.coverage.graphTruncated ? '圖中只顯示部分節點與連結。' : ''}
        </p>
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-300 p-4 dark:border-zinc-800">
          <h2 className="font-semibold">最常被提及</h2>
          <ol className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            {data.mostMentioned.map((r) => (
              <li className="flex justify-between gap-4 py-3 text-sm" key={r.blogId}>
                {blog(r.blogId)}
                <span className="shrink-0 tabular-nums">
                  {r.incomingBlogs} 站 · {r.mentions} 篇
                </span>
              </li>
            ))}
          </ol>
          {!data.mostMentioned.length ? <p className="py-6 text-sm text-zinc-500">尚無足夠資料。</p> : null}
        </section>
        <section className="rounded-xl border border-zinc-300 p-4 dark:border-zinc-800">
          <h2 className="font-semibold">互相提及</h2>
          <ol className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
            {data.mutual.map((r) => (
              <li className="py-3 text-sm" key={`${r.sourceBlogId}:${r.targetBlogId}`}>
                <div>
                  {blog(r.sourceBlogId)} ↔ {blog(r.targetBlogId)}
                </div>
                <p className="mt-1 text-xs text-zinc-500">
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
        <p className="mt-3 text-xs text-zinc-500">「篇」是提及方提到目標站的文章數。{shareExplanation}</p>
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
      <footer className="space-y-2 text-xs text-zinc-500">
        {data.coverage.aggregationTruncated ? <p>關係統計超過 10,000 條上限，排行僅呈現目前可載入的部分。</p> : null}
        <p>
          未辨識正文 {data.coverage.noBodyPosts} 篇。另記 blogroll {data.coverage.nonBodyLinks.blogroll}、側欄{' '}
          {data.coverage.nonBodyLinks.sidebar}、留言 {data.coverage.nonBodyLinks.comment} 條，與正文分開。
        </p>
        <p>
          已分析 {data.coverage.observedPosts}／{data.coverage.totalPosts} 篇，抓取未成功 {data.coverage.failedPosts} 篇；日期未知{' '}
          {data.coverage.unknownDatePosts} 篇不列入期間排行。尚未辨識目標 {data.coverage.unresolvedLinks} 條，解析達上限{' '}
          {data.coverage.truncatedPosts} 篇。
        </p>
        <p>{taipei(data.generatedAt)} 計算。已收錄資料的連結觀測不代表實際造訪來源或完整網路關係。</p>
      </footer>
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
