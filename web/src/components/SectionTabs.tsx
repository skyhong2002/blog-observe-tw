import Link from './NoPrefetchLink';

export default function SectionTabs({
  label,
  tabs,
  className = '',
}: {
  label: string;
  tabs: Array<{ href: string; label: string; current?: boolean }>;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={`inline-flex max-w-full gap-1 overflow-x-auto rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-900 ${className}`}
    >
      {/* The current tab: white fill, a ring, brand ink and a heavier weight, so it never depends on the faint fill alone. */}
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.current ? 'page' : undefined}
          className={`flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-md px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${tab.current ? 'bg-white font-semibold text-brand-800 shadow-sm ring-1 ring-zinc-300 dark:bg-zinc-700 dark:text-white dark:ring-zinc-500' : 'text-zinc-600 hover:bg-white/60 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
