'use client';
import BlogIcon from '@/components/BlogIcon';
import { useFollows } from '@/lib/follows-store';
import { blogHref } from '@/lib/page-links';
import Link from './NoPrefetchLink';
import ReloadButton from './public/ReloadButton';
import StateNotice, { stateActionClass } from './StateNotice';
export default function ReaderList() {
  // The same shared /api/me/follows read as FollowButton (lib/follows-store.ts).
  const loaded = useFollows();
  const state = loaded.status;
  const follows = loaded.status === 'ready' ? loaded.follows : null;
  if (state === 'loading')
    return (
      <p role="status" className="py-8 text-zinc-500">
        正在載入閱讀清單…
      </p>
    );
  if (state === 'error')
    return (
      <StateNotice tone="error" title="暫時無法取得追蹤清單" extra={<ReloadButton />}>
        你的追蹤沒有遺失，只是這次沒讀到。重新整理通常就能解決。
      </StateNotice>
    );
  if (state === 'login')
    return (
      <section className="rounded-xl border border-zinc-300 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">登入以保存你的閱讀清單</h2>
        <p className="my-3 text-sm leading-7 text-zinc-600 dark:text-zinc-400">Google 登入只用來管理追蹤與訂閱，不會代替你在原站閱讀。</p>
        <a href="/auth/google?next=%2Fmy%2F" className="inline-flex min-h-10 items-center rounded-lg bg-brand-700 px-4 text-sm text-white">
          使用 Google 登入
        </a>
      </section>
    );
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-base font-semibold">
          追蹤中的部落格{' '}
          <span className="ml-1 text-sm font-normal tabular-nums text-zinc-600 dark:text-zinc-400">{follows?.length ?? 0} 個</span>
        </h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <a className={stateActionClass()} href="/me/feed.xml">
            訂閱個人 RSS
          </a>
          <a className={stateActionClass()} href="/me/opml">
            匯出 OPML
          </a>
        </div>
      </div>
      {follows?.length ? (
        <ul className="divide-y divide-zinc-200 px-4 dark:divide-zinc-800">
          {follows.map((blog) => (
            <li key={blog.slug}>
              <Link href={blogHref(blog.slug, blog.canonicalPath)} className="group flex min-h-14 items-center justify-between gap-3 py-3">
                {/* The name reads as the link (to the blog's page); the category is a plain label, not a second destination. */}
                <span className="inline-flex min-w-0 items-center gap-2 text-[0.9375rem] font-medium text-brand-700 group-hover:underline dark:text-brand-400">
                  <BlogIcon media={blog.slug} iconUrl={blog.iconUrl} title={blog.name} />
                  <span className="truncate">{blog.name}</span>
                </span>
                {blog.category && blog.category !== '待分類' ? (
                  <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {blog.category}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="p-4">
          <StateNotice title="還沒有追蹤任何部落格" actions={[{ href: '/blogs/', label: '逛部落格目錄', primary: true }]}>
            在部落格頁按「追蹤」，它的新文章就會出現在你的個人 RSS 裡。
          </StateNotice>
        </div>
      )}
    </section>
  );
}
