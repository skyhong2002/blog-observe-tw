'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import BlogIcon from '@/components/BlogIcon';
import TableScroller from '@/components/TableScroller';
import { adminGet, safeAdminLink } from '@/lib/admin-client';
import { taipei } from '@/lib/api';
import { type RobotsStatus, robotsLabel, robotsTone } from '@/lib/robots';
import { table } from '@/lib/table-styles';
import { button, Evidence, input, Pager, primary, type RunAction, useAdminPaging } from './shared';

type Candidate = {
  id: number;
  name: string | null;
  url: string;
  sourceType: string;
  sourceUrl: string | null;
  sourceEvidence: unknown;
  status: string;
  discoveredAt: string;
  robots?: RobotsStatus | null;
};
type Payload = { candidates: Candidate[]; nextCursor: number | null };

const STATUSES = [
  ['candidate', '待判定'],
  ['approved', '已核准'],
  ['rejected', '已拒絕'],
] as const;
/** Where discovery found the URL (discovery_candidates.source_type). */
const SOURCES: Record<string, string> = {
  'blogblog-club': 'BlogBlog.Club 名單',
  'indieweb-wiki': 'IndieWeb 名單',
  'article-link': '文章裡的連結',
  blogroll: '部落格友站連結',
  'seed-url-resolution': '種子名單',
  'owner-exclusion': '站主要求排除',
};
const host = (url: string | null) => {
  try {
    return url ? new URL(url).host.replace(/^www\./, '') : '';
  } catch {
    return url ?? '';
  }
};
const chip = (active: boolean) =>
  `whitespace-nowrap rounded-full px-3 py-1 ${active ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'}`;

