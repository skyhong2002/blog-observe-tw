import Link from 'next/link';
import { publicJsonOrNull } from '@/lib/public-api';
import type { Topics } from '@/lib/topics';
export default async function BlogTopics({ slug }: { slug: string }) {
  const data = await publicJsonOrNull<Topics>(`/api/blogs/${encodeURIComponent(slug)}/topics?days=90`);
  return (
    <section className="mt-8 space-y-3">
      <h2 className="text-lg font-semibold">最近常寫的話題</h2>
      <p className="text-sm text-zinc-500">近 90 天文章的 RSS 標籤與共同關鍵字；是文章內容線索，不是作者身分分類。</p>
      {!data ? (
        <p className="text-sm text-zinc-500">話題資料暫時無法讀取，請稍後再試。</p>
      ) : data.items.length ? (
        <ul className="flex flex-wrap gap-2">
          {data.items.slice(0, 20).map((t) => (
            <li key={t.id}>
              <Link
                href={`/topics/${encodeURIComponent(t.id)}/?days=90`}
                className="inline-flex rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {t.label} · {t.posts} 篇
                <span className="ml-2 text-xs text-zinc-500">{t.source === 'rss-category' ? 'RSS' : '共同詞彙'}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">此期間尚無可列出的話題。</p>
      )}
      {data && (data.items.length > 20 || data.truncated) ? <p className="text-xs text-zinc-500">此處顯示前 20 個話題。</p> : null}
    </section>
  );
}
