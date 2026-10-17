'use client';
import { useState } from 'react';
import { safeAdminLink } from '@/lib/admin-client';
export const input =
  'mt-1 min-h-11 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';
export const button =
  'min-h-11 rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800';
export const primary = `${button} bg-brand-700 text-white hover:bg-brand-800 dark:bg-brand-700 dark:hover:bg-brand-800`;
export type RunAction = (path: string, body: unknown) => Promise<unknown>;
export function External({ url, children }: { url?: string | null; children?: React.ReactNode }) {
  const safe = safeAdminLink(url);
  return safe ? (
    <a className="break-all text-brand-700 underline dark:text-brand-400" href={safe} target="_blank" rel="noopener noreferrer">
      {children ?? url}
    </a>
  ) : (
    <span className="break-all">{children ?? url ?? '未提供'}</span>
  );
}
export function Evidence({ value, label = '原始證據', open = false }: { value: unknown; label?: string; open?: boolean }) {
  let data = value;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {}
  }
  const text = JSON.stringify(data ?? null, null, 2);
  return (
    <details className="text-xs" open={open}>
      <summary className="min-h-8 cursor-pointer py-2 text-zinc-600 dark:text-zinc-400">{label}</summary>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-100 p-3 dark:bg-zinc-950">
        {text.slice(0, 30000)}
      </pre>
      {text.length > 30000 ? <p className="mt-2 text-zinc-500">此處節錄前 30,000 字元。</p> : null}
    </details>
  );
}
export function useAdminPaging() {
  const [history, setHistory] = useState<string[]>(['0']);
  return {
    cursor: history.at(-1) ?? '0',
    page: history.length,
    reset: () => setHistory(['0']),
    previous: () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h)),
    next: (cursor: string) => setHistory((h) => [...h, cursor]),
  };
}
export function Pager({
  nextCursor,
  paging,
  busy,
}: {
  nextCursor: string | number | null;
  paging: ReturnType<typeof useAdminPaging>;
  busy: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={button} disabled={busy || paging.page < 2} onClick={paging.previous}>
        上一頁
      </button>
      <span className="text-sm">第 {paging.page} 頁</span>
      <button type="button" className={button} disabled={busy || nextCursor === null} onClick={() => paging.next(String(nextCursor))}>
        下一頁
      </button>
    </div>
  );
}
