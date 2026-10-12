'use client';
// One view for a prerendered (on demand) 90-day topic page and the browser's ?days=7|30; see app/topics/[id]/page.tsx.

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import BlogIcon from '@/components/BlogIcon';
import SectionTabs from '@/components/SectionTabs';
import VocabularyNotice from '@/components/VocabularyNotice';
import { taipei } from '@/lib/api';
import { blogLink, TOPIC_DETAIL_PERIOD, topicHref, topicLink } from '@/lib/page-links';
import { type Period, periodOf, topicApiPath } from '@/lib/public-query';
import {
  exclusionReasonLabel,
  formatPercent,
  inactiveReasonLabel,
  matchingPolicyText,
  matchingReasonLabel,
  recorded,
  type TopicDetail,
} from '@/lib/topics';
import { asIs, type PublicLoad, usePublicJson } from '@/lib/use-public-json';

/** Source article count and last observed post, omitting whichever the payload did not record. */
function sourceActivity(topic: NonNullable<TopicDetail['topic']>) {
  const posts = recorded(topic.articleCount);
  return [
    posts === null ? '' : `來源文章數：${posts.toLocaleString('zh-TW')} 篇`,
    topic.lastPublishedAt ? `最近觀測發文：${taipei(topic.lastPublishedAt)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Threshold and baseline period behind a title-only term, from whichever the payload recorded. */
function frequencyBasis(data: TopicDetail) {
  const baseline = data.vocabulary.frequencyBaseline;
  const ratio = data.matchingPolicy?.frequency?.highFrequencyRatio ?? baseline?.thresholdRatio;
  const period = baseline
    ? `${taipei(baseline.since)} 至 ${taipei(baseline.until)}`
    : `近 ${data.matchingPolicy?.frequency?.baselineDays ?? 365} 天`;
  return `門檻：基準期間命中文章占比超過 ${formatPercent(ratio)}。基準期間：${period}。`;
}

/**
 * `id` is the stable topic id every API read uses; `path` the page's canonical
 * (readable) URL, for the period tabs. `label` titles the page while another
 * period loads (the topic itself does not change). `note` explains a noindex
 * page with its 90-day counts, separate from the period tab's counts.
 */
export default function TopicDetailView({
  id,
  path,
  days,
  load,
  label,
  note,
}: {
  id: string;
  path: string;
  days: Period;
  load: PublicLoad<TopicDetail>;
  label?: string;
  note?: string | null;
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
        tabs={(['7', '30', '90'] as const).map((d) => ({
          href: topicHref(id, path, d),
          label: `近 ${d} 天`,
          current: d === days,
        }))}
      />
      {note ? <p className="text-xs text-zinc-500">{note}</p> : null}
      {data?.topic?.excludedReason ? (
        <>
          <section role="status" className="rounded-xl border border-zinc-300 p-4 text-sm dark:border-zinc-800">
            <h2 className="font-semibold">此詞不參與話題比對</h2>
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">
              原因：{exclusionReasonLabel(data.topic.excludedReason)}
              。這個詞仍保留在來源資料中，但不會用來比對文章，所以這裡沒有部落格與文章。
            </p>
          </section>
          <VocabularyNotice data={data.vocabulary} />
        </>
      ) : data?.topic?.inactiveReason ? (
        <>
          <section role="status" className="rounded-xl border border-zinc-300 p-4 text-sm dark:border-zinc-800">
            <h2 className="font-semibold">此詞暫未參與比對</h2>
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">
              原因：{inactiveReasonLabel(data.topic.inactiveReason)}
              。這不代表它是雜訊：完整的詞仍保留在詞庫中可查，只是本次比對未納入，所以這裡沒有部落格與文章。
            </p>
            {sourceActivity(data.topic) ? <p className="mt-1 text-xs text-zinc-500">{sourceActivity(data.topic)}</p> : null}
          </section>
          <VocabularyNotice data={data.vocabulary} />
        </>
      ) : data?.topic ? (
        <>
          {data.topic.canonicalId && data.topic.canonicalId !== data.topic.id ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {data.topic.source === 'rss-category' ? '此 RSS 標籤對應到共同關鍵字' : '這個寫法已與只差在大小寫或全半形的寫法合併為'}「
              <Link className="text-brand-700 hover:underline dark:text-brand-400" {...topicLink(data.topic.canonicalId, undefined, days)}>
                {data.topic.label}
              </Link>
              」，以下為合併後的結果。
            </p>
          ) : null}
          {data.topic.matchingReason ? (
            <section role="note" className="rounded-xl border border-zinc-300 p-4 text-sm dark:border-zinc-800">
              <h2 className="font-semibold">{matchingReasonLabel(data.topic.matchingReason)}</h2>
              <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                這個詞在長期文章中出現得很普遍，排行與升溫倍率只計標題命中；正文命中仍留在頻率統計，詞也沒有從詞庫刪除。
              </p>
              <p className="mt-1 text-xs text-zinc-500">{frequencyBasis(data)}</p>
            </section>
          ) : null}
          <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
            <section className="rounded-xl border border-zinc-300 p-4 dark:border-zinc-800">
              <h2 className="font-semibold">哪些部落格在寫</h2>
              <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
                {data.blogs.map((b) => (
                  <li key={b.id} className="flex justify-between gap-3 py-3 text-sm">
                    <Link className="flex items-center gap-2 text-brand-700 dark:text-brand-400" {...blogLink(b.slug, b.canonicalPath)}>
                      <BlogIcon media={b.slug} title={b.name} size={18} />
                      {b.name}
                    </Link>
                    <span className="shrink-0 tabular-nums">
                      {b.posts} 篇
                      {typeof b.titlePosts === 'number' && typeof b.bodyOnlyPosts === 'number' ? (
                        <span className="ml-1 text-xs text-zinc-500">
                          （標題 {b.titlePosts}／僅正文 {b.bodyOnlyPosts}）
                        </span>
                      ) : null}
                    </span>
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
                      <Link {...blogLink(a.blogSlug, a.blogCanonicalPath)}>{a.blogName}</Link> · {taipei(a.publishedAt)}
                    </p>
                  </li>
                ))}
              </ul>
              {!data.articles.length ? <p className="py-6 text-zinc-500">此期間尚無已比對文章。</p> : null}
            </section>
          </div>
          <p className="text-xs text-zinc-500">{matchingPolicyText(data.matchingPolicy)}</p>
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

/**
 * Reads ?days= (inside the page's Suspense boundary); periods other than the
 * prerendered 90 days come from /api/topics/:id, always by the stable id.
 */
export function TopicDetailFromUrl({
  id,
  path,
  baseline,
  note,
}: {
  id: string;
  path: string;
  baseline: PublicLoad<TopicDetail>;
  note?: string | null;
}) {
  const days = periodOf(useSearchParams(), TOPIC_DETAIL_PERIOD);
  const load = usePublicJson(days === TOPIC_DETAIL_PERIOD ? null : topicApiPath(id, days), parseDetail);
  const label = baseline.status === 'ready' ? baseline.data.topic?.label : undefined;
  return <TopicDetailView id={id} path={path} days={days} load={load ?? baseline} label={label} note={note} />;
}
