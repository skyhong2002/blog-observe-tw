import Link from 'next/link';
import ArticleListItem from '@/components/ArticleListItem';
import SectionTabs from '@/components/SectionTabs';
import { type Blog, gateway, overview, type Post, type Tag } from '@/lib/api';
export const dynamic = 'force-dynamic';
export default async function TagsPage({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
  const { tag } = await searchParams;
  const data = await overview();
  const detail = tag ? await gateway<{ tag: Tag; posts: Post[]; blogs: Blog[] }>(`/api/tags/${encodeURIComponent(tag)}`) : null;
  const selected = detail?.tag;
  return (
    <div className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">{selected ? `${selected.label} · 標籤` : '標籤與主題'}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          從部落格與文章標籤探索不同作者的書寫。人工與社群標籤保留來源，與爬蟲標籤分開記錄。
        </p>
      </header>
      <SectionTabs
        label="文章瀏覽"
        tabs={[
          { href: '/articles/', label: '最新文章' },
          { href: '/tags/', label: '標籤與主題', current: true },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        {data.tags.map((t) => (
          <Link
            key={t.slug}
            href={`/tags/?tag=${encodeURIComponent(t.slug)}`}
            aria-current={t.slug === tag ? 'page' : undefined}
            className={`rounded-lg border px-3 py-2 text-sm ${t.slug === tag ? 'border-brand-600 text-brand-700 dark:text-brand-400' : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400'}`}
          >
            {t.label}
            <span className="ml-2 text-xs text-zinc-500">
              {t.postCount} 篇 · {t.blogCount} 站
            </span>
          </Link>
        ))}
      </div>
      {selected && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">相關文章與部落格</h2>
          {detail ? (
            <>
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {detail.posts?.map((post) => (
                  <ArticleListItem key={post.id ?? post.url} post={post} />
                ))}
              </ul>
              <ul className="mt-4 space-y-2">
                {detail.blogs?.map((blog) => (
                  <li key={blog.slug}>
                    <Link href={`/blogs/${blog.slug}/`} className="text-brand-700 hover:underline dark:text-brand-400">
                      {blog.name}
                    </Link>
                  </li>
                ))}
              </ul>
              {!detail.posts?.length && !detail.blogs?.length && <p className="py-8 text-zinc-500">此標籤目前沒有公開文章或部落格。</p>}
            </>
          ) : (
            <p className="py-8 text-zinc-500">標籤文章暫時無法載入，請稍後再試。</p>
          )}
        </section>
      )}
      {tag && !detail && (
        <p role="status" className="py-8 text-zinc-500">
          找不到此公開標籤，或暫時無法載入。請回到標籤列表重試。
        </p>
      )}
      {!data.tags.length && <p className="py-8 text-zinc-500">標籤資料整理中。</p>}
    </div>
  );
}
