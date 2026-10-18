import { topicLink } from '@/lib/page-links';
import { publicJsonOrNull } from '@/lib/public-api';
import { BLOG_TOPICS_PERIOD, blogTopicsApiPath } from '@/lib/public-query';
import type { Topics } from '@/lib/topics';
import Link from './NoPrefetchLink';
// Same 90-day path as BlogTopicCloud: one per-request read for the list and the profile's word cloud.
export default async function BlogTopics({ slug }: { slug: string }) {
  const data = await publicJsonOrNull<Topics>(blogTopicsApiPath(slug));
  return (
    <section className="mt-8 space-y-3">
      <h2 className="text-lg font-semibold">最近常寫的話題</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        近 90 天文章標題或正文出現的共同關鍵字；是文章內容線索，不是作者身分分類。RSS 自訂分類保留為原始資料，不另列話題。
      </p>
      {!data ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">話題資料暫時無法讀取，請稍後再試。</p>
      ) : data.items.length ? (
        <ul className="flex flex-wrap gap-2">
          {data.items.slice(0, 20).map((t) => (
            <li key={t.id}>
              <Link
                {...topicLink(t.id, t.canonicalPath, BLOG_TOPICS_PERIOD)}
                className="inline-flex rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {t.label} · {t.posts} 篇
                <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">{t.source === 'rss-category' ? 'RSS' : '共同詞彙'}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">此期間尚無可列出的話題。</p>
      )}
    </section>
  );
}
