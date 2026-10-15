'use client';

// One view for a prerendered (on demand) 30-day topic page and the browser's ?days=7|90; see app/topics/[id]/page.tsx.
// A period without articles shows the topic's history (past matches) instead, when the payload has one.

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import BlogIcon from '@/components/BlogIcon';
import FooterMethod from '@/components/FooterMethod';
import Link from '@/components/NoPrefetchLink';
import SectionTabs from '@/components/SectionTabs';
import { VocabularySummary } from '@/components/VocabularyNotice';
import { displayTitle, taipei } from '@/lib/api';
import { externalHref } from '@/lib/images';
import { blogLink, TOPIC_DETAIL_PERIOD, topicHref, topicLink } from '@/lib/page-links';
import { isHistoryCursor, type Period, periodOf, topicApiPath } from '@/lib/public-query';
import { sharedLabelsView } from '@/lib/shared-labels';
import {
  evidenceLabel,
  exclusionReasonLabel,
  historyRows,
  historySummary,
  inactiveReasonLabel,
  matchingReasonLabel,
  recorded,
  type TopicDetail,
  type TopicHistory,
  topicArticleMode,
} from '@/lib/topics';
import { asIs, type PublicLoad, usePublicJson } from '@/lib/use-public-json';
import SharedTopicLabels from './SharedTopicLabels';
import TopicMethod from './TopicMethod';

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

/** The original article, with SourceLink's open_original marker; a non-http(s) URL stays plain text. */
function ArticleTitle({ url, title: raw }: { url: string; title: string }) {
  const title = displayTitle(raw);
  const href = externalHref(url);
  if (!href) return <span className="font-medium">{title}</span>;
  return (
    <a
      href={href}
      data-analytics="open_original"
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium hover:text-brand-700 dark:hover:text-brand-400"
    >
      {title}
    </a>
  );
}

/** On phones the blog list comes after up to 100 articles; this link reaches it without the long scroll. */
function TopicBlogsJump({ count }: { count: number }) {
  return count ? (
    <p className="text-sm lg:hidden">
      <a href="#topic-blogs" className="text-brand-700 hover:underline dark:text-brand-400">
        看哪些部落格在寫（{count} 個）↓
      </a>
    </p>
  ) : null;
}

