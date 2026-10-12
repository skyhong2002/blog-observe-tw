// Table layout copied from tag.observe.tw /media/ at afe0a65.
import Link from 'next/link';
import MediaTabs from '@/components/MediaTabs';
import TableScroller from '@/components/TableScroller';
import { overview, taipei } from '@/lib/api';
import { table } from '@/lib/table-styles';
export const dynamic = 'force-dynamic';
export default async function BlogsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; sort?: string; page?: string }>;
}) {
  const data = await overview();
  const query = await searchParams;
  const q = (query.q ?? '').trim().slice(0, 100);
  const categories = [...new Set(data.blogs.map((b) => b.category).filter(Boolean))] as string[];
  const rows = data.blogs.filter(
    (b) =>
      (!q || `${b.name} ${b.url ?? ''}`.toLocaleLowerCase().includes(q.toLocaleLowerCase())) &&
      (!query.category || b.category === query.category),
  );
  rows.sort(
    query.sort === 'latest'
      ? (a, b) => Date.parse(b.lastPublishedAt ?? '1970-01-01') - Date.parse(a.lastPublishedAt ?? '1970-01-01')
      : (a, b) => a.name.localeCompare(b.name, 'zh-Hant'),
  );
  const pages = Math.max(1, Math.ceil(rows.length / 50));
  const page = Math.min(pages, Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1));
  const href = (patch: Record<string, string>) => `/blogs/?${new URLSearchParams({ ...query, ...patch })}`;
  return (
    <div className="space-y-5 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">部落格與文章數</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            查看收錄來源、文章與更新紀錄。各站有自己的寫作步調，沒有近期文章不代表網站失效。
          </p>
        </div>
        <p className="text-xs text-zinc-500">{data.updatedAt ? `${taipei(data.updatedAt)} 更新` : '等待資料更新'}</p>
      </header>
      <MediaTabs current="media" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: '收錄部落格', value: data.totals.blogs },
          { label: '收錄文章', value: data.totals.posts },
          { label: '已核對網址', value: data.blogs.filter((b) => b.url).length },
          { label: '作者紀錄', value: data.authors.length },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">{item.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{item.value.toLocaleString('zh-TW')}</div>
          </div>
        ))}
      </div>
      <form className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          搜尋部落格
          <input
            name="q"
            defaultValue={q}
            placeholder="名稱或網址"
            className="block min-h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </label>
        <label className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          分類
          <select
            name="category"
            defaultValue={query.category ?? ''}
            className="block min-h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">全部分類</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          排列
          <select
            name="sort"
            defaultValue={query.sort ?? 'name'}
            className="block min-h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="name">名稱</option>
            <option value="latest">最後發文</option>
          </select>
        </label>
        <button className="min-h-10 rounded-lg bg-brand-700 px-4 text-sm text-white" type="submit">
          篩選
        </button>
      </form>
      <p role="status" className="text-xs text-zinc-500">
        共 {rows.length} 個部落格
      </p>
      <TableScroller card label="部落格與文章數表格，可左右捲動">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className={table.leadHead}>部落格</th>
              <th className={table.cell}>分類</th>
              <th className={table.num}>已收錄文章</th>
              <th className={table.cell}>最新文章</th>
              <th className={table.cell}>抓取成功</th>
              <th className={table.cell}>狀態</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.slice((page - 1) * 50, page * 50).map((blog) => (
              <tr key={blog.slug} className={table.row}>
                <td className={table.lead}>
                  <div className={table.leadBox}>
                    <Link href={`/blogs/${blog.slug}/`} className="font-medium text-brand-700 hover:underline dark:text-brand-400">
                      {blog.name}
                    </Link>
                    {blog.url && <p className={`${table.leadExtra} mt-1 max-w-60 truncate text-xs text-zinc-500`}>{blog.url}</p>}
                  </div>
                </td>
                <td className={table.cell}>{blog.category ?? '未分類'}</td>
                <td className={table.num}>{blog.postCount ?? '—'}</td>
                <td className={`${table.cell} whitespace-nowrap text-xs text-zinc-500`}>{taipei(blog.lastPublishedAt)}</td>
                <td className={`${table.cell} whitespace-nowrap text-xs text-zinc-500`}>{taipei(blog.lastCrawlSuccessAt)}</td>
                <td className={`${table.cell} whitespace-nowrap text-xs`}>{blog.statusLabel ?? '待核對'}</td>
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
    </div>
  );
}
