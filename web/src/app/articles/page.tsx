import Link from 'next/link';
import ArticleListItem from '@/components/ArticleListItem';
import SectionTabs from '@/components/SectionTabs';
import { gateway, type Overview, taipei } from '@/lib/api';
import { normalizeSearch, QUERY_MAX, type SearchParams, type SearchResult, searchHref, searchParamsOf, searchPath } from '@/lib/search';
export const dynamic = 'force-dynamic';

function Pager({ asked, result }: { asked: SearchParams; result: SearchResult }) {
  if (result.page <= 1 && !result.hasMore) return null;
  return (
    <nav aria-label="搜尋結果分頁" className="flex items-center justify-between text-sm">
      {result.page > 1 ? (
        <Link className="py-2 text-brand-700 dark:text-brand-400" href={searchHref({ ...asked, page: result.page - 1 })}>
          ← 上一頁
        </Link>
      ) : (
        <span />
      )}
      <span className="py-2 text-zinc-500 dark:text-zinc-400">第 {result.page} 頁</span>
      {result.hasMore ? (
        <Link className="py-2 text-brand-700 dark:text-brand-400" href={searchHref({ ...asked, page: result.page + 1 })}>
          下一頁 →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

function Coverage({ result }: { result: SearchResult }) {
  const { limit, scannedPosts, truncated } = result.coverage;
  return (
    <p className="text-xs leading-5 text-zinc-500 dark:text-zinc-400">
      搜尋範圍是最近收錄的最多 {limit.toLocaleString('zh-TW')} 篇文章
      {scannedPosts !== null && `（本次查找 ${scannedPosts.toLocaleString('zh-TW')} 篇）`}，
      {truncated ? '更早的文章不在範圍內' : '可能不是全部歷史文章'}。結果只顯示片段，全文請至原站閱讀。
      {result.generatedAt && ` ${taipei(result.generatedAt)} 更新。`}
    </p>
  );
}

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const asked = searchParamsOf(await searchParams);
  const searching = asked.q.length > 0;
  const [result, data] = await Promise.all([
    searching ? gateway<unknown>(searchPath(asked)).then((raw) => normalizeSearch(raw, asked)) : Promise.resolve(null),
    searching ? Promise.resolve(null) : gateway<Overview>('/api/overview'),
  ]);
  return (
    <div className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">{searching ? '搜尋文章' : '最新文章'}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">從各站公開訂閱來源收錄，按發文時間排列。完整文章請至作者原站閱讀。</p>
      </header>
      <SectionTabs
        label="文章瀏覽"
        tabs={[
          { href: '/articles/', label: '最新文章', current: true },
          { href: '/tags/', label: '標籤與主題' },
        ]}
      />
      <form action="/articles/" className="flex gap-2">
        <label className="sr-only" htmlFor="article-query">
          搜尋文章
        </label>
        <input
          id="article-query"
          name="q"
          type="search"
          defaultValue={asked.q}
          maxLength={QUERY_MAX}
          placeholder="搜尋文章標題、摘要與內文"
          className="min-h-10 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        {asked.blog && <input type="hidden" name="blog" value={asked.blog} />}
        <button type="submit" className="rounded-lg bg-brand-700 px-4 text-sm text-white hover:bg-brand-800">
          搜尋
        </button>
      </form>
      {asked.blog && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          只搜尋{' '}
          <Link href={`/blogs/${encodeURIComponent(asked.blog)}/`} className="text-brand-700 hover:underline dark:text-brand-400">
            這個部落格
          </Link>{' '}
          的文章 ·{' '}
          <Link href={searchHref({ ...asked, blog: null, page: 1 })} className="text-brand-700 hover:underline dark:text-brand-400">
            改搜全部部落格
          </Link>
        </p>
      )}
      {searching ? (
        result ? (
          <>
            <Coverage result={result} />
            {result.items.length ? (
              <>
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800" aria-label={`「${asked.q}」的搜尋結果`}>
                  {result.items.map((item) => (
                    <ArticleListItem
                      key={item.id ?? item.url ?? item.title}
                      post={item}
                      snippet={item.snippet}
                      matchSource={item.matchSource}
                    />
                  ))}
                </ul>
                <Pager asked={asked} result={result} />
              </>
            ) : (
              <div role="status" className="py-8 text-sm text-zinc-600 dark:text-zinc-400">
                <p>{result.page > 1 ? `「${asked.q}」沒有更多結果了。` : `在搜尋範圍內找不到「${asked.q}」。`}</p>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  較早的文章可能不在範圍內；可以換個關鍵字，或到部落格頁面瀏覽。
                </p>
                {result.page > 1 && (
                  <Link className="mt-3 inline-block text-brand-700 dark:text-brand-400" href={searchHref({ ...asked, page: 1 })}>
                    ← 回到第 1 頁
                  </Link>
                )}
              </div>
            )}
          </>
        ) : (
          <div
            role="status"
            className="rounded-xl border border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
          >
            <p>搜尋暫時無法使用，請稍後再試。這不表示沒有符合的文章。</p>
            <Link href={searchHref(asked)} className="mt-3 inline-block text-brand-700 hover:underline dark:text-brand-400">
              重新搜尋
            </Link>
          </div>
        )
      ) : data ? (
        <>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">最近收錄的 {data.posts.length} 篇 · 輸入關鍵字可搜尋內文</p>
          {data.posts.length ? (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {data.posts.map((post) => (
                <ArticleListItem key={post.id ?? post.url} post={post} />
              ))}
            </ul>
          ) : (
            <p className="py-8 text-zinc-500 dark:text-zinc-400">目前還沒有收錄文章。</p>
          )}
        </>
      ) : (
        <p role="status" className="rounded-xl border border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          文章列表暫時無法載入，請稍後再試。這不表示目前沒有收錄文章。
        </p>
      )}
    </div>
  );
}
