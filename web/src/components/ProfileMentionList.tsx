// One blog's citing articles as rows (the blog page's 最近被這些部落格提到 and /blogs/<key>/mentions/). No server-only
// imports: the full list's client loader (app/blogs/[slug]/mentions/MoreMentions.tsx) renders it too.
import { displayTitle, taipei } from '@/lib/api';
import { blogLink } from '@/lib/page-links';
import { externalHref } from '@/lib/relations';
import BlogIcon from './BlogIcon';
import Link from './NoPrefetchLink';

export type ProfileMention = {
  postId: number;
  postTitle: string;
  postUrl: string | null;
  publishedAt: string | null;
  sourceBlogSlug: string;
  sourceBlogName: string;
  sourceIconUrl?: string | null;
  anchor?: string;
  quote: string;
};
export type ProfileMentions = { days: number; truncated: boolean; items: ProfileMention[] };
/** /blogs/<key>/mentions/ (loadProfileMentionFeed): the whole list, a page at a time. */
export type ProfileMentionFeed = { items: ProfileMention[]; nextCursor: string | null };

const muted = 'text-zinc-500 dark:text-zinc-400';

export function MentionList({ items }: { items: ProfileMention[] }) {
  return (
    <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 dark:divide-zinc-800 dark:border-zinc-800">
      {items.map((item) => {
        const url = externalHref(item.postUrl);
        const title = displayTitle(item.postTitle) || '未命名文章';
        return (
          <li key={item.postId} className="space-y-1 px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <Link
                {...blogLink(item.sourceBlogSlug)}
                className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline dark:text-brand-400"
              >
                <BlogIcon media={item.sourceBlogSlug} iconUrl={item.sourceIconUrl} title={item.sourceBlogName} size={18} />
                {item.sourceBlogName}
              </Link>
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className="min-w-0 hover:underline">
                  〈{title}〉
                </a>
              ) : (
                <span className="min-w-0">〈{title}〉</span>
              )}
              {item.publishedAt && <span className={`text-xs tabular-nums ${muted}`}>{taipei(item.publishedAt)}</span>}
            </div>
            {item.quote && <p className={`line-clamp-2 text-sm ${muted}`}>{item.quote}</p>}
          </li>
        );
      })}
    </ul>
  );
}
