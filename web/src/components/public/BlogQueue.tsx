'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BlogSubmitForm } from '@/components/BlogSuggestion';
import FilterChips from '@/components/FilterChips';
import MediaTabs from '@/components/MediaTabs';
import MethodLink from '@/components/MethodLink';
import Link from '@/components/NoPrefetchLink';
import TableScroller from '@/components/TableScroller';
import { taipei } from '@/lib/api';
import { CANDIDATE_SOURCES, candidateReasonText } from '@/lib/candidate-reasons';
import { blogHref } from '@/lib/page-links';
import { table } from '@/lib/table-styles';
import { asIs, usePublicJson } from '@/lib/use-public-json';

// The public 待查清單: every blog the automatic review is waiting on, has checked or has
// decided (app/src/blog-suggestions.ts loadBlogQueue), answered in the browser from /api/blog-queue.
export type QueueState = 'waiting' | 'failed' | 'listed' | 'rejected';
export type QueueItem = {
  url: string;
  name: string | null;
  source: string;
  state: QueueState;
  addedAt: string | null;
  checkedAt: string | null;
  reason: string | null;
  slug: string | null;
  contentStatus?: string;
  contentPosts?: number;
};
export type QueueSort = 'added' | 'checked' | 'site' | 'state' | 'source';
export type Queue = {
  filters: { q: string; state: string; source: string; page: number; sort: QueueSort; dir: 'asc' | 'desc' };
  pagination: { page: number; pages: number; total: number };
  states: Record<QueueState, number>;
  sources: Record<string, number>;
  items: QueueItem[];
};

export const QUEUE_STATE_LABELS: Record<QueueState, string> = {
  waiting: '等待檢查',
  failed: '未通過',
  listed: '已收錄',
  rejected: '未收錄',
};
/** Dates start newest first; the other columns start from the top of their order (app/src/blog-suggestions.ts). */
const ASCENDING_FIRST = new Set<QueueSort>(['site', 'state', 'source']);
const site = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const tone: Record<QueueState, string> = {
  waiting: 'text-zinc-600 dark:text-zinc-400',
  failed: 'text-amber-700 dark:text-amber-400',
  listed: 'text-brand-700 dark:text-brand-400',
  rejected: 'text-zinc-500',
};

function SearchBox({ q, onSearch }: { q: string; onSearch: (q: string) => void }) {
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  return (
    <form
      className="w-full sm:w-80"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(text.trim());
      }}
    >
      <label htmlFor="queue-query" className="sr-only">
        搜尋網址
      </label>
      <input
        id="queue-query"
        type="search"
        value={text}
        autoComplete="off"
        enterKeyHint="search"
        placeholder="搜尋網址"
        onChange={(event) => setText(event.target.value)}
        className="min-h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-base sm:text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
    </form>
  );
}

