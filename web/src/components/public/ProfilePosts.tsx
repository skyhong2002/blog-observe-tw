'use client';

// A blog profile's newest posts with its in-page ?q= filter (title and summary
// of the posts already on the page). The profile is prerendered without a
// query; the filter is applied in the browser.

import { useSearchParams } from 'next/navigation';
import ArticleListItem from '@/components/ArticleListItem';
import Link from '@/components/NoPrefetchLink';
import SearchBox from '@/components/SearchBox';
import StateNotice from '@/components/StateNotice';
import type { Post } from '@/lib/api';
import { blogHref } from '@/lib/page-links';
import { profileQueryOf } from '@/lib/public-query';

type Owner = { slug: string; name: string; canonicalPath?: string; url?: string | null };

export default function ProfilePostsView({ blog, posts: allPosts, query }: { blog: Owner; posts: Post[]; query: string }) {
  const posts = query
    ? allPosts.filter((post) => `${post.title} ${post.summary ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    : allPosts;
  if (!allPosts.length)
    return (
      <StateNotice
        tone="notice"
        title="還沒有收錄這個部落格的文章"
        actions={[
          ...(blog.url && /^https?:\/\//.test(blog.url) ? [{ href: blog.url, label: '到原站閱讀 ↗', primary: true, external: true }] : []),
          { href: '/blogs/', label: '看其他部落格' },
        ]}
      >
        我們已經收錄這個部落格，但還沒讀到它的公開文章。新文章出現在它的 RSS 之後，通常幾小時內就會列在這裡。
      </StateNotice>
    );
  return (
    <>
      <SearchBox
        action={blogHref(blog.slug, blog.canonicalPath)}
        id="profile-post-query"
        label="搜尋這個部落格的文章"
        placeholder="搜尋這個部落格的文章"
        defaultValue={query}
        maxLength={100}
        className="mb-1 w-full"
      />
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
              hideBlog={!post.blogSlug || post.blogSlug === blog.slug}
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
        <StateNotice
          title={`這頁的文章沒有提到「${query}」`}
          actions={[
            { href: `/articles/?${new URLSearchParams({ q: query, blog: blog.slug })}`, label: '搜尋這個部落格的內文', primary: true },
          ]}
        >
          這裡只比對本頁文章的標題與摘要；搜尋內文可以找到更早的文章。
        </StateNotice>
      )}
    </>
  );
}

/** Reads ?q= inside the profile's Suspense boundary. */
export function ProfilePostsFromUrl({ blog, posts }: { blog: Owner; posts: Post[] }) {
  return <ProfilePostsView blog={blog} posts={posts} query={profileQueryOf(useSearchParams())} />;
}
