import Link from 'next/link';
import { notFound } from 'next/navigation';
import BlogIcon from '@/components/BlogIcon';
import TableScroller from '@/components/TableScroller';
import { type AuthorCatalogQuery, authorCatalog } from '@/lib/api';
import { table } from '@/lib/table-styles';
export const dynamic = 'force-dynamic';
export default async function AuthorsPage({ searchParams }: { searchParams: Promise<AuthorCatalogQuery> }) {
  const query = await searchParams;
  if (
    query.author !== undefined &&
    (typeof query.author !== 'string' ||
      !/^[1-9]\d*$/.test(query.author) ||
      !Number.isSafeInteger(Number(query.author)) ||
      Number(query.author) > 2147483647)
  )
    notFound();
  const data = await authorCatalog(query);
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
    <div className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">部落格作者</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">依各站公開署名整理；作者與站主分開記錄，不憑筆名跨站合併。</p>
      </header>
      {author && (
        <Link href="/authors/" className="text-sm text-brand-700 dark:text-brand-400">
          ← 全部作者
        </Link>
      )}
      <p role="status" className="text-xs text-zinc-500">
        共 {data.matchedAuthors} 位作者 · {total} 筆作者與部落格關係
      </p>
      <TableScroller card>
        <table className="w-full min-w-[28rem] text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className={table.cell}>作者</th>
              <th className={table.cell}>部落格</th>
              <th className={table.num}>收錄文章</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map((a) => (
              <tr key={`${a.id}-${a.blogSlug}`} className={table.row}>
                <td className={table.cell}>{a.displayName}</td>
                <td className={table.cell}>
                  {a.blogSlug ? (
                    <Link
                      href={`/blogs/${a.blogSlug}/`}
                      className="inline-flex items-center gap-1.5 text-brand-700 hover:underline dark:text-brand-400"
                    >
                      <BlogIcon media={a.blogSlug} title={a.blogName} />
                      {a.blogName}
                    </Link>
                  ) : (
                    '關係待核對'
                  )}
                </td>
                <td className={table.num}>{a.postCount ?? 0}</td>
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
    </div>
  );
}
