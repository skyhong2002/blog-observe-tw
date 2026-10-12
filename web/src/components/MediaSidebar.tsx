'use client';
import { type ReactNode, useEffect, useId, useState } from 'react';

/** Sidebar sections a link or the URL hash can point at; on phones the collapsed sidebar opens for them. */
const anchors = ['#authors', '#source', '#content-source', '#traffic'];
export default function MediaSidebar({ children, label = '媒體資料與媒體關係' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    const reveal = () => {
      if (!anchors.includes(location.hash)) return;
      setOpen(true);
      requestAnimationFrame(() => document.querySelector(location.hash)?.scrollIntoView({ block: 'start' }));
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element).closest('a');
      if (link && anchors.includes(link.getAttribute('href') ?? '')) setOpen(true);
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('hashchange', reveal);
      document.removeEventListener('click', onClick);
    };
  }, []);
  return (
    <aside className="min-w-0 lg:col-start-2 lg:row-start-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded border border-zinc-200 px-3 py-2.5 text-xs text-zinc-600 lg:hidden dark:border-zinc-800 dark:text-zinc-400"
      >
        {label}
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      <div id={id} className={`${open ? 'grid' : 'hidden'} mt-3 grid-cols-1 gap-3 sm:grid-cols-2 lg:mt-0 lg:grid lg:grid-cols-1`}>
        {children}
      </div>
    </aside>
  );
}
