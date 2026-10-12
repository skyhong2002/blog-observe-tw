'use client';
// One view for a prerendered (on demand) 30-day topic page and the browser's ?days=7|90; see app/topics/[id]/page.tsx.

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import BlogIcon from '@/components/BlogIcon';
import SectionTabs from '@/components/SectionTabs';
import VocabularyNotice from '@/components/VocabularyNotice';
import { taipei } from '@/lib/api';
import { type Period, periodOf, TOPICS_PERIOD, topicApiPath } from '@/lib/public-query';
import type { TopicDetail } from '@/lib/topics';
import { asIs, type PublicLoad, usePublicJson } from '@/lib/use-public-json';

/** `label` titles the page while another period loads (the topic itself does not change). */
export default function TopicDetailView({
  id,
  days,
  load,
  label,
}: {
  id: string;
  days: Period;
  load: PublicLoad<TopicDetail>;
  label?: string;
}) {
  const data = load.status === 'ready' ? load.data : null;
  return (
    <div className="space-y-5 pb-8">
      <Link href="/topics/" className="text-sm text-brand-700 dark:text-brand-400">
        ← 話題排行
      </Link>
      <h1 className="text-2xl font-semibold">
        {data?.topic?.label ?? (load.status === 'pending' ? label : undefined) ?? '話題資料尚未備妥'}
      </h1>
      <SectionTabs
        label="話題期間"
        tabs={[7, 30, 90].map((d) => ({
          href: `/topics/${encodeURIComponent(id)}/?days=${d}`,
          label: `近 ${d} 天`,
          current: String(d) === days,
        }))}
      />
      {data?.topic ? (
        <>
          <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
            <section className="rounded-xl border border-zinc-300 p-4 dark:border-zinc-800">
              <h2 className="font-semibold">哪些部落格在寫</h2>
              <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
                {data.blogs.map((b) => (
                  <li key={b.id} className="flex justify-between gap-3 py-3 text-sm">
                    <Link className="flex items-center gap-2 text-brand-700 dark:text-brand-400" href={`/blogs/${b.slug}/`}>
                      <BlogIcon media={b.slug} title={b.name} size={18} />
                      {b.name}
                    </Link>
                    <span className="shrink-0">{b.posts} 篇</span>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h2 className="font-semibold">相關文章</h2>
              <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
                {data.articles.map((a) => (
                  <li className="py-4" key={a.id}>
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:text-brand-700 dark:hover:text-brand-400"
                    >
                      {a.title}
                    </a>
                    <p className="mt-2 text-xs text-zinc-500">
                      <Link href={`/blogs/${a.blogSlug}/`}>{a.blogName}</Link> · {taipei(a.publishedAt)}
                    </p>
                  </li>
                ))}
              </ul>
              {!data.articles.length ? <p className="py-6 text-zinc-500">此期間尚無已比對文章。</p> : null}
            </section>
          </div>
          <VocabularyNotice data={data.vocabulary} />
          {data.truncated ? <p className="text-xs text-zinc-500">僅顯示部分來源與文章。</p> : null}
        </>
      ) : load.status === 'pending' ? (
        <p role="status" aria-busy="true" className="text-sm text-zinc-500">
          正在載入近 {days} 天的話題資料…
        </p>
      ) : (
        <p className="text-sm text-zinc-500">目前無法讀取此話題，可能尚未完成同步或不在目前詞庫版本。</p>
      )}
    </div>
  );
}

// public-contracts.ts requires topic (id, label), blogs, articles and vocabulary: {} or a null topic is an error, not a page.
const parseDetail = asIs<TopicDetail>;

/** Reads ?days= (inside the page's Suspense boundary); periods other than the prerendered one come from /api/topics/:id. */
export function TopicDetailFromUrl({ id, baseline }: { id: string; baseline: PublicLoad<TopicDetail> }) {
  const days = periodOf(useSearchParams(), TOPICS_PERIOD);
  const load = usePublicJson(days === TOPICS_PERIOD ? null : topicApiPath(id, days), parseDetail);
  const label = baseline.status === 'ready' ? baseline.data.topic?.label : undefined;
  return <TopicDetailView id={id} days={days} load={load ?? baseline} label={label} />;
}
