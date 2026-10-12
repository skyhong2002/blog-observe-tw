import ArticleListItem from '@/components/ArticleListItem';
import SectionTabs from '@/components/SectionTabs';
import { overview } from '@/lib/api';
export const dynamic = 'force-dynamic';
export default async function ArticlesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const data = await overview();
  const posts = data.posts.filter(
    (p) => !q || `${p.title} ${p.summary ?? ''} ${p.blogName ?? ''}`.toLocaleLowerCase().includes(q.toLocaleLowerCase()),
  );
  return (
    <div className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">最新文章</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">從各站公開訂閱來源收錄，按發文時間排列。完整文章請至作者原站閱讀。</p>
      </header>
      <SectionTabs
        label="文章瀏覽"
        tabs={[
          { href: '/articles/', label: '最新文章', current: true },
          { href: '/tags/', label: '標籤與主題' },
        ]}
      />
      <form className="flex gap-2">
        <label className="sr-only" htmlFor="article-query">
          搜尋文章
        </label>
        <input
          id="article-query"
          name="q"
          defaultValue={q}
          placeholder="搜尋文章標題、摘要或部落格"
          className="min-h-10 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button type="submit" className="rounded-lg bg-brand-700 px-4 text-sm text-white">
          搜尋
        </button>
      </form>
      <p className="text-xs text-zinc-500">
        最近收錄的 {data.posts.length} 篇中，符合 {posts.length} 篇
      </p>
      {posts.length ? (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {posts.map((post) => (
            <ArticleListItem key={post.id ?? post.url} post={post} />
          ))}
        </ul>
      ) : (
        <p className="py-8 text-zinc-500">目前沒有符合條件的文章。</p>
      )}
    </div>
  );
}
