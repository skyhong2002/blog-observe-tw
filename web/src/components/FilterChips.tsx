import Link from './NoPrefetchLink';

// Ported from tag.observe.tw: values that narrow the list you are on are round chips;
// switching to another page or view is a SectionTabs row, so the two never look alike.

/** One filter chip; `muted` greys out a choice that has little or no data. */
export const filterChipClass = (current: boolean, muted = false) =>
  `whitespace-nowrap rounded-full px-3 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
    current
      ? 'bg-brand-700 text-white'
      : `bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 ${muted ? 'text-zinc-500 dark:text-zinc-500' : 'text-zinc-700 dark:text-zinc-300'}`
  }`;
export const filterRowClass = 'flex flex-wrap items-center gap-1.5 text-sm';
export const filterLabelClass = 'mr-1 text-xs text-zinc-500 dark:text-zinc-400';

export type FilterChip = { href: string; label: string; current?: boolean; title?: string };

/** A row of link chips. `showLabel` prints the row's label when a page has several rows. */
export default function FilterChips({
  label,
  items,
  showLabel = false,
  className = '',
}: {
  label: string;
  items: FilterChip[];
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={`${filterRowClass} ${className}`}>
      {showLabel && <span className={filterLabelClass}>{label}</span>}
      {items.map((item) => (
        <Link
          key={item.href + item.label}
          href={item.href}
          scroll={false}
          title={item.title}
          aria-current={item.current ? 'page' : undefined}
          className={filterChipClass(Boolean(item.current))}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
