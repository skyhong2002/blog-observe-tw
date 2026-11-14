import Link from './NoPrefetchLink';

// Ported from tag.observe.tw: values that narrow the list you are on are round chips;
// switching to another page or view is a SectionTabs row, so the two never look alike.

/** One filter chip; `muted` greys out a choice that has little or no data. */
export const filterChipClass = (current: boolean, muted = false) =>
  // Phones get a 40px tall target; a mouse keeps the compact chip.
  `inline-flex min-h-10 items-center whitespace-nowrap rounded-full px-3 py-1 sm:min-h-8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
    current
      ? 'bg-brand-700 text-white'
      : `bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 ${muted ? 'text-zinc-500 dark:text-zinc-500' : 'text-zinc-700 dark:text-zinc-300'}`
  }`;
export const filterRowClass = 'flex flex-wrap items-center gap-1.5 text-sm';
export const filterLabelClass = 'mr-1 shrink-0 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400';

export type FilterChip = { href: string; label: string; current?: boolean; title?: string };

/** A row of link chips. `showLabel` prints the row's label when a page has several rows. `scroll`: on phones the
 *  row stays one line and scrolls sideways instead of wrapping into several, so a list below starts higher. */
export default function FilterChips({
  label,
  items,
  showLabel = false,
  scroll = false,
  className = '',
}: {
  label: string;
  items: FilterChip[];
  showLabel?: boolean;
  scroll?: boolean;
  className?: string;
}) {
  const oneLine = scroll ? 'max-sm:-mx-4 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4 max-sm:[&>*]:shrink-0' : '';
  return (
    <nav aria-label={label} className={`${filterRowClass} ${oneLine} ${className}`}>
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