/** Follows the articles in the markup (phones read articles first); the wide layout puts it in the left column. */
function TopicBlogs({ blogs }: { blogs: TopicDetail['blogs'] }) {
  return (
    <section id="topic-blogs" className="scroll-mt-20 rounded-xl border border-zinc-300 p-4 lg:order-first dark:border-zinc-800">
      <h2 className="font-semibold">哪些部落格在寫</h2>
      <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
        {blogs.map((b) => (
          <li key={b.id} className="flex justify-between gap-3 py-3 text-sm">
            <Link className="flex items-center gap-2 text-brand-700 dark:text-brand-400" {...blogLink(b.slug, b.canonicalPath)}>
              <BlogIcon media={b.slug} title={b.name} size={18} />
              {b.name}
            </Link>
            <span className="shrink-0 tabular-nums">
              {b.posts} 篇
              {typeof b.titlePosts === 'number' && typeof b.bodyOnlyPosts === 'number' ? (
                <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400">
                  （標題 {b.titlePosts}／僅正文 {b.bodyOnlyPosts}）
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One page of past matches: original title, blog, publish time and how the match stands now. */
function HistoryList({ history }: { history: Pick<TopicHistory, 'articles'> }) {
  return (
    <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {historyRows(history).map((a) => (
        <li className="py-4" key={a.id}>
          <ArticleTitle url={a.url} title={a.title} />
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            <Link {...blogLink(a.blogSlug, a.blogCanonicalPath)}>{a.blogName}</Link>
            {a.publishedAt ? ` · ${taipei(a.publishedAt)}` : null}
          </p>
          <p
            className={`mt-1 text-xs ${a.evidenceState === 'pending' ? 'font-medium text-zinc-700 dark:text-zinc-300' : 'text-zinc-500 dark:text-zinc-400'}`}
          >
            {evidenceLabel(a.evidenceState, taipei(a.observedAt))}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * The next history page, read only when asked for: the same stable-id topic
 * read with historyCursor. A cursor the path rules could not carry is reported,
 * not dropped.
 */
function HistoryMore({ id, days, cursor }: { id: string; days: Period; cursor: string }) {
  const [open, setOpen] = useState(false);
  const usable = isHistoryCursor(cursor);
  const load = usePublicJson(open && usable ? topicApiPath(id, days, cursor) : null, parseDetail);
  if (!usable) return <p className="py-4 text-xs text-zinc-500 dark:text-zinc-400">還有更多歷史文章，但目前無法載入下一頁。</p>;
  if (!open || !load) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-2 text-sm text-brand-700 hover:underline dark:text-brand-400">
        載入更多歷史文章
      </button>
    );
  }
  if (load.status === 'pending') {
    return (
      <p role="status" aria-busy="true" className="py-4 text-sm text-zinc-500 dark:text-zinc-400">
        正在載入更多歷史文章…
      </p>
    );
  }
  const page = load.status === 'ready' ? load.data.history : undefined;
  if (!page) {
    return (
      <p className="py-4 text-sm text-zinc-500 dark:text-zinc-400">
        無法載入更多歷史文章。
        <button type="button" onClick={() => setOpen(false)} className="ml-1 text-brand-700 hover:underline dark:text-brand-400">
          稍後再試
        </button>
      </p>
    );
  }
  return (
    <>
      <HistoryList history={page} />
      {page.nextCursor ? <HistoryMore id={id} days={days} cursor={page.nextCursor} /> : null}
    </>
  );
}

/** The period has no articles: say so, then the articles this topic matched before. */
function TopicHistorySection({ id, days, history }: { id: string; days: Period; history: TopicHistory }) {
  const summary = historySummary(history);
  return (
    <section>
      <h2 className="font-semibold">過去觀測到的文章</h2>
      <p role="note" className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        近 {days} 天沒有新的相關文章。以下是過去曾比對到這個詞的文章，只列原站標題與連結；標示「待重新確認」的文章不代表目前仍命中。
      </p>
      {summary || history.lastObservedAt ? (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {[summary, history.lastObservedAt ? `最近觀測：${taipei(history.lastObservedAt)}` : ''].filter(Boolean).join(' · ')}
        </p>
      ) : null}
      <div className="mt-3">
        <HistoryList history={history} />
        {/* Keyed by period so a period change starts from its own first page. */}
        {history.nextCursor ? <HistoryMore key={`${days}:${history.nextCursor}`} id={id} days={days} cursor={history.nextCursor} /> : null}
      </div>
    </section>
  );
}

/**
 * `id` is the stable topic id every API read uses; `path` the page's canonical
 * (readable) URL, for the period tabs. `label` titles the page while another
 * period loads (the topic itself does not change).
 */
export default function TopicDetailView({
  id,
  path,
  days,
  load,
  label,
}: {
  id: string;
  path: string;
  days: Period;
  load: PublicLoad<TopicDetail>;
  label?: string;
}) {
  const data = load.status === 'ready' ? load.data : null;
  // Only a matched topic shows the shared-label block, so only then do its notes join the method block.
  const shared =
    data?.topic && !data.topic.excludedReason && !data.topic.inactiveReason ? sharedLabelsView(data.sharedLabels, data.topic.label) : null;
  // Articles (or the history fallback) come first; how they were matched and the
  // vocabulary's full record sit in the page's 資料來源與計算方式, closed until asked for.
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
      {data?.topic?.excludedReason ? (
        <>
          <section role="status" className="rounded-xl border border-zinc-300 p-4 text-sm dark:border-zinc-800">
            <h2 className="font-semibold">此詞不參與話題比對</h2>
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">
              原因：{exclusionReasonLabel(data.topic.excludedReason)}
              。這個詞仍保留在來源資料中，但不會用來比對文章，所以這裡沒有部落格與文章。
            </p>
          </section>
          <VocabularySummary data={data.vocabulary} />
        </>
      ) : data?.topic?.inactiveReason ? (
        <>
          <section role="status" className="rounded-xl border border-zinc-300 p-4 text-sm dark:border-zinc-800">
            <h2 className="font-semibold">此詞暫未參與比對</h2>
            <p className="mt-2 text-zinc-600 dark:text-zinc-400">
              原因：{inactiveReasonLabel(data.topic.inactiveReason)}
              。這不代表它是雜訊：完整的詞仍保留在詞庫中可查，只是本次比對未納入，所以這裡沒有部落格與文章。
            </p>
            {sourceActivity(data.topic) ? (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{sourceActivity(data.topic)}</p>
            ) : null}
          </section>
          <VocabularySummary data={data.vocabulary} />
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
            <p role="note" className="text-sm text-zinc-600 dark:text-zinc-400">
              {matchingReasonLabel(data.topic.matchingReason)}：排行與升溫倍率只計標題命中。
            </p>
          ) : null}
          <TopicBlogsJump count={data.blogs.length} />
          {topicArticleMode(data) === 'history' && data.history ? (
            <div className={data.blogs.length ? 'grid gap-5 lg:grid-cols-[1fr_2fr]' : undefined}>
              <TopicHistorySection id={id} days={days} history={data.history} />
              {data.blogs.length ? <TopicBlogs blogs={data.blogs} /> : null}
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
              <section>
                <h2 className="font-semibold">相關文章</h2>
                <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
                  {data.articles.map((a) => (
                    <li className="py-4" key={a.id}>
                      <ArticleTitle url={a.url} title={a.title} />
                      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                        <Link {...blogLink(a.blogSlug, a.blogCanonicalPath)}>{a.blogName}</Link> · {taipei(a.publishedAt)}
                      </p>
                    </li>
                  ))}
                </ul>
                {!data.articles.length ? <p className="py-6 text-zinc-500 dark:text-zinc-400">此期間尚無已比對文章。</p> : null}
              </section>
              <TopicBlogs blogs={data.blogs} />
            </div>
          )}
          {data.truncated ? <p className="text-xs text-zinc-500 dark:text-zinc-400">僅顯示部分來源與文章。</p> : null}
          <SharedTopicLabels value={data.sharedLabels} tag={data.topic.label} />
          <VocabularySummary data={data.vocabulary} />
        </>
      ) : load.status === 'gone' ? (
        <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">
          此話題的文章比對證據已全部撤銷，不再提供內容。
        </p>
      ) : load.status === 'pending' ? (
        <p role="status" aria-busy="true" className="text-sm text-zinc-500 dark:text-zinc-400">
          正在載入近 {days} 天的話題資料…
        </p>
      ) : (
        <p role="alert" className="text-sm text-zinc-700 dark:text-zinc-300">
          目前無法讀取此話題，可能尚未完成同步或不在目前詞庫版本。
        </p>
      )}
      <FooterMethod
        page
        notes={
          data ? (
            <TopicMethod
              vocabulary={data.vocabulary}
              matchingPolicy={data.matchingPolicy}
              matchingReason={data.topic?.matchingReason}
              sharedLabels={shared}
            />
          ) : null
        }
      />
    </div>
  );
}

// public-contracts.ts requires topic (id, label), blogs, articles and vocabulary: {} or a null topic is an error, not a page.
const parseDetail = asIs<TopicDetail>;

/**
 * Reads ?days= (inside the page's Suspense boundary); periods other than the
 * prerendered 30 days come from /api/topics/:id, always by the stable id.
 */
export function TopicDetailFromUrl({ id, path, baseline }: { id: string; path: string; baseline: PublicLoad<TopicDetail> }) {
  const days = periodOf(useSearchParams(), TOPIC_DETAIL_PERIOD);
  const load = usePublicJson(days === TOPIC_DETAIL_PERIOD ? null : topicApiPath(id, days), parseDetail);
  const label = baseline.status === 'ready' ? baseline.data.topic?.label : undefined;
  return <TopicDetailView id={id} path={path} days={days} load={load ?? baseline} label={label} />;
}
