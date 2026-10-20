// One look for every submit-to-search box (/articles/, /tech/, a blog's posts): the header's SiteSearch frame — one
// bordered field with the magnifier button inside it — so a search box reads the same wherever it is. The label is
// for screen readers only; the placeholder says what is searched. No hooks: usable from server and client views.

import type { ReactNode } from 'react';

export const searchFrame =
  'flex min-w-0 items-center rounded-md border border-zinc-300 bg-zinc-50 focus-within:border-brand-600 dark:border-zinc-700 dark:bg-zinc-900';
export const searchInput =
  'w-full min-w-0 bg-transparent py-2 pl-3 text-base text-zinc-900 outline-none sm:text-sm dark:text-zinc-100 [&::-webkit-search-cancel-button]:hidden';

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </svg>
  );
}

export default function SearchBox({
  action,
  id,
  label,
  placeholder,
  defaultValue,
  maxLength,
  name = 'q',
  className = 'w-full',
  children,
}: {
  action: string;
  id: string;
  label: string;
  placeholder: string;
  defaultValue?: string;
  maxLength?: number;
  name?: string;
  className?: string;
  /** Hidden inputs that keep the page's other filters. */
  children?: ReactNode;
}) {
  return (
    <form action={action} role="search" className={`${searchFrame} ${className}`}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        key={defaultValue}
        id={id}
        name={name}
        type="search"
        defaultValue={defaultValue}
        maxLength={maxLength}
        placeholder={placeholder}
        className={searchInput}
      />
      {children}
      <button
        type="submit"
        aria-label="搜尋"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-zinc-600 hover:text-brand-700 focus-visible:outline-brand-600 dark:text-zinc-400 dark:hover:text-brand-400"
      >
        <SearchIcon />
      </button>
    </form>
  );
}
