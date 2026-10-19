'use client';

// Table layout copied from tag.observe.tw /media/ at afe0a65.
// One view for both the prerendered catalog (no query) and the browser's own
// query; see app/blogs/page.tsx.

import { useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import BlogIcon from '@/components/BlogIcon';
import BlogSuggestion from '@/components/BlogSuggestion';
import FilterChips from '@/components/FilterChips';
import MediaTabs from '@/components/MediaTabs';
import MethodLink from '@/components/MethodLink';
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
import { type RobotsStatus, robotsLabel, robotsTone } from '@/lib/robots';
import { table } from '@/lib/table-styles';
import { asIs, usePublicJson } from '@/lib/use-public-json';

type Status = 'ready' | 'pending' | 'error';

/** What the blog's robots.txt last said to this crawler; the hover text names blocked paths and the read time. */
function RobotsCell({ robots }: { robots?: RobotsStatus | null }) {
  const { label, tone, title } = robotsLabel(robots);
  return (
    <td className={`${table.cell} text-xs ${robotsTone[tone]}`}>
      <span className="block max-w-40 truncate" title={title}>
        {label}
      </span>
    </td>
  );
}

/**
 * `catalog` supplies the rows when `status` is ready; otherwise only its
 * filter-independent parts (totals, facets, update time) are shown, beside the
 * asked `filters`, so no other query's rows appear while this one loads.
 */
/** Search text as the gateway folds it (catalog.js searchText): NFKC, lower case, single spaces. */
const fold = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();

/** Marks every place a search word appears (tag.observe.tw SuggestInput's Highlight, for each word). */
function Highlight({ text, words }: { text: string; words: string[] }) {
  const lower = text.toLowerCase();
  const marks: [number, number][] = [];
  for (const word of words)
    for (let at = lower.indexOf(word); word && at >= 0; at = lower.indexOf(word, at + word.length)) marks.push([at, at + word.length]);
  if (!marks.length) return <>{text}</>;
  marks.sort((a, b) => a[0] - b[0]);
  const parts: ReactNode[] = [];
  let from = 0;
  for (const [start, end] of marks) {
    if (start < from) continue;
    parts.push(
      text.slice(from, start),
      <mark key={start} className="rounded-sm bg-brand-100 text-inherit dark:bg-brand-900/60">
        {text.slice(start, end)}
      </mark>,
    );
    from = end;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

/**
 * Filters as you type, like tag.observe.tw's /media/traffic/: the URL's ?q= follows the box (replaceState, no reload)
 * 250 ms after the last keystroke, or at once on Enter. Paging restarts; a column sort the reader chose is kept.
 */
function SearchBox({ q }: { q: string }) {
  const [text, setText] = useState(q);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Back/forward or a chip changes ?q=; never overwrite what the reader is typing.
  useEffect(() => {
    if (document.activeElement !== input.current) setText(q);
  }, [q]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const go = (value: string) => {
    clearTimeout(timer.current);
    // From the address bar, not the normalised filters: only a column the reader actually clicked stays (the
    // default latest-first order would otherwise override best-match ranking).
    const params = new URLSearchParams(window.location.search);
    for (const key of ['page', ...['category', 'genre', 'status'].filter((key) => !params.get(key))]) params.delete(key);
    if (params.get('sort') === 'relevance') params.delete('sort');
    if (value.trim()) params.set('q', value.trim());
    else params.delete('q');
    const search = params.toString();
    window.history.replaceState(null, '', search ? `/blogs/?${search}` : '/blogs/');
  };
  return (
    <form
      className="relative w-full sm:w-80"
      onSubmit={(event) => {
        event.preventDefault();
        go(text);
      }}
    >
      <label htmlFor="blog-query" className="sr-only">
        搜尋部落格：名稱、網址或簡介
      </label>
      <input
        ref={input}
        id="blog-query"
        type="search"
        name="q"
        value={text}
        autoComplete="off"
        enterKeyHint="search"
        placeholder="搜尋名稱、網址或簡介"
        onChange={(event) => {
          setText(event.target.value);
          clearTimeout(timer.current);
          const value = event.target.value;
          timer.current = setTimeout(() => go(value), 250);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && text) {
            event.preventDefault();
            setText('');
            go('');
          }
        }}
        className="min-h-9 w-full rounded-lg border border-zinc-300 bg-white py-1.5 pr-8 pl-3 text-base sm:text-sm dark:border-zinc-700 dark:bg-zinc-900 [&::-webkit-search-cancel-button]:hidden"
      />
      {text ? (
        <button
          type="button"
          aria-label="清除搜尋"
          onClick={() => {
            setText('');
            go('');
            input.current?.focus();
          }}
          className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ×
        </button>
      ) : null}
    </form>
  );
}

export default function BlogCatalogView({
  catalog: data,
  filters,
  status,
  busy = false,
}: {
  catalog: Catalog;
  filters: CatalogFilters;
  status: Status;
  /** Showing the previous answer while the next search loads. */
  busy?: boolean;
}) {
  const { q, sort, dir, genre, status: blogStatus, limit } = filters;
  const query = { q, sort, dir, genre, status: blogStatus, ...(limit !== 50 ? { limit: String(limit) } : {}) };
  const { genres = [], ungenred = 0, statuses, blogs: rows } = data;
  const { page, pages, total } = data.pagination;
  const ready = status === 'ready';
  const words = q ? [...new Set(fold(q).split(' ').filter(Boolean))] : [];
  const ascendingFirst = new Set<CatalogSort>(['name', 'category', 'status']);
  const href = (patch: Record<string, string | null>) => {
    // Empty filters and the default orders (latest first; best match while searching) stay out of the link, so a
    // search started from it still ranks by match.
    const params = new URLSearchParams(
      Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== ''),
    );
    if (sort === 'relevance' || (sort === 'latest' && dir === 'desc')) {
      params.delete('sort');
      params.delete('dir');
    }
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
  return (
    <div className="space-y-5 pb-8">
      <MediaTabs current="media" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">部落格與文章數</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {data.updatedAt ? `更新於 ${taipei(data.updatedAt)}` : '等待資料更新'} · <MethodLink />
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
      <div className="space-y-2">
        <FilterChips
          label="收錄狀態"
          items={[
            { href: href({ status: null }), label: '全部狀態', current: !query.status },
            ...statuses.map(({ value, count }) => ({
              href: href({ status: value }),
              label: `${value} ${count}`,
              current: query.status === value,
            })),
          ]}
        />
        {/* Reader and AI genres, several per blog (部落格類型 on each blog page), not the imported category. */}
        <FilterChips
          label="類型"
          items={[
            { href: href({ genre: null }), label: '全部類型', current: !query.genre },
            ...genres.map(({ value, label, count }) => ({
              href: href({ genre: value }),
              label: `${label} ${count}`,
              current: query.genre === value,
            })),
            ...(ungenred ? [{ href: href({ genre: '-' }), label: `未分類 ${ungenred}`, current: query.genre === '-' }] : []),
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchBox q={q} />
        <span role="status" className="text-xs text-zinc-500">
          {busy
            ? '正在搜尋…'
            : ready
              ? q
                ? `符合「${q}」的部落格 ${total} 個${sort === 'relevance' && total > 1 ? ' · 依相符程度排序' : ''}`
                : `共 ${total} 個部落格`
              : status === 'pending'
                ? '正在載入符合條件的部落格…'
                : '部落格目錄暫時無法載入'}
        </span>
      </div>
      {ready ? (
        <>
          <TableScroller card label="部落格與文章數表格，可左右捲動">
            <table aria-busy={busy} className={`w-full min-w-[64rem] whitespace-nowrap text-sm ${busy ? 'opacity-60' : ''}`}>
              <thead className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <Th col="name" label="部落格" className={table.leadHead} />
                  <th scope="col" className={table.cell}>
                    類型
                  </th>
                  <Th col="posts" label="已收錄文章" className="text-right" />
                  <Th col="authors" label="作者" className="text-right" />
                  <Th col="latest" label="最新文章" />
                  <Th col="crawl" label="抓取成功" />
                  <th scope="col" className={table.cell}>
                    <abbr title="這個網站的 robots.txt 對本站爬蟲寫了什麼（只公開顯示，不影響抓取），滑過可看細節" className="no-underline">
                      robots.txt
                    </abbr>
                  </th>
                  <Th col="status" label="狀態" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {rows.map((blog) => (
                  // Every cell sits on the row's text baseline, so names, URLs, counts and dates of different sizes line up.
                  <tr key={blog.slug} className={`${table.row} [&>td]:align-baseline`}>
                    <td className={table.lead}>
                      {/* One line per row: name keeps its width, the URL takes what is left and is the first to truncate. */}
                      <div className={`${table.leadBox} flex items-baseline gap-2`}>
                        <Link
                          {...blogLink(blog.slug, blog.canonicalPath)}
                          className="flex min-w-0 items-baseline gap-1.5 font-medium text-brand-700 hover:underline dark:text-brand-400"
                        >
                          <span className="shrink-0 self-center">
                            <BlogIcon media={blog.slug} iconUrl={blog.iconUrl} title={blog.name} />
                          </span>
                          <span className={`${table.leadText} sm:max-w-60`} title={blog.name}>
                            <Highlight text={blog.name} words={words} />
                          </span>
                        </Link>
                        {blog.url && (
                          <span
                            className={`${table.leadExtra} ${table.leadText} shrink-[999] text-xs text-zinc-500 sm:max-w-40 dark:text-zinc-400`}
                            title={blog.url}
                          >
                            <Highlight text={blog.url.replace(/^https?:\/\//, '').replace(/\/$/, '')} words={words} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={`${table.cell} text-xs`}>
                      <span className="flex max-w-56 flex-wrap gap-x-2 gap-y-0.5 whitespace-normal">
                        {(blog.genres ?? []).slice(0, 3).map((g) => (
                          <Link
                            key={g.value}
                            href={href({ genre: g.value })}
                            scroll={false}
                            className="text-brand-700 hover:underline dark:text-brand-400"
                          >
                            {g.label}
                          </Link>
                        ))}
                        {(blog.genres?.length ?? 0) > 3 && <span className="text-zinc-500">+{(blog.genres?.length ?? 0) - 3}</span>}
                      </span>
                    </td>
                    <td className={table.num}>{blog.postCount?.toLocaleString('zh-TW') ?? '—'}</td>
                    <td className={table.num}>{blog.authorCount?.toLocaleString('zh-TW') ?? '—'}</td>
                    <td className={`${table.cell} text-xs tabular-nums text-zinc-500`}>{taipei(blog.lastPublishedAt)}</td>
                    <td className={`${table.cell} text-xs tabular-nums text-zinc-500`}>{taipei(blog.lastCrawlSuccessAt)}</td>
                    <RobotsCell robots={blog.robots} />
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
          {!rows.length && (
            <div className="py-8 text-zinc-500">
              <p>{q ? `沒有符合「${q}」的部落格。` : '沒有符合條件的部落格。'}</p>
              {q && <BlogSuggestion query={q} />}
            </div>
          )}
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
          <p>部落格目錄暫時無法載入，請稍後再試。</p>
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
  // While typing, each search keeps the previous answer on screen (dimmed) instead of a loading box.
  const shown = useRef<Catalog>(baseline);
  if (!load) shown.current = baseline;
  else if (load.status === 'ready') shown.current = load.data;
  if (!load) return <BlogCatalogView catalog={baseline} filters={baseline.filters} status="ready" />;
  if (load.status === 'ready') return <BlogCatalogView catalog={load.data} filters={load.data.filters} status="ready" />;
  if (load.status === 'pending') return <BlogCatalogView catalog={shown.current} filters={catalogFiltersOf(asked)} status="ready" busy />;
  return <BlogCatalogView catalog={baseline} filters={catalogFiltersOf(asked)} status="error" />;
}
