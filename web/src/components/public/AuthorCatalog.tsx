'use client';

// One view for the prerendered author list and the browser's ?author=&page=&limit=; see app/authors/page.tsx.

import { useSearchParams } from 'next/navigation';
import BlogIcon from '@/components/BlogIcon';
import Link from '@/components/NoPrefetchLink';
import ReloadButton from '@/components/public/ReloadButton';
import TableScroller from '@/components/TableScroller';
import type { AuthorCatalog } from '@/lib/api';
import { blogLink } from '@/lib/page-links';
import { authorApiPath, authorQueryOf, isAuthorBaseline, isAuthorId } from '@/lib/public-query';
import { table } from '@/lib/table-styles';
import { asIs, usePublicJson } from '@/lib/use-public-json';

type Props = { selected: boolean } & ({ status: 'ready'; data: AuthorCatalog } | { status: 'pending' | 'error' | 'missing' });

export default function AuthorCatalogView(props: Props) {
  return (
    <div className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">部落格作者</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">依各站公開署名整理；作者與站主分開記錄，不憑筆名跨站合併。</p>
      </header>
      {props.selected && (
        <Link href="/authors/" className="text-sm text-brand-700 dark:text-brand-400">
          ← 全部作者
        </Link>
      )}
      {props.status === 'ready' ? (
        <AuthorRows data={props.data} />
      ) : props.status === 'pending' ? (
        <p role="status" aria-busy="true" className="text-xs text-zinc-500">
          正在載入作者資料…
        </p>
      ) : props.status === 'missing' ? (
        <p role="status" className="py-8 text-zinc-500">
          找不到這位作者，請回到全部作者列表。
        </p>
      ) : (
        <div role="status" className="rounded-xl border border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <p>作者資料暫時無法載入，請稍後再試。這不表示沒有作者紀錄。</p>
          <ReloadButton />
        </div>
      )}
    </div>
  );
}

function AuthorRows({ data }: { data: AuthorCatalog }) {
  const { authors: rows } = data;
  const { author, limit } = data.filters;
  const { page, pages, total } = data.pagination;
  const href = (nextPage: number) => {
    const params = new URLSearchParams({ page: String(nextPage) });
    if (author !== null) params.set('author', String(author));
    if (limit !== 50) params.set('limit', String(limit));
    return `/authors/?${params}`;
  };
  return (
    <>
      <p role="status" className="text-xs text-zinc-500">
        共 {data.matchedAuthors} 位作者 · {total} 筆作者與部落格關係
      </p>
      <TableScroller card label="部落格作者表格，可左右捲動">
        <table className="w-full min-w-[28rem] whitespace-nowrap text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th scope="col" className={table.leadHead}>
                作者
              </th>
              <th scope="col" className={table.cell}>
                部落格
              </th>
              <th scope="col" className={table.num}>
                收錄文章
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((a) => (
              <tr key={`${a.id}-${a.blogSlug}`} className={table.row}>
                <td className={table.lead}>
                  <div className={table.leadBox}>
                    <span className={`${table.leadText} block font-medium sm:max-w-60`} title={a.displayName}>
                      {a.displayName}
                    </span>
                  </div>
                </td>
                <td className={table.cell}>
                  {a.blogSlug ? (
                    <Link
                      {...blogLink(a.blogSlug, a.blogCanonicalPath)}
                      className="flex min-w-0 items-center gap-1.5 text-brand-700 hover:underline dark:text-brand-400"
                    >
                      <BlogIcon media={a.blogSlug} title={a.blogName} />
                      <span className="min-w-0 max-w-60 truncate" title={a.blogName}>
                        {a.blogName}
                      </span>
                    </Link>
                  ) : (
                    <span className="text-zinc-500">關係待核對</span>
                  )}
                </td>
                <td className={table.num}>{(a.postCount ?? 0).toLocaleString('zh-TW')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
      {!rows.length && <p className="py-8 text-zinc-500">目前沒有符合條件的作者紀錄。</p>}
      <nav aria-label="作者分頁" className="flex justify-between text-sm">
        {page > 1 ? (
          <Link className="py-2 text-brand-700 dark:text-brand-400" href={href(page - 1)}>
            ← 上一頁
          </Link>
        ) : (
          <span />
        )}
        <span className="py-2 text-zinc-500">
          第 {page} / {pages} 頁
        </span>
        {page < pages ? (
          <Link className="py-2 text-brand-700 dark:text-brand-400" href={href(page + 1)}>
            下一頁 →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </>
  );
}

// public-contracts.ts has checked the authors, pagination and filters the view reads.
const parseAuthors = asIs<AuthorCatalog>;

/** Reads ?author=&page=&limit= (inside the page's Suspense boundary) and answers it from /api/catalog/authors. */
export function AuthorCatalogFromUrl({ baseline }: { baseline: AuthorCatalog }) {
  const asked = authorQueryOf(useSearchParams());
  // An id the gateway would reject is answered here, as the old page's 404 was.
  const invalid = asked.author !== undefined && !isAuthorId(asked.author);
  const load = usePublicJson(isAuthorBaseline(asked) || invalid ? null : authorApiPath(asked), parseAuthors);
  const selected = asked.author !== undefined;
  if (invalid) return <AuthorCatalogView selected status="missing" />;
  if (!load) return <AuthorCatalogView selected={false} status="ready" data={baseline} />;
  if (load.status === 'ready') return <AuthorCatalogView selected={load.data.filters.author !== null} status="ready" data={load.data} />;
  return <AuthorCatalogView selected={selected} status={load.status === 'gone' ? 'missing' : load.status} />;
}
