'use client';

// One view for the prerendered latest-articles list and the browser's ?q=&page=&blog= search; see app/articles/page.tsx.

import { useSearchParams } from 'next/navigation';
import ArticleListItem from '@/components/ArticleListItem';
import Link from '@/components/NoPrefetchLink';
import SectionTabs from '@/components/SectionTabs';
import { type Post, taipei } from '@/lib/api';
import { blogHref } from '@/lib/page-links';
import {
  bytesText,
  countText,
  type HistoricalBodyCoverage,
  MISSING,
  normalizeSearch,
  QUERY_MAX,
  type SearchParams,
  type SearchResult,
  searchHref,
  searchParamsOf,
  searchPath,
} from '@/lib/search';
import { type PublicLoad, usePublicJson } from '@/lib/use-public-json';

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

/** The historical-body part of the scope, in the gateway's own terms; no state is read as "none found" or "everything". */
function historicalBodyText(body: HistoricalBodyCoverage | null) {
  if (!body) return '歷史正文搜尋：此搜尋服務未提供正文索引的範圍，無法說明是否查過較早文章的正文。';
  switch (body.status) {
    case 'not-enabled':
      return '歷史正文搜尋目前未開啟：較早文章的正文沒有被搜尋。';
    case 'short-query':
      return '關鍵字少於 3 個字，這次沒有使用歷史正文索引；這不代表較早文章的正文沒有提到它。';
    case 'unavailable':
      return '歷史正文索引這次無法使用；這不代表較早文章的正文沒有提到它。';
    case 'partial':
      return `歷史正文搜尋只比對已建索引文章的正文前 ${countText(body.prefixCodepoints)} 個字（原始正文上限 ${bytesText(body.rawBodyByteLimit)}），最多取 ${countText(body.candidateLimit)} 篇候選${body.candidateTruncated === true ? '，本次候選已達上限，可能還有未列出的文章' : ''}；未建索引的文章與正文後段不在範圍內，並非全站全文搜尋。`;
    default:
      return `歷史正文搜尋：範圍${MISSING}。`;
  }
}

function Coverage({ result }: { result: SearchResult }) {
  const { limit, scannedPosts, truncated, historicalBody: body } = result.coverage;
  return (
    <div className="space-y-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400" data-search-coverage="">
      <p>
        標題、摘要、部落格名稱與公開標籤：
        {limit === null ? `查找範圍${MISSING}` : `只查最近收錄的最多 ${limit.toLocaleString('zh-TW')} 篇`}
        （本次查找 {countText(scannedPosts)} 篇）
        {truncated === true ? '，更早收錄的文章不在這部分的範圍內' : ''}。
      </p>
      <p>{historicalBodyText(body)}</p>
      <p>
        結果只顯示短片段，全文請至原站閱讀。
        {result.generatedAt && ` ${taipei(result.generatedAt)} 更新。`}
      </p>
      {body?.status === 'partial' ? (
        <details className="group">
          <summary className="cursor-pointer text-brand-700 hover:underline dark:text-brand-400">正文索引的比對細節</summary>
          <ul className="mt-1 space-y-0.5">
            <li>
              索引版本 {body.indexVersion ?? MISSING} · 正規化 {body.normalization ?? MISSING} · 範圍 {body.scope ?? MISSING}
            </li>
            <li>
              本次候選 {countText(body.candidates)} 篇；過期或不符資格 {countText(body.staleOrIneligible)}、超過大小上限{' '}
              {countText(body.overcap)}、編碼無效 {countText(body.invalidUtf8)}、正文超過索引前段{' '}
              {countText(body.prefixTruncatedCandidates)} 篇。
            </li>
            <li>未建索引的文章數：{body.unindexed === 'unknown' ? '未知' : countText(body.unindexed)}。</li>
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function SearchResults({ asked, search }: { asked: SearchParams; search: PublicLoad<SearchResult> }) {
  if (search.status === 'pending')
    return (
      <p role="status" aria-busy="true" className="py-8 text-sm text-zinc-500 dark:text-zinc-400">
        正在搜尋「{asked.q}」…
      </p>
    );
  if (search.status !== 'ready')
    return (
      <div role="status" className="rounded-xl border border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <p>搜尋暫時無法使用，請稍後再試。這不表示沒有符合的文章。</p>
        {/* A full load: the same URL would not refetch through the client router. */}
        <a href={searchHref(asked)} className="mt-3 inline-block text-brand-700 hover:underline dark:text-brand-400">
          重新搜尋
        </a>
      </div>
    );
  const result = search.data;
  return (
    <>
      <Coverage result={result} />
      {result.items.length ? (
        <>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800" aria-label={`「${asked.q}」的搜尋結果`}>
            {result.items.map((item) => (
              <ArticleListItem
                key={item.articleId ?? item.id ?? item.url ?? item.title}
                post={item}
                snippet={item.snippet}
                matchSource={item.matchSource}
                evidence={item}
              />
            ))}
          </ul>
          <Pager asked={asked} result={result} />
        </>
      ) : (
        <div role="status" className="py-8 text-sm text-zinc-600 dark:text-zinc-400">
          <p>{result.page > 1 ? `「${asked.q}」沒有更多結果了。` : `在搜尋範圍內找不到「${asked.q}」。`}</p>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            只查了上方說明的範圍，找不到不代表其他文章沒有提到它；可以換個關鍵字，或到部落格頁面瀏覽。
          </p>
          {result.page > 1 && (
            <Link className="mt-3 inline-block text-brand-700 dark:text-brand-400" href={searchHref({ ...asked, page: 1 })}>
              ← 回到第 1 頁
            </Link>
          )}
        </div>
      )}
    </>
  );
}

/** `search` is null when the URL has no query: the latest posts are listed instead. */
export default function ArticlesView({
  asked,
  latest,
  search,
}: {
  asked: SearchParams;
  latest: Post[];
  search: PublicLoad<SearchResult> | null;
}) {
  const searching = search !== null;
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
          key={asked.q}
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
          <Link href={blogHref(asked.blog)} className="text-brand-700 hover:underline dark:text-brand-400">
            這個部落格
          </Link>{' '}
          的文章 ·{' '}
          <Link href={searchHref({ ...asked, blog: null, page: 1 })} className="text-brand-700 hover:underline dark:text-brand-400">
            改搜全部部落格
          </Link>
        </p>
      )}
      {search ? (
        <SearchResults asked={asked} search={search} />
      ) : (
        <>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">最近收錄的 {latest.length} 篇 · 輸入關鍵字可搜尋內文</p>
          {latest.length ? (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {latest.map((post) => (
                <ArticleListItem key={post.id ?? post.url} post={post} />
              ))}
            </ul>
          ) : (
            <p className="py-8 text-zinc-500 dark:text-zinc-400">目前還沒有收錄文章。</p>
          )}
        </>
      )}
    </div>
  );
}

const askedOf = (params: { get(key: string): string | null }) =>
  searchParamsOf({ q: params.get('q') ?? undefined, page: params.get('page') ?? undefined, blog: params.get('blog') ?? undefined });

/** Stable parser: the page and query it normalises against come from the path it answers. */
const parseSearch = (raw: unknown, path: string) => normalizeSearch(raw, askedOf(new URL(path, 'http://local').searchParams));

/** Reads ?q=&page=&blog= (inside the page's Suspense boundary) and searches through /api/search. */
export function ArticlesFromUrl({ latest }: { latest: Post[] }) {
  const asked = askedOf(useSearchParams());
  const search = usePublicJson(asked.q ? searchPath(asked) : null, parseSearch);
  return <ArticlesView asked={asked} latest={latest} search={search} />;
}
