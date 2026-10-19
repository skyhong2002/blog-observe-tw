'use client';

// A blog profile's newest posts with its in-page ?q= filter (title and summary
// of the posts already on the page). The profile is prerendered without a
// query; the filter is applied in the browser.

import { useSearchParams } from 'next/navigation';
import ArticleListItem from '@/components/ArticleListItem';
import Link from '@/components/NoPrefetchLink';
import type { Post } from '@/lib/api';
import { blogHref } from '@/lib/page-links';
import { profileQueryOf } from '@/lib/public-query';

type Owner = { slug: string; name: string; canonicalPath?: string };

export default function ProfilePostsView({ blog, posts: allPosts, query }: { blog: Owner; posts: Post[]; query: string }) {
  const posts = query
    ? allPosts.filter((post) => `${post.title} ${post.summary ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    : allPosts;
  return (
    <>
      <form action={blogHref(blog.slug, blog.canonicalPath)} className="mb-1 flex gap-2">
        <input
          key={query}
          name="q"
          defaultValue={query}
          maxLength={100}
          aria-label="搜尋這個部落格的文章"
          placeholder="搜尋這個部落格的文章"
          className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
        />
        <button
          type="submit"
          className="rounded border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          搜尋
        </button>
      </form>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        本頁 {posts.length} 篇
        {query && (
          <>
            {' · '}
            <Link
              href={`/articles/?${new URLSearchParams({ q: query, blog: blog.slug })}`}
              className="text-brand-700 hover:underline dark:text-brand-400"
            >
              搜尋這個部落格的內文 →
            </Link>
          </>
        )}
      </p>
      {posts.length ? (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {posts.map((post) => (
            <ArticleListItem
              key={post.id ?? post.guid ?? post.url}
              post={{
                ...post,
                blogSlug: post.blogSlug ?? blog.slug,
                blogCanonicalPath:
                  post.blogCanonicalPath ?? (post.blogSlug && post.blogSlug !== blog.slug ? undefined : blog.canonicalPath),
                blogName: post.blogName ?? blog.name,
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="py-8 text-zinc-600 dark:text-zinc-400">{query ? '沒有符合搜尋條件的文章。' : '尚未收錄文章。'}</p>
      )}
    </>
  );
}

/** Reads ?q= inside the profile's Suspense boundary. */
export function ProfilePostsFromUrl({ blog, posts }: { blog: Owner; posts: Post[] }) {
  return <ProfilePostsView blog={blog} posts={posts} query={profileQueryOf(useSearchParams())} />;
}
