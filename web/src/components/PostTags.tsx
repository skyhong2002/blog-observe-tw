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
  oneLineOnPhones = false,
  className = '',
}: {
  tags: readonly Tag[] | undefined;
  total?: number;
  max: number;
  /** Article lists: on phones the tags stay on one line (the ones that do not fit are cut at the edge). */
  oneLineOnPhones?: boolean;
  className?: string;
}) {
  const shown = (tags ?? []).slice(0, max);
  if (!shown.length) return null;
  const more = Math.max(0, (total ?? tags?.length ?? 0) - shown.length);
  return (
    <ul
      aria-label="作者標籤"
      className={`flex flex-wrap gap-x-2 text-[13px] leading-6 ${oneLineOnPhones ? 'max-sm:flex-nowrap max-sm:overflow-hidden max-sm:leading-5 max-sm:[&>li]:max-w-[75%] max-sm:[&>li]:shrink-0' : ''} ${className}`}
    >
      {shown.map((tag) => (
        <li key={tag.slug} className="min-w-0 max-w-full">
          <Link
            href={`/tags/?tag=${encodeURIComponent(tag.slug)}`}
            className="block truncate text-zinc-600 hover:text-brand-700 hover:underline dark:text-zinc-400 dark:hover:text-brand-400"
          >
            #{tag.label}
          </Link>
        </li>
      ))}
      {more > 0 && (
        <li className="text-zinc-500 dark:text-zinc-400" title={`另有 ${more} 個標籤`}>
          +{more}
        </li>
      )}
    </ul>
  );
}