export default function Candidates({ run, busy }: { run: RunAction; busy: boolean }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState({ q: '', status: 'candidate' });
  const paging = useAdminPaging();
  const cursor = paging.cursor;
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<unknown>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await adminGet<Payload>(`/api/admin/discovery?${new URLSearchParams({ ...filter, cursor, limit: '25' })}`));
      setSelected([]);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : '候選載入失敗。');
    } finally {
      setLoading(false);
    }
  }, [filter, cursor]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (action: string) => {
    try {
      const out = await run('/api/admin/discovery/review', { ids: selected, action, note: note.trim() });
      setResult(out);
      await load();
    } catch {
      /* shared action message */
    }
  };
  const rows = data?.candidates ?? [];
  const pending = filter.status === 'candidate';
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <fieldset className="flex flex-wrap gap-1.5 text-sm">
          <legend className="sr-only">狀態</legend>
          {STATUSES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter.status === value}
              className={chip(filter.status === value)}
              onClick={() => {
                paging.reset();
                setFilter((f) => ({ ...f, status: value }));
              }}
            >
              {label}
            </button>
          ))}
        </fieldset>
        <form
          className="flex w-full max-w-sm gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            paging.reset();
            setFilter((f) => ({ ...f, q: query.trim() }));
          }}
        >
          <label className="min-w-0 flex-1 text-sm">
            <span className="sr-only">名稱或網址</span>
            <input
              className={`${input} !mt-0`}
              type="search"
              placeholder="搜尋名稱或網址"
              maxLength={150}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button type="submit" className={button} disabled={loading}>
            搜尋
          </button>
        </form>
      </div>
      {pending ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          勾選後寫下原因再處理，每批最多 25 筆。「驗證」重新抓首頁與 RSS 更新證據；「核准」仍要通過來源身分、RSS
          與爬取安全檢查；「拒絕」不會移除已收錄的部落格。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {loading && !data ? (
        <p role="status">載入候選中…</p>
      ) : (
        <TableScroller card label="候選來源表格，可左右捲動">
          <table aria-busy={loading} className={`w-full min-w-[56rem] whitespace-nowrap text-sm ${loading ? 'opacity-60' : ''}`}>
            <thead className="bg-(--table-head-bg) text-left text-xs text-zinc-600 dark:text-zinc-400">
              <tr>
                {pending ? (
                  <th scope="col" className={`${table.cell} w-10`}>
                    <input
                      type="checkbox"
                      aria-label="選取本頁"
                      className="h-4 w-4"
                      checked={rows.length > 0 && selected.length === rows.length}
                      disabled={busy || !rows.length}
                      onChange={(e) => setSelected(e.target.checked ? rows.map((c) => c.id) : [])}
                    />
                  </th>
                ) : null}
                <th scope="col" className={table.cell}>
                  候選
                </th>
                <th scope="col" className={table.cell}>
                  發現來源
                </th>
                <th scope="col" className={table.cell}>
                  robots.txt
                </th>
                <th scope="col" className={table.cell}>
                  發現時間
                </th>
                <th scope="col" className={table.cell}>
                  <span className="sr-only">證據</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((c) => {
                const robots = robotsLabel(c.robots);
                const link = safeAdminLink(c.url);
                const from = safeAdminLink(c.sourceUrl);
                const checked = selected.includes(c.id);
                return (
                  <Fragment key={c.id}>
                    <tr className={`${table.row} ${checked ? 'bg-brand-50/60 dark:bg-brand-950/40' : ''}`}>
                      {pending ? (
                        <td className={table.cell}>
                          <input
                            type="checkbox"
                            aria-label={`選取 ${c.name || c.url}`}
                            className="h-4 w-4"
                            checked={checked}
                            disabled={busy}
                            onChange={(e) => setSelected((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((id) => id !== c.id)))}
                          />
                        </td>
                      ) : null}
                      <td className={table.cell}>
                        <div className="flex items-center gap-2">
                          <BlogIcon media={`candidate-${c.id}`} title={c.name || host(c.url)} size={20} />
                          <div className="min-w-0">
                            <div className="max-w-72 truncate font-medium" title={`#${c.id}`}>
                              {c.name || host(c.url)}
                            </div>
                            {link ? (
                              <a
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block max-w-72 truncate text-xs text-brand-700 hover:underline dark:text-brand-400"
                                title={c.url}
                              >
                                {c.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                              </a>
                            ) : (
                              <span className="block max-w-72 truncate text-xs text-zinc-500">{c.url}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className={`${table.cell} text-xs`}>
                        <div>{SOURCES[c.sourceType] ?? c.sourceType}</div>
                        {from ? (
                          <a
                            href={from}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block max-w-56 truncate text-zinc-500 hover:underline"
                            title={c.sourceUrl ?? undefined}
                          >
                            {c.sourceUrl?.replace(/^https?:\/\/(www\.)?/, '')}
                          </a>
                        ) : null}
                      </td>
                      <td className={`${table.cell} text-xs ${robotsTone[robots.tone]}`}>
                        <span className="block max-w-32 truncate" title={robots.title}>
                          {robots.label}
                        </span>
                      </td>
                      <td className={`${table.cell} text-xs tabular-nums text-zinc-500`}>{taipei(c.discoveredAt)}</td>
                      <td className={`${table.cell} text-right`}>
                        <button
                          type="button"
                          aria-expanded={open === c.id}
                          className="text-xs text-zinc-600 hover:text-brand-700 hover:underline dark:text-zinc-400"
                          onClick={() => setOpen(open === c.id ? null : c.id)}
                        >
                          {open === c.id ? '收起證據' : '查看證據'}
                        </button>
                      </td>
                    </tr>
                    {open === c.id ? (
                      <tr>
                        <td colSpan={pending ? 6 : 5} className="whitespace-normal px-3 pb-3">
                          <p className="text-xs text-zinc-500">發現路徑、blogroll 與 RSS 驗證證據</p>
                          <Evidence value={c.sourceEvidence} label="原始資料" open />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td colSpan={pending ? 6 : 5} className="px-3 py-8 text-center text-zinc-500">
                    沒有符合條件的候選。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </TableScroller>
      )}
      {pending && data ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <label className="min-w-64 flex-1 text-sm">
            處理原因（必填，會留在稽核紀錄）
            <input className={input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </label>
          {[
            ['verify', '驗證'],
            ['approve', '核准'],
            ['reject', '拒絕'],
          ].map(([action, label]) => (
            <button
              type="button"
              key={action}
              className={action === 'approve' ? primary : button}
              disabled={busy || !selected.length || !note.trim()}
              onClick={() => void act(action)}
            >
              {label}
              {selected.length ? ` ${selected.length} 筆` : ''}
            </button>
          ))}
        </div>
      ) : null}
      {data ? <Pager key={`${filter.status}:${filter.q}`} nextCursor={data.nextCursor} paging={paging} busy={busy || loading} /> : null}
      {result ? <Evidence value={result} label="本批處理結果（含未通過或延後原因）" /> : null}
    </section>
  );
}
