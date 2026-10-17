'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from '@/components/NoPrefetchLink';
import TableScroller from '@/components/TableScroller';
import { adminGet } from '@/lib/admin-client';
import { taipei } from '@/lib/api';
import { table } from '@/lib/table-styles';
import { button, Pager, useAdminPaging } from './shared';

// GET /api/admin/audits: newest first, without the `.intent` bookkeeping rows.
type Audit = {
  id: number;
  actorUserId: number | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  entitySlug: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  note: string | null;
  createdAt: string;
};
type Data = { items: Audit[]; nextCursor: number | null };

const ACTIONS: Record<string, string> = {
  'candidate.approve': '核准候選',
  'candidate.reject': '拒絕候選',
  'candidate.verify': '驗證候選',
  'ai.override': '人工覆寫簡介／主題',
  'tags.manual': '部落格標籤',
  'genre.set': '設定類型',
  'genre.hide': '隱藏類型',
  'genre.release': '取消類型覆寫',
  'relations.visibility': '連結關係顯示',
  'similarweb.submit.reserved': '排入 Similarweb',
  'similarweb.submit.outcome': 'Similarweb 結果',
  'role.bootstrap': '管理員首次登入',
  'role.cli': '管理員權限',
  'blog.rename': '部落格改名',
  'blog.remove': '移除部落格',
};

const parse = (value: unknown): Record<string, unknown> => {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {}
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : v == null ? {} : { 值: v };
};
const shown = (v: unknown) => (v === undefined ? '（無）' : typeof v === 'string' ? v : JSON.stringify(v));

/** Each changed field as 「欄位：改前 → 改後」, so nobody has to read JSON. */
function Change({ before, after }: { before: unknown; after: unknown }) {
  const b = parse(before);
  const a = parse(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  if (!keys.length) return <p className="text-xs text-zinc-500">沒有記錄修改前後的內容。</p>;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {keys.map((key) => (
        <Fragment key={key}>
          <dt className="text-zinc-500">{key}</dt>
          <dd className="break-all">
            <span className="text-zinc-500 line-through decoration-zinc-400">{shown(b[key])}</span>
            <span className="mx-1.5 text-zinc-400">→</span>
            <span>{shown(a[key])}</span>
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

export default function Audits() {
  const paging = useAdminPaging();
  const cursor = paging.cursor;
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await adminGet<Data>(`/api/admin/audits?cursor=${cursor}`));
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : '稽核紀錄無法載入。');
    } finally {
      setLoading(false);
    }
  }, [cursor]);
  useEffect(() => {
    void load();
  }, [load]);
  const target = (a: Audit) =>
    a.entityType === 'blog' && a.entitySlug ? (
      <Link
        href={`/admin/overrides/?blog=${encodeURIComponent(a.entitySlug)}`}
        className="text-brand-700 hover:underline dark:text-brand-400"
      >
        {a.entityName ?? a.entitySlug}
      </Link>
    ) : (
      <span className="text-zinc-600 dark:text-zinc-400">
        {a.entityType === 'candidate' ? '候選' : a.entityType === 'blog' ? '部落格' : a.entityType} #{a.entityId.slice(0, 16)}
      </span>
    );
  return (
    <section className="space-y-3">
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {loading && !data ? <p role="status">載入稽核紀錄中…</p> : null}
      {data ? (
        <>
          <TableScroller card label="稽核紀錄表格，可左右捲動">
            <table aria-busy={loading} className={`w-full min-w-[52rem] text-sm ${loading ? 'opacity-60' : ''}`}>
              <thead className="bg-(--table-head-bg) text-left text-xs text-zinc-600 dark:text-zinc-400">
                <tr>
                  <th scope="col" className={table.cell}>
                    時間
                  </th>
                  <th scope="col" className={table.cell}>
                    操作人
                  </th>
                  <th scope="col" className={table.cell}>
                    動作
                  </th>
                  <th scope="col" className={table.cell}>
                    對象
                  </th>
                  <th scope="col" className={table.cell}>
                    原因
                  </th>
                  <th scope="col" className={table.cell}>
                    <span className="sr-only">異動內容</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {data.items.map((a) => (
                  <Fragment key={a.id}>
                    <tr className={table.row}>
                      <td className={`${table.cell} whitespace-nowrap text-xs tabular-nums text-zinc-500`} title={`#${a.id}`}>
                        {taipei(a.createdAt)}
                      </td>
                      <td className={`${table.cell} whitespace-nowrap`} title={a.actorEmail ?? undefined}>
                        {a.actorName ?? a.actorEmail ?? <span className="text-zinc-500">系統／指令</span>}
                      </td>
                      <td className={`${table.cell} whitespace-nowrap`} title={a.action}>
                        {ACTIONS[a.action] ?? a.action}
                      </td>
                      <td className={`${table.cell} max-w-56 truncate`}>{target(a)}</td>
                      <td className={`${table.cell} min-w-48 text-zinc-700 dark:text-zinc-300`}>
                        {a.note || <span className="text-zinc-400 dark:text-zinc-600">—</span>}
                      </td>
                      <td className={`${table.cell} whitespace-nowrap text-right`}>
                        <button
                          type="button"
                          aria-expanded={open === a.id}
                          className="text-xs text-zinc-600 hover:text-brand-700 hover:underline dark:text-zinc-400"
                          onClick={() => setOpen(open === a.id ? null : a.id)}
                        >
                          {open === a.id ? '收起' : '異動內容'}
                        </button>
                      </td>
                    </tr>
                    {open === a.id ? (
                      <tr>
                        <td colSpan={6} className="px-3 pb-3">
                          <Change before={a.beforeJson} after={a.afterJson} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
                {!data.items.length ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-zinc-500">
                      還沒有稽核紀錄。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </TableScroller>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Pager nextCursor={data.nextCursor} paging={paging} busy={loading} />
            <button type="button" className={button} disabled={loading} onClick={() => void load()}>
              重新載入
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
