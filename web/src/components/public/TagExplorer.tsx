'use client';

// One view for the prerendered tag list and the browser's ?tag=; see app/tags/page.tsx.

import { useSearchParams } from 'next/navigation';
import ArticleListItem from '@/components/ArticleListItem';
import BlogIcon from '@/components/BlogIcon';
import MethodLink from '@/components/MethodLink';
import Link from '@/components/NoPrefetchLink';
import SectionTabs from '@/components/SectionTabs';
import StateNotice, { stateActionClass } from '@/components/StateNotice';
import type { Blog, Overview, Post, Tag } from '@/lib/api';
import { blogLink } from '@/lib/page-links';
import { isSlug, tagApiPath } from '@/lib/public-query';
import { asIs, type PublicLoad, usePublicJson } from '@/lib/use-public-json';

type TagDetail = { tag: Tag; posts: Post[]; blogs: Blog[] };

/** `tag` is the asked slug (null: none); `detail` its /api/tags/ answer. */
export default function TagExplorerView({
  tags,
  tag,
  detail,
}: {
  tags: Overview['tags'];
  tag: string | null;
  detail: PublicLoad<TagDetail> | null;
}) {
  const selected = detail?.status === 'ready' ? detail.data.tag : null;
  const asked = tag ? tags.find((t) => t.slug === tag) : undefined;
  const title = selected?.label ?? asked?.label;
  const posts = detail?.status === 'ready' ? (detail.data.posts ?? []) : [];
  const blogs = detail?.status === 'ready' ? (detail.data.blogs ?? []) : [];
  const most = Math.max(1, ...tags.map((t) => t.blogCount));
  const tagChips = (
    <ul className="flex flex-wrap gap-2">
      {tags.map((t) => {
        const current = t.slug === tag;
        // Wider reach, slightly larger chip: the list reads as a map, not a wall.
        const weight = t.blogCount / most;
        return (
          <li key={t.slug}>
            <Link
              href={`/tags/?tag=${encodeURIComponent(t.slug)}`}
              aria-current={current ? 'page' : undefined}
              className={`inline-flex min-h-10 items-baseline gap-1.5 rounded-full border px-3.5 py-2 leading-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${weight > 0.5 ? 'text-base font-medium' : 'text-sm'} ${
                current
                  ? 'border-brand-700 bg-brand-700 text-white'
                  : 'border-zinc-200 bg-white text-zinc-800 hover:border-brand-600 hover:text-brand-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-brand-400 dark:hover:text-brand-300'
              }`}
            >
              <span>#{t.label}</span>
              <span className={`text-xs tabular-nums ${current ? 'text-brand-100' : 'text-zinc-600 dark:text-zinc-400'}`}>
                {t.blogCount} 站
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
  return (
    <div className="space-y-5 pb-8">
      <SectionTabs
        label="標籤"
        tabs={[
          { href: '/tags/', label: '文章標籤', current: true },
          { href: '/ranking/', label: '標籤收錄排行' },
        ]}
      />
      {tag === null ? (
        <>
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">文章標籤</h1>
            <p className="mt-1 text-[0.9375rem] leading-7 text-zinc-700 dark:text-zinc-300">
              部落格作者替自己文章加上的標籤，依參與的部落格數排列。點一個標籤，看有哪些文章與部落格。 <MethodLink />
            </p>
          </header>
          {tags.length ? (
            tagChips
          ) : (
            <StateNotice tone="notice" title="標籤還在整理中">
              收錄的文章帶有標籤之後，會依參與的部落格數列在這裡。先去看看最新文章吧。
              <div className="pt-3">
                <Link href="/articles/" className={stateActionClass(true)}>
                  看最新文章
                </Link>
              </div>
            </StateNotice>
          )}
        </>
      ) : (
        <>
          <header className="space-y-2">
            <Link href="/tags/" className="inline-flex min-h-9 items-center text-sm text-brand-700 hover:underline dark:text-brand-400">
              ← 所有標籤
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight">
              <span className="text-brand-700 dark:text-brand-400">#</span>
              {title ?? tag}
            </h1>
            {asked && (
              <p className="text-[0.9375rem] text-zinc-700 dark:text-zinc-300">
                <span className="font-medium tabular-nums">{asked.blogCount.toLocaleString('zh-TW')}</span> 個部落格、
                <span className="font-medium tabular-nums">{asked.postCount.toLocaleString('zh-TW')}</span> 篇文章用過這個標籤 ·{' '}
                <MethodLink />
              </p>
            )}
          </header>
          {detail?.status === 'ready' &&
            (posts.length || blogs.length ? (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <section className="min-w-0 rounded-2xl border border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
                  <h2 className="border-b border-zinc-200 py-3 text-base font-semibold dark:border-zinc-800">最近的文章</h2>
                  <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {posts.map((post) => (
                      <ArticleListItem key={post.id ?? post.url} post={post} />
                    ))}
                  </ul>
                </section>
                {blogs.length > 0 && (
                  <aside className="h-fit rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                    <h2 className="mb-3 text-base font-semibold">寫過這個標籤的部落格</h2>
                    <ul className="space-y-1">
                      {blogs.map((blog) => (
                        <li key={blog.slug}>
                          <Link
                            {...blogLink(blog.slug, blog.canonicalPath)}
                            className="flex min-h-10 items-center gap-2 rounded-lg px-2 text-[0.9375rem] text-zinc-800 hover:bg-brand-50 hover:text-brand-800 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-brand-300"
                          >
                            <BlogIcon media={blog.slug} title={blog.name} />
                            <span className="min-w-0 truncate">{blog.name}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </aside>
                )}
              </div>
            ) : (
              <StateNotice title="這個標籤目前沒有公開文章" actions={[{ href: '/tags/', label: '看所有標籤', primary: true }]}>
                用過它的文章可能已被作者移除。換一個標籤看看。
              </StateNotice>
            ))}
          {detail?.status === 'pending' && (
            <p role="status" aria-busy="true" className="py-8 text-zinc-600 dark:text-zinc-400">
              正在載入「{title ?? tag}」的文章…
            </p>
          )}
          {(detail?.status === 'missing' || detail?.status === 'error') && (
            <StateNotice
              tone={detail.status === 'error' ? 'error' : 'empty'}
              title={detail.status === 'error' ? '這個標籤暫時無法載入' : '找不到這個標籤'}
              actions={[{ href: '/tags/', label: '看所有標籤', primary: true }]}
            >
              {detail.status === 'error' ? '請稍後重新整理一次。' : '它可能已經沒有公開文章，或網址打錯了。'}
            </StateNotice>
          )}
          {tags.length > 0 && (
            <details className="group rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                換一個標籤（共 {tags.length} 個）
                <span aria-hidden="true" className="text-zinc-500 transition-transform group-open:rotate-180">
                  ▾
                </span>
              </summary>
              <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">{tagChips}</div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

// public-contracts.ts has checked tag, posts and blogs; a tag without posts is a valid answer.
const parseDetail = asIs<TagDetail>;
const MISSING: PublicLoad<TagDetail> = { status: 'missing' };

/** Reads ?tag= (inside the page's Suspense boundary) and loads it from /api/tags/. */
export function TagExplorerFromUrl({ tags }: { tags: Overview['tags'] }) {
  const tag = useSearchParams().get('tag') || null;
  const valid = tag !== null && isSlug(tag);
  const detail = usePublicJson(valid ? tagApiPath(tag) : null, parseDetail);
  return <TagExplorerView tags={tags} tag={tag} detail={tag === null ? null : valid ? detail : MISSING} />;
}
