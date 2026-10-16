import Link from '@/components/NoPrefetchLink';
import type { Tag } from '@/lib/api';

/**
 * The author's own feed categories (#hashtags) on the line under an article title. The gateway sends at most a
 * few (app/src/post-tags.ts) plus `total`, the post's full count, so "+N" says how many more the author set.
 * Renders nothing when the article has no tags; that is never shown as "no tags".
 */
export default function PostTags({
  tags,
  total,
  max,
  className = '',
}: {
  tags: readonly Tag[] | undefined;
  total?: number;
  max: number;
  className?: string;
}) {
  const shown = (tags ?? []).slice(0, max);
  if (!shown.length) return null;
  const more = Math.max(0, (total ?? tags?.length ?? 0) - shown.length);
  return (
    <ul aria-label="作者標籤" className={`flex flex-wrap gap-x-2 text-[11px] leading-5 ${className}`}>
      {shown.map((tag) => (
        <li key={tag.slug} className="min-w-0 max-w-full">
          <Link
            href={`/tags/?tag=${encodeURIComponent(tag.slug)}`}
            className="block truncate text-zinc-500 hover:text-brand-700 hover:underline dark:text-zinc-400 dark:hover:text-brand-400"
          >
            #{tag.label}
          </Link>
        </li>
      ))}
      {more > 0 && (
        <li className="text-zinc-400 dark:text-zinc-500" title={`另有 ${more} 個標籤`}>
          +{more}
        </li>
      )}
    </ul>
  );
}
