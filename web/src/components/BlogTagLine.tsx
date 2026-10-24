import { filterChipClass, filterLabelClass, filterRowClass } from '@/components/FilterChips';
import Link from '@/components/NoPrefetchLink';
import type { GenreState } from '../../../app/src/blog-genres/resolve.ts';

// The second line under a blog's title, as on tag.observe.tw /media/<media>/ (2026-10-24): 標籤, a chip for each
// shown tag (the directory's chips, filtering /blogs/ by it), then 編輯標籤 to the blog's page on traffic.observe.tw,
// where tags are voted on and added. Nothing else on the line: no sources, counts or sign-in text (user rule).
export default function BlogTagLine({ state, tagsUrl }: { state?: GenreState; tagsUrl?: string | null }) {
  const shown = state?.status === 'ready' ? state.items.filter((item) => item.visible) : null;
  const domain = tagsUrl ? new URL(tagsUrl).pathname.split('/')[2] : null;
  return (
    <nav className={`${filterRowClass} mt-2`} aria-label="標籤">
      <span className={filterLabelClass}>標籤</span>
      {shown?.map((item) => (
        <Link key={item.genre} href={`/blogs/?genre=${encodeURIComponent(item.genre)}`} className={filterChipClass(false)}>
          {item.label}
        </Link>
      ))}
      {/* Tags never read yet (traffic not answered since the gateway started) leave just the link, no error. */}
      {shown && !shown.length && <span className="text-xs text-zinc-500 dark:text-zinc-400">尚無標籤</span>}
      {tagsUrl && (
        <a
          href={tagsUrl}
          title={domain ? `traffic.observe.tw/site/${decodeURIComponent(domain)}/` : undefined}
          className="ml-1 text-xs text-brand-700 hover:underline dark:text-brand-400"
        >
          編輯標籤
        </a>
      )}
    </nav>
  );
}