export function BlogQueueView({
  queue,
  status,
  onSearch = () => {},
  submit,
}: {
  queue: Queue | null;
  status: 'ready' | 'pending' | 'error';
  onSearch?: (q: string) => void;
  /** The 新增部落格 form (BlogSubmitForm), above the filters; left out where nobody can add (render tests). */
  submit?: React.ReactNode;
}) {
  const filters = queue?.filters ?? { q: '', state: '', source: '', page: 1, sort: 'added', dir: 'desc' };
  const reasons = Boolean(queue?.items.some((item) => candidateReasonText(item.reason)));
  const href = (patch: Record<string, string | null>) => {
    // The default order (newest added first) stays out of the link.
    const sorted = filters.sort !== 'added' || filters.dir !== 'desc';
    const params = new URLSearchParams(
      Object.entries({
        q: filters.q,
        state: filters.state,
        source: filters.source,
        ...(sorted ? { sort: filters.sort, dir: filters.dir } : {}),
      }).filter(([, value]) => value),
    );
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    if (params.get('sort') === 'added' && params.get('dir') === 'desc') {
      params.delete('sort');
      params.delete('dir');
    }
    const search = params.toString();
    return search ? `/queue/?${search}` : '/queue/';
  };
  const Th = ({ col, label, lead = false }: { col?: QueueSort; label: string; lead?: boolean }) => {
    const className = lead ? table.leadHead : table.cell;
    if (!col)
      return (
        <th scope="col" className={className}>
          {label}
        </th>
      );
    const current = filters.sort === col;
    const dir = current ? (filters.dir === 'asc' ? 'desc' : 'asc') : ASCENDING_FIRST.has(col) ? 'asc' : 'desc';
    return (
      <th scope="col" className={className} aria-sort={current ? (filters.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
        <Link
          href={href({ sort: col, dir, page: null })}
          scroll={false}
          className={`inline-flex items-center gap-0.5 whitespace-nowrap hover:text-brand-700 dark:hover:text-brand-400 ${current ? 'text-zinc-900 dark:text-zinc-100' : ''}`}
        >
          {label}
          <span aria-hidden="true" className={current ? '' : 'text-zinc-400 dark:text-zinc-600'}>
            {current ? (filters.dir === 'desc' ? '▼' : '▲') : '↕'}
          </span>
        </Link>
      </th>
    );
  };
  return (
    <div className="space-y-5 pb-8">
      <header>
        <MediaTabs current="queue" />
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">待查清單</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {queue ? `${queue.pagination.total.toLocaleString('zh-TW')} 個網站` : status === 'error' ? '暫時無法載入' : '正在載入'} ·{' '}
          <MethodLink />
        </p>
      </header>
      {submit}
      {queue && (
        <div className="space-y-2">
          <FilterChips
            label="狀態"
            showLabel
            items={[
              { href: href({ state: null }), label: '全部', current: !filters.state },
              ...(Object.keys(QUEUE_STATE_LABELS) as QueueState[]).map((state) => ({
                href: href({ state }),
                label: `${QUEUE_STATE_LABELS[state]} ${queue.states[state] ?? 0}`,
                current: filters.state === state,
              })),
            ]}
          />
          <FilterChips
            label="來源"
            showLabel
            items={[
              { href: href({ source: null }), label: '全部', current: !filters.source },
              ...Object.entries(CANDIDATE_SOURCES).map(([source, label]) => ({
                href: href({ source }),
                label: `${label} ${queue.sources[source] ?? 0}`,
                current: filters.source === source,
              })),
            ]}
          />
        </div>
      )}
      <SearchBox q={filters.q} onSearch={onSearch} />
      {status === 'error' ? (
        <p role="status" className="rounded-xl border border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          待查清單暫時無法載入，請稍後再試。
        </p>
      ) : !queue ? (
        <p aria-busy="true" className="py-8 text-sm text-zinc-500">
          正在載入待查清單…
        </p>
      ) : queue.items.length ? (
        <>
          {/* 說明 only when a row on this page has one; an unchecked site leaves 最近檢查 blank. */}
          <TableScroller card label="待查清單表格，可左右捲動">
            <table aria-busy={status === 'pending'} className={`w-full min-w-[52rem] text-sm ${status === 'pending' ? 'opacity-60' : ''}`}>
              <thead className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <Th col="site" label="網站" lead />
                  <Th col="state" label="狀態" />
                  {reasons && <Th label="說明" />}
                  <Th col="source" label="來源" />
                  <Th col="checked" label="最近檢查" />
                  <Th col="added" label="加入" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {queue.items.map((item) => (
                  <tr key={`${item.url} ${item.source}`} className={`${table.row} [&>td]:align-baseline`}>
                    <td className={table.lead}>
                      <div className={table.leadBox}>
                        <a
                          href={item.url}
                          rel="nofollow noopener noreferrer"
                          target="_blank"
                          className={`${table.leadText} block font-medium sm:max-w-72 hover:underline`}
                          title={item.url}
                        >
                          {site(item.url)}
                        </a>
                        {item.name && item.name !== item.url && site(item.name) !== site(item.url) && (
                          <span className={`${table.leadExtra} ${table.leadText} block text-xs text-zinc-500 sm:max-w-72`}>
                            {item.name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={`${table.cell} whitespace-nowrap ${tone[item.state]}`}>
                      {item.state === 'listed' && item.slug ? (
                        <Link href={blogHref(item.slug)} className="hover:underline">
                          已收錄 →
                        </Link>
                      ) : (
                        QUEUE_STATE_LABELS[item.state]
                      )}
                      {item.state === 'listed' && item.contentStatus && (
                        <span className="block text-xs text-zinc-500">
                          {item.contentStatus === 'ready'
                            ? `${item.contentPosts} 篇文章`
                            : item.contentStatus === 'failed'
                              ? '文章抓取待修復'
                              : '文章待抓取'}
                        </span>
                      )}
                    </td>
                    {reasons && (
                      <td className={`${table.cell} text-xs text-zinc-600 dark:text-zinc-400`}>{candidateReasonText(item.reason)}</td>
                    )}
                    <td className={`${table.cell} whitespace-nowrap text-xs`}>{CANDIDATE_SOURCES[item.source] ?? item.source}</td>
                    <td className={`${table.cell} whitespace-nowrap text-xs tabular-nums text-zinc-500`}>
                      {item.checkedAt ? taipei(item.checkedAt) : ''}
                    </td>
                    <td className={`${table.cell} whitespace-nowrap text-xs tabular-nums text-zinc-500`}>{taipei(item.addedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroller>
          {queue.pagination.pages > 1 && (
            <nav aria-label="待查清單分頁" className="flex justify-between text-sm">
              {queue.pagination.page > 1 ? (
                <Link className="py-2 text-brand-700 dark:text-brand-400" href={href({ page: String(queue.pagination.page - 1) })}>
                  ← 上一頁
                </Link>
              ) : (
                <span />
              )}
              <span className="py-2 text-zinc-500">
                第 {queue.pagination.page} / {queue.pagination.pages} 頁
              </span>
              {queue.pagination.page < queue.pagination.pages ? (
                <Link className="py-2 text-brand-700 dark:text-brand-400" href={href({ page: String(queue.pagination.page + 1) })}>
                  下一頁 →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      ) : (
        <p className="py-8 text-sm text-zinc-500">
          {filters.q ? `待查清單裡沒有「${filters.q}」。` : '沒有符合條件的網站。'}
          {filters.q && (
            <>
              {' '}
              <Link className="text-brand-700 hover:underline dark:text-brand-400" href={`/blogs/?q=${encodeURIComponent(filters.q)}`}>
                到部落格目錄搜尋或新增 →
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** Reads ?q=&state=&source=&page=&sort=&dir= and answers it from /api/blog-queue, keeping the last answer on screen while the next loads. */
export default function BlogQueueFromUrl() {
  const params = useSearchParams();
  const router = useRouter();
  const query = new URLSearchParams(
    ['q', 'state', 'source', 'page', 'sort', 'dir'].flatMap((key) => {
      const value = params.get(key);
      return value ? [[key, value] as [string, string]] : [];
    }),
  ).toString();
  const load = usePublicJson<Queue>(`/api/blog-queue${query ? `?${query}` : ''}`, asIs);
  const [shown, setShown] = useState<Queue | null>(null);
  useEffect(() => {
    if (load?.status === 'ready') setShown(load.data);
  }, [load]);
  const onSearch = (q: string) => {
    const next = new URLSearchParams(params.toString());
    next.delete('page');
    if (q) next.set('q', q);
    else next.delete('q');
    const search = next.toString();
    router.push(search ? `/queue/?${search}` : '/queue/', { scroll: false });
  };
  const current = load?.status === 'ready' ? load.data : shown;
  const status = load?.status === 'ready' ? 'ready' : load?.status === 'pending' ? 'pending' : 'error';
  return (
    <BlogQueueView
      queue={status === 'error' ? null : current}
      status={status}
      onSearch={onSearch}
      submit={<BlogSubmitForm key={params.get('q') || ''} initialAddress={params.get('q') || ''} />}
    />
  );
}
