import { topicLink } from '@/lib/page-links';
import { publicJsonOrNull } from '@/lib/public-api';
import { BLOG_TOPICS_PERIOD, blogTopicsApiPath } from '@/lib/public-query';
import type { Topics } from '@/lib/topics';
import Link from './NoPrefetchLink';
// Same 90-day path as BlogTopicCloud: one per-request read for the list and the profile's word cloud.
export default async function BlogTopics({ slug }: { slug: string }) {
  const data = await publicJsonOrNull<Topics>(blogTopicsApiPath(slug));
  // No topic data offered (the gateway's 404; a failed read throws) or none in the period: the section is left out.
  // What counts as a topic is in the footer's 部落格頁 block.
  if (!data?.items.length) return null;
  return (
    <section className="mt-8 space-y-3">
      <h2 className="text-lg font-semibold">最近常寫的話題</h2>
      {
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
      }
    </section>
  );
}
