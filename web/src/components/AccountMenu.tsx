'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { loginHref, useSession } from '@/lib/session';
import Avatar from './Avatar';

const READER_LINKS = [
  ['/my/', '我的追蹤'],
  ['/me/feed.xml', '個人 RSS'],
  ['/me/opml', '匯出 OPML'],
] as const;

// Sign-in entry in the header. Renders nothing until /auth/me answers, or at
// all when Google login is not configured, so the header never jumps for
// readers who don't use it.
export default function AccountMenu() {
  const session = useSession();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Navigation changes intentionally reset this UI state.
  useEffect(() => setOpen(false), [path]);

  if (!session?.enabled) return null;
  const user = session.user;
  if (!user)
    return (
      <a
        href={loginHref(path)}
        // Keep the query too (/admin/media/?url=… from the bookmarklet).
        onClick={(event) => {
          event.currentTarget.href = loginHref(location.pathname + location.search);
        }}
        className="block rounded-md px-2 py-1.5 text-sm whitespace-nowrap text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        登入
      </a>
    );
  const label = user.name ?? user.email;
  return (
    <div ref={box} className="relative flex">
      <button
        type="button"
        aria-label={`帳號：${label}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
        className="flex rounded-full hover:ring-2 hover:ring-brand-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:hover:ring-brand-800"
      >
        <Avatar src={user.picture} label={label} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-60 rounded-lg border border-zinc-200 bg-white p-2 text-sm shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
        >
          <div className="flex items-center gap-3 px-2 py-1.5">
            <Avatar src={user.picture} label={label} size={40} />
            <div className="min-w-0">
              <p className="truncate font-medium">{label}</p>
              {user.name && <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{user.email}</p>}
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{user.role === 'admin' ? '管理員' : '讀者'}</p>
            </div>
          </div>
          {READER_LINKS.map(([href, label]) => (
            <Link key={href} role="menuitem" href={href} className="block rounded-md px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
              {label}
            </Link>
          ))}
          {user.role === 'admin' && (
            <Link
              role="menuitem"
              href="/admin/discovery/"
              className="block rounded-md px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              管理後台
            </Link>
          )}
          <form method="post" action="/auth/logout">
            <button
              type="submit"
              role="menuitem"
              className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              登出
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
