// Profile grid and sidebar copied from tag.observe.tw /media/[media]/ (afe0a65).

import { type ReactNode, Suspense } from 'react';
import BlogIcon from '@/components/BlogIcon';
import Link from '@/components/NoPrefetchLink';
import ProfilePostsView, { ProfilePostsFromUrl } from '@/components/public/ProfilePosts';
import { type Blog, taipei } from '@/lib/api';
import { blogHref } from '@/lib/page-links';
import FollowButton from './follow-button';
import MediaSidebar from './MediaSidebar';
import SectionTabs from './SectionTabs';
/**
 * `cloud` is a server-rendered slot (the page passes BlogTopicCloud in its own Suspense): the profile's word cloud
 * is drawn from the blog's local topic ranking, never from its raw tags, and this component never fetches it.
 */
export default function SourceProfile({ blog, sidebar, cloud }: { blog: Blog; sidebar?: ReactNode; cloud?: ReactNode }) {
  const allPosts = blog.posts ?? [];
  const owner = { slug: blog.slug, name: blog.name, canonicalPath: blog.canonicalPath };
  return (
    <div className="pb-4">
      <nav aria-label="麵包屑" className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        <Link href="/blogs/" className="hover:text-brand-700 dark:hover:text-brand-400">
          部落格
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        {blog.name}
      </nav>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-zinc-300 pb-4 dark:border-zinc-700">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <BlogIcon media={blog.slug} iconUrl={blog.iconUrl} title={blog.name} size={32} className="rounded" />
            <h1 className="text-2xl font-semibold tracking-tight">{blog.name}</h1>
            <FollowButton slug={blog.slug} />
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{blog.category ?? '未分類'}</span>
            <span>·</span>
            <span>{blog.statusLabel ?? '待核對'}</span>
          </p>
        </div>
        <dl className="flex gap-5 text-right sm:gap-7">
          <div>
            <dt className="text-[11px] text-zinc-500 dark:text-zinc-400">本頁收錄</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums">
              {allPosts.length}
              <span className="ml-1 text-[10px] font-normal text-zinc-500">篇</span>
            </dd>
          </div>
        </dl>
      </header>
      <SectionTabs
        className="mb-5"
        label="部落格資料"
        tabs={[
          { href: blogHref(blog.slug, blog.canonicalPath), label: '收錄文章', current: true },
          { href: '#authors', label: '相關作者' },
          { href: '#source', label: '來源資料' },
        ]}
      />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-6">
        <MediaSidebar label="部落格資料、內文來源、流量與作者">
          <section id="source" className="rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">
            <h2 className="mb-3 flex items-baseline justify-between gap-2 text-sm font-semibold">部落格資料</h2>
            <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-y-2.5 leading-5">
              <dt className="text-zinc-500 dark:text-zinc-400">名稱</dt>
              <dd>{blog.name}</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">收錄說明</dt>
              <dd>{blog.description || '由公開來源名單與訂閱來源整理。'}</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">原站</dt>
              <dd className="break-all">
                {blog.url ? (
                  <a className="text-brand-700 hover:underline dark:text-brand-400" href={blog.url} rel="noopener noreferrer">
                    {blog.url} ↗
                  </a>
                ) : (
                  '網址待核對'
                )}
              </dd>
              <dt className="text-zinc-500 dark:text-zinc-400">最後發文</dt>
              <dd>{taipei(blog.lastPublishedAt)}</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">抓取成功</dt>
              <dd>{taipei(blog.lastCrawlSuccessAt)}</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">預期更新</dt>
              <dd>{blog.expectedIntervalHours ? `約每 ${blog.expectedIntervalHours} 小時` : '尚未設定'}</dd>
            </dl>
            <p className="mt-3 border-t border-zinc-200 pt-3 leading-5 text-zinc-500 dark:border-zinc-800">
              沒有近期文章不代表網站失效，抓取成功與發文時間分開記錄。
            </p>
          </section>
          {sidebar}
          <section id="authors" className="rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">
            <h2 className="mb-3 text-sm font-semibold">相關作者</h2>
            {blog.authors?.length ? (
              <ul className="space-y-2">
                {blog.authors.map((author) => (
                  <li key={author.id}>{author.displayName}</li>
                ))}
              </ul>
            ) : (
              <p className="text-zinc-500">作者資料待核對。</p>
            )}
            <p className="mt-3 leading-5 text-zinc-500">署名依各站記錄，不憑相同筆名合併跨站作者。</p>
          </section>
          <section className="rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">
            <h2 className="mb-3 text-sm font-semibold">部落格標籤</h2>
            <div className="flex flex-wrap gap-2">
              {blog.tags?.map((tag) => (
                <Link
                  key={tag.slug}
                  className="rounded bg-zinc-100 px-2 py-1 text-brand-700 dark:bg-zinc-900 dark:text-brand-400"
                  href={`/tags/?tag=${encodeURIComponent(tag.slug)}`}
                >
                  {tag.label}
                </Link>
              ))}
            </div>
            {!blog.tags?.length && <p className="text-zinc-500">尚無標籤。</p>}
          </section>
        </MediaSidebar>
        <section className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
          {cloud}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">最新收錄</h2>
            <p className="text-xs text-zinc-500">依發文時間排列 · 完整內容請至原站閱讀</p>
          </div>
          <Suspense fallback={<ProfilePostsView blog={owner} posts={allPosts} query="" />}>
            <ProfilePostsFromUrl blog={owner} posts={allPosts} />
          </Suspense>
        </section>
      </div>
    </div>
  );
}
