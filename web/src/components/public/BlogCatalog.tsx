'use client';

// Table layout copied from tag.observe.tw /media/ at afe0a65.
// One view for both the prerendered catalog (no query) and the browser's own
// query; see app/blogs/page.tsx.

import { useSearchParams } from 'next/navigation';
import BlogIcon from '@/components/BlogIcon';
import MediaTabs from '@/components/MediaTabs';
import Link from '@/components/NoPrefetchLink';
import ReloadButton from '@/components/public/ReloadButton';
import TableScroller from '@/components/TableScroller';
import { type Catalog, taipei } from '@/lib/api';
import { blogLink } from '@/lib/page-links';
import {
  type CatalogFilters,
  type CatalogSort,
  catalogApiPath,
  catalogFiltersOf,
  catalogQueryOf,
  isCatalogBaseline,
} from '@/lib/public-query';
import { table } from '@/lib/table-styles';
import { asIs, usePublicJson } from '@/lib/use-public-json';

type Status = 'ready' | 'pending' | 'error';

/**
 * `catalog` supplies the rows when `status` is ready; otherwise only its
 * filter-independent parts (totals, facets, update time) are shown, beside the
 * asked `filters`, so no other query's rows appear while this one loads.
 */
export default function BlogCatalogView({ catalog: data, filters, status }: { catalog: Catalog; filters: CatalogFilters; status: Status }) {
  const { q, sort, dir, category, status: blogStatus, limit } = filters;
  const query = { q, sort, dir, category, status: blogStatus, ...(limit !== 50 ? { limit: String(limit) } : {}) };
  const { categories, statuses, blogs: rows } = data;
  const { page, pages, total } = data.pagination;
  const ready = status === 'ready';
  const ascendingFirst = new Set<CatalogSort>(['name', 'category', 'status']);
  const href = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    params.delete('page');
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    return `/blogs/?${params}`;
  };
  const sortLink = (col: CatalogSort) =>
    href({ sort: col, dir: sort === col ? (dir === 'asc' ? 'desc' : 'asc') : ascendingFirst.has(col) ? 'asc' : 'desc' });
  const Th = ({ col, label, className = '' }: { col: CatalogSort; label: string; className?: string }) => (
    <th
      scope="col"
      className={`${table.cell} ${className}`}
      aria-sort={sort === col ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <Link
        href={sortLink(col)}
        scroll={false}
        className={`inline-flex items-center gap-0.5 whitespace-nowrap hover:text-brand-700 dark:hover:text-brand-400 ${sort === col ? 'text-zinc-900 dark:text-zinc-100' : ''}`}
      >
        {label}
        <span aria-hidden="true" className={sort === col ? '' : 'text-zinc-400 dark:text-zinc-600'}>
          {sort === col ? (dir === 'desc' ? '▼' : '▲') : '↕'}
        </span>
      </Link>
    </th>
  );
  const chip = (active: boolean) =>
    `whitespace-nowrap rounded-full px-3 py-1 ${active ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'}`;
  return (
    <div className="space-y-5 pb-8">
      <MediaTabs current="media" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">部落格與文章數</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {data.updatedAt ? `更新於 ${taipei(data.updatedAt)}` : '等待資料更新'} ·{' '}
          <Link href="/about/" className="hover:text-brand-700 hover:underline dark:hover:text-brand-400">
            資料來源與計算方式 ⓘ
          </Link>
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: '收錄部落格', value: data.totals.blogs },
          { label: '收錄文章', value: data.totals.posts },
          { label: '已提供網址', value: data.totals.withUrls },
          { label: '作者紀錄', value: data.totals.authors },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">{item.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{item.value.toLocaleString('zh-TW')}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <Link href={href({ status: null })} scroll={false} className={chip(!query.status)}>
          全部狀態
        </Link>
        {statuses.map(({ value: status, count }) => (
          <Link key={status} href={href({ status })} scroll={false} className={chip(query.status === status)}>
            {status} {count}
          </Link>
        ))}
        <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" aria-hidden />
        <Link href={href({ category: null })} scroll={false} className={chip(!query.category)}>
          全部分類
        </Link>
        {categories.map(({ value: category, count }) => (
          <Link key={category} href={href({ category })} scroll={false} className={chip(query.category === category)}>
            {category} {count}
          </Link>
        ))}
      </div>
      <form className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <label htmlFor="blog-query" className="sr-only">
            搜尋部落格名稱或網址
          </label>
          <input
            key={q}
            id="blog-query"
            name="q"
            defaultValue={q}
            placeholder="搜尋名稱或網址"
            className="min-h-8 w-48 min-w-0 rounded-lg border border-zinc-300 bg-white px-3 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          />
          {Object.entries(query)
            .filter(([key]) => !['q', 'page'].includes(key))
            .map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value ?? ''} />
            ))}
          <button
            type="submit"
            className="min-h-8 rounded-lg border border-zinc-300 px-3 text-xs hover:text-brand-700 dark:border-zinc-700 dark:hover:text-brand-400"
          >
            搜尋
          </button>
        </div>
        <span role="status" className="text-xs text-zinc-500">
          {ready
            ? `共 ${total} 個部落格 · 沒有近期文章不代表網站失效`
            : status === 'pending'
              ? '正在載入符合條件的部落格…'
              : '部落格目錄暫時無法載入'}
        </span>
      </form>
      {ready ? (
        <>
          <TableScroller card label="部落格與文章數表格，可左右捲動">
            <table className="w-full min-w-[52rem] whitespace-nowrap text-sm">
              <thead className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <Th col="name" label="部落格" className={table.leadHead} />
                  <Th col="category" label="分類" />
                  <Th col="posts" label="已收錄文章" className="text-right" />
                  <Th col="latest" label="最新文章" />
                  <Th col="crawl" label="抓取成功" />
                  <Th col="status" label="狀態" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {rows.map((blog) => (
                  <tr key={blog.slug} className={table.row}>
                    <td className={table.lead}>
                      {/* One line per row: name keeps its width, the URL takes what is left and is the first to truncate. */}
                      <div className={`${table.leadBox} flex items-baseline gap-2`}>
                        <Link
                          {...blogLink(blog.slug, blog.canonicalPath)}
                          className="flex min-w-0 items-center gap-1.5 self-center font-medium text-brand-700 hover:underline dark:text-brand-400"
                        >
                          <BlogIcon media={blog.slug} iconUrl={blog.iconUrl} title={blog.name} />
                          <span className={`${table.leadText} sm:max-w-60`} title={blog.name}>
                            {blog.name}
                          </span>
                        </Link>
                        {blog.url && (
                          <span
                            className={`${table.leadExtra} ${table.leadText} shrink-[999] text-xs text-zinc-500 sm:max-w-40 dark:text-zinc-400`}
                            title={blog.url}
                          >
                            {blog.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={table.cell}>
                      <span className="block max-w-40 truncate" title={blog.category ?? '未分類'}>
                        {blog.category ?? '未分類'}
                      </span>
                    </td>
                    <td className={table.num}>{blog.postCount?.toLocaleString('zh-TW') ?? '—'}</td>
                    <td className={`${table.cell} text-xs tabular-nums text-zinc-500`}>{taipei(blog.lastPublishedAt)}</td>
                    <td className={`${table.cell} text-xs tabular-nums text-zinc-500`}>{taipei(blog.lastCrawlSuccessAt)}</td>
                    <td className={`${table.cell} text-xs`}>
                      <span className="block max-w-40 truncate" title={blog.statusLabel ?? '待核對'}>
                        {blog.statusLabel ?? '待核對'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
          {!rows.length && <p className="py-8 text-zinc-500">沒有符合條件的部落格。</p>}
          <nav aria-label="部落格分頁" className="flex justify-between text-sm">
            {page > 1 ? (
              <Link className="py-2 text-brand-700 dark:text-brand-400" href={href({ page: String(page - 1) })}>
                ← 上一頁
              </Link>
            ) : (
              <span />
            )}
            <span className="py-2 text-zinc-500">
              第 {page} / {pages} 頁
            </span>
            {page < pages ? (
              <Link className="py-2 text-brand-700 dark:text-brand-400" href={href({ page: String(page + 1) })}>
                下一頁 →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </>
      ) : status === 'pending' ? (
        <p aria-busy="true" className="rounded-xl border border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          正在載入符合條件的部落格…
        </p>
      ) : (
        <div className="rounded-xl border border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <p>部落格目錄暫時無法載入，請稍後再試。這不表示沒有符合條件的部落格。</p>
          <ReloadButton />
        </div>
      )}
    </div>
  );
}

// public-contracts.ts has checked the rows, facets, totals, pagination and filters the view reads.
const parseCatalog = asIs<Catalog>;

/** Reads the URL's query (inside the page's Suspense boundary) and answers it from /api/catalog. */
export function BlogCatalogFromUrl({ baseline }: { baseline: Catalog }) {
  const asked = catalogQueryOf(useSearchParams());
  const baselineAsked = isCatalogBaseline(asked);
  const load = usePublicJson(baselineAsked ? null : catalogApiPath(asked), parseCatalog);
  if (!load) return <BlogCatalogView catalog={baseline} filters={baseline.filters} status="ready" />;
  if (load.status === 'ready') return <BlogCatalogView catalog={load.data} filters={load.data.filters} status="ready" />;
  return <BlogCatalogView catalog={baseline} filters={catalogFiltersOf(asked)} status={load.status === 'pending' ? 'pending' : 'error'} />;
}
