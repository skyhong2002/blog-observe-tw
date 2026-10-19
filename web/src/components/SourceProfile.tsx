// Profile grid and sidebar copied from tag.observe.tw /media/[media]/ (afe0a65).

import { type ReactNode, Suspense } from 'react';
import BlogIcon from '@/components/BlogIcon';
import Link from '@/components/NoPrefetchLink';
import ProfilePostsView, { ProfilePostsFromUrl } from '@/components/public/ProfilePosts';
import { type Blog, taipei } from '@/lib/api';
import { blogHref } from '@/lib/page-links';
import FollowButton from './follow-button';
import MediaSidebar from './MediaSidebar';
import MethodLink from './MethodLink';
import SectionTabs from './SectionTabs';

/**
 * `cloud` is a server-rendered slot (the page passes BlogTopicCloud in its own Suspense): the profile's word cloud
 * is drawn from the blog's local topic ranking, never from its raw tags, and this component never fetches it.
 */
/** The median gap between its latest posts, in words: 約每天, 約每 3 天, 約每 2 週. */
function postingText(hours: number | null | undefined) {
  if (hours == null) return null;
  if (hours < 18) return '一天數篇';
  const days = Math.round(hours / 24);
  if (days <= 1) return '約每天';
  if (days < 14) return `約每 ${days} 天`;
  if (days < 60) return `約每 ${Math.round(days / 7)} 週`;
  return `約每 ${Math.round(days / 30)} 個月`;
}

/** One 部落格資料 row, left out when there is nothing to say. */
function Row({ term, children }: { term: string; children: ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <>
      <dt className="text-zinc-500 dark:text-zinc-400">{term}</dt>
      <dd>{children}</dd>
    </>
  );
}
const recorded = (value?: string | null) => (value ? taipei(value) : null);

export default function SourceProfile({ blog, sidebar, cloud }: { blog: Blog; sidebar?: ReactNode; cloud?: ReactNode }) {
  const allPosts = blog.posts ?? [];
  const authors = blog.authors ?? [];
  const tags = blog.tags ?? [];
  const genres = (blog.genreState?.items ?? []).filter((item) => item.visible).map((item) => item.label);
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
            {/* Shown genres (部落格類型 below), not the imported category; none yet leaves the place empty. */}
            {genres.length > 0 && (
              <>
                <span>{genres.join('、')}</span>
                <span>·</span>
              </>
            )}
            <span>{blog.statusLabel ?? '待核對'}</span>
            <span>·</span>
            <MethodLink />
          </p>
        </div>
        <dl className="flex gap-5 text-right sm:gap-7">
          <div>
            {/* The blog's whole collection; 本頁收錄 (the 50 listed) read like its total (1,011 for wiwi.blog). */}
            <dt className="text-[11px] text-zinc-500 dark:text-zinc-400">{blog.postCount === undefined ? '本頁收錄' : '收錄文章'}</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums">
              {(blog.postCount ?? allPosts.length).toLocaleString('zh-TW')}
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
          ...(authors.length ? [{ href: '#authors', label: '相關作者' }] : []),
          { href: '#source', label: '來源資料' },
        ]}
      />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-6">
        <MediaSidebar label="部落格資料、內文來源、流量與作者">
          <section id="source" className="rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">
            <h2 className="mb-3 flex items-baseline justify-between gap-2 text-sm font-semibold">部落格資料</h2>
            <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-y-2.5 leading-5">
              <Row term="名稱">{blog.name}</Row>
              <Row term="收錄說明">{blog.description || null}</Row>
              <Row term="原站">
                {blog.url ? (
                  <a className="break-all text-brand-700 hover:underline dark:text-brand-400" href={blog.url} rel="noopener noreferrer">
                    {blog.url} ↗
                  </a>
                ) : null}
              </Row>
              <Row term="最後發文">{recorded(blog.lastPublishedAt)}</Row>
              <Row term="抓取成功">{recorded(blog.lastCrawlSuccessAt)}</Row>
              <Row term="發文頻率">{postingText(blog.postingIntervalHours)}</Row>
              <Row term="檢查頻率">{blog.crawlIntervalHours ? `每 ${blog.crawlIntervalHours} 小時檢查 RSS` : null}</Row>
            </dl>
          </section>
          {sidebar}
          {authors.length > 0 && (
            <section id="authors" className="rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">
              <h2 className="mb-3 text-sm font-semibold">相關作者</h2>
              <ul className="space-y-2">
                {authors.map((author) => (
                  <li key={author.id}>{author.displayName}</li>
                ))}
              </ul>
            </section>
          )}
          {tags.length > 0 && (
            <section className="rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800">
              <h2 className="mb-3 text-sm font-semibold">部落格標籤</h2>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <Link
                    key={tag.slug}
                    className="rounded bg-zinc-100 px-2 py-1 text-brand-700 dark:bg-zinc-900 dark:text-brand-400"
                    href={`/tags/?tag=${encodeURIComponent(tag.slug)}`}
                  >
                    {tag.label}
                  </Link>
                ))}
              </div>
            </section>
          )}
        </MediaSidebar>
        <section className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
          {cloud}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">最新收錄</h2>
          </div>
          <Suspense fallback={<ProfilePostsView blog={owner} posts={allPosts} query="" />}>
            <ProfilePostsFromUrl blog={owner} posts={allPosts} />
          </Suspense>
        </section>
      </div>
    </div>
  );
}
