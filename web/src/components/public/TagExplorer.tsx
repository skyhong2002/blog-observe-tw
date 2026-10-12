'use client';
// One view for the prerendered tag list and the browser's ?tag=; see app/tags/page.tsx.

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import ArticleListItem from '@/components/ArticleListItem';
import BlogIcon from '@/components/BlogIcon';
import SectionTabs from '@/components/SectionTabs';
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
  const pendingLabel = detail?.status === 'pending' ? tags.find((t) => t.slug === tag)?.label : undefined;
  const title = selected?.label ?? pendingLabel;
  return (
    <div className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">{title ? `${title} · 標籤` : '標籤與主題'}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          從部落格與文章標籤探索不同作者的書寫。人工與社群標籤保留來源，與爬蟲標籤分開記錄。
        </p>
      </header>
      <SectionTabs
        label="文章瀏覽"
        tabs={[
          { href: '/articles/', label: '最新文章' },
          { href: '/tags/', label: '標籤與主題', current: true },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <Link
            key={t.slug}
            href={`/tags/?tag=${encodeURIComponent(t.slug)}`}
            aria-current={t.slug === tag ? 'page' : undefined}
            className={`rounded-lg border px-3 py-2 text-sm ${t.slug === tag ? 'border-brand-600 text-brand-700 dark:text-brand-400' : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400'}`}
          >
            {t.label}
            <span className="ml-2 text-xs text-zinc-500">
              {t.postCount} 篇 · {t.blogCount} 站
            </span>
          </Link>
        ))}
      </div>
      {detail?.status === 'ready' && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">相關文章與部落格</h2>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {detail.data.posts?.map((post) => (
              <ArticleListItem key={post.id ?? post.url} post={post} />
            ))}
          </ul>
          <ul className="mt-4 space-y-2">
            {detail.data.blogs?.map((blog) => (
              <li key={blog.slug}>
                <Link
                  {...blogLink(blog.slug, blog.canonicalPath)}
                  className="inline-flex items-center gap-1.5 text-brand-700 hover:underline dark:text-brand-400"
                >
                  <BlogIcon media={blog.slug} title={blog.name} />
                  {blog.name}
                </Link>
              </li>
            ))}
          </ul>
          {!detail.data.posts?.length && !detail.data.blogs?.length && (
            <p className="py-8 text-zinc-500">此標籤目前沒有公開文章或部落格。</p>
          )}
        </section>
      )}
      {detail?.status === 'pending' && (
        <p role="status" aria-busy="true" className="py-8 text-zinc-500">
          正在載入標籤文章…
        </p>
      )}
      {(detail?.status === 'missing' || detail?.status === 'error') && (
        <p role="status" className="py-8 text-zinc-500">
          找不到此公開標籤，或暫時無法載入。請回到標籤列表重試。
        </p>
      )}
      {!tags.length && <p className="py-8 text-zinc-500">標籤資料整理中。</p>}
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
