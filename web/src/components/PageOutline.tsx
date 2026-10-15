'use client';

// Adapted from tag.observe.tw afe0a65 (web/src/components/PageOutline.tsx), MIT, Copyright (c) 2026 Sky Hong.
import { useEffect, useRef, useState } from 'react';

export type OutlineEntry = { id: string; title: string; hint?: string; mono?: boolean; children?: OutlineEntry[] };

// A heading counts as being read once it is this close to the top, just under
// the sticky header (headings jump to scroll-mt-20/24).
const READING_LINE = 120;

const flatten = (entries: OutlineEntry[]): string[] => entries.flatMap((e) => [e.id, ...flatten(e.children ?? [])]);
/** Endpoint paths wrap after a slash (`/blogs/{slug}/` + `articles`), never inside a segment. */
const pathBreaks = (path: string) =>
  path.split(/(?<=\/)/).map((part, i, parts) => (
    // Prefix of the path up to this part: unique and stable for a fixed string.
    <span key={parts.slice(0, i + 1).join('')}>
      {part}
      {i < parts.length - 1 && <wbr />}
    </span>
  ));

// A long page's side outline (/api/): its headings, with the one being
// read marked. At the foot of the page, where the last short sections never
// reach the reading line, the last heading is. It renders the page grid's right
// column (wide screens only); its sticky box scrolls to keep the marked entry in view.
export default function PageOutline({ entries }: { entries: OutlineEntry[] }) {
  const [active, setActive] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const ids = flatten(entries).join(' ');

  useEffect(() => {
    const headings = ids
      .split(' ')
      .map((id) => document.getElementById(id))
      .filter((h): h is HTMLElement => h !== null);
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: string | null = null;
      for (const h of headings) {
        if (h.getBoundingClientRect().top > READING_LINE) break;
        current = h.id;
      }
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom && headings.length) current = headings[headings.length - 1].id;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids]);

  useEffect(() => {
    const box = navRef.current;
    const link = active && navRef.current?.querySelector<HTMLElement>(`a[href="#${CSS.escape(active)}"]`);
    if (!box) return;
    // Above the first heading: show the outline from its start.
    if (!link) {
      box.scrollTop = 0;
      return;
    }
    // Scroll only the outline's box: scrollIntoView would also move the page.
    const top = link.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + link.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + link.offsetHeight - box.clientHeight;
  }, [active]);

  const item = (entry: OutlineEntry, nested: boolean) =>
    `-ml-px block border-l py-1 ${nested ? 'pl-6 text-[13px]' : 'pl-3'} ${entry.mono ? '[overflow-wrap:anywhere] font-mono text-xs' : ''} ${
      active === entry.id
        ? 'border-brand-600 font-medium text-brand-700 dark:border-brand-400 dark:text-brand-400'
        : 'border-transparent text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-zinc-100'
    }`;
  const link = (entry: OutlineEntry, nested: boolean) => (
    <a href={`#${entry.id}`} title={entry.hint} className={item(entry, nested)} aria-current={active === entry.id ? 'location' : undefined}>
      {entry.mono ? pathBreaks(entry.title) : entry.title}
    </a>
  );

  return (
    <aside className="hidden lg:block">
      <nav
        ref={navRef}
        aria-label="本頁大綱"
        className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto overscroll-contain pb-6 text-sm leading-snug"
      >
        <h2 className="mb-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">本頁大綱</h2>
        <ol className="border-l border-zinc-200 dark:border-zinc-800">
          {entries.map((entry) => (
            <li key={entry.id}>
              {link(entry, false)}
              {entry.children && entry.children.length > 0 && (
                <ol>
                  {entry.children.map((child) => (
                    <li key={child.id}>{link(child, true)}</li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </aside>
  );
}
