'use client';
// Adapted from tag.observe.tw 1d711372 (web/src/app/(site)/admin/accounts/Accounts.tsx), MIT, Copyright (c) 2026 Sky Hong.
import { Fragment, useEffect, useState } from 'react';
import Avatar from '@/components/Avatar';
import SortIndicator from '@/components/SortIndicator';
import TableScroller from '@/components/TableScroller';
import { adminGet } from '@/lib/admin-client';
import { table } from '@/lib/table-styles';
import { button } from './shared';

// GET /api/admin/accounts (app/src/admin/accounts.ts).
type Group = 'use' | 'contribute' | 'admin';
type Account = {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
  admin: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
  counts: Record<string, number>;
  lastActiveAt: string | null;
};
type Data = { metrics: Array<{ key: string; label: string; group: Group }>; accounts: Account[] };
type Row = Account & { use: number; contribute: number; edits: number };
type SortKey = 'name' | 'role' | 'use' | 'contribute' | 'edits' | 'lastActiveAt' | 'lastLoginAt' | `m:${string}`;

// Short Taipei time for the columns (10/17 21:08); the year only when it is not this one.
const when = (iso: string | null, full = false) => {
  if (!iso) return '—';
  const date = new Date(iso);
  const year = (d: Date) => d.toLocaleString('en', { timeZone: 'Asia/Taipei', year: 'numeric' });
  return date.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    ...(full || year(date) !== year(new Date()) ? { year: 'numeric' } : {}),
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
};
const head = 'text-left text-xs text-zinc-600 dark:text-zinc-400';
const groupHead = `${table.cell} !py-1 border-b border-zinc-200 text-center font-medium dark:border-zinc-800`;

// 互動 is a reader's own use, 貢獻 what they gave the site; admin edits are one column, itemised on hover/tap.
export default function Accounts() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<SortKey>('lastActiveAt');
  const [descending, setDescending] = useState(true);
  const load = () => {
    setError('');
    adminGet<Data>('/api/admin/accounts')
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : '帳號無法載入。'));
  };
  useEffect(load, []);
  if (error)
    return (
      <div className="space-y-3">
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
        <button type="button" className={button} onClick={load}>
          重新載入
        </button>
      </div>
    );
  if (!data) return <p role="status">載入帳號中…</p>;

  const { metrics, accounts } = data;
  const of = (group: Group) => metrics.filter((m) => m.group === group);
  const sum = (counts: Record<string, number>, group: Group) => of(group).reduce((n, m) => n + (counts[m.key] ?? 0), 0);
  const rows: Row[] = accounts.map((a) => ({
    ...a,
    use: sum(a.counts, 'use'),
    // Admin edits are contributions too.
    contribute: sum(a.counts, 'contribute') + sum(a.counts, 'admin'),
    edits: sum(a.counts, 'admin'),
  }));
  const value = (r: Row): number | string => {
    if (sort === 'name') return (r.name ?? r.email).toLowerCase();
    if (sort === 'role') return r.admin ? 1 : 0;
    if (sort === 'lastActiveAt' || sort === 'lastLoginAt') return r[sort] ? Date.parse(r[sort] as string) : 0;
    if (sort.startsWith('m:')) return r.counts[sort.slice(2)] ?? 0;
    return r[sort as 'use' | 'contribute' | 'edits'];
  };
  const sorted = [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const order = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
    return (descending ? -order : order) || Date.parse(b.lastLoginAt ?? '') - Date.parse(a.lastLoginAt ?? '') || 0;
  });
  const sortBy = (key: SortKey) => {
    if (sort === key) setDescending((d) => !d);
    else {
      setSort(key);
      setDescending(key !== 'name');
    }
  };
  const th = (key: SortKey, label: string, className: string, title?: string, rowSpan?: number) => (
    <th
      key={key}
      scope="col"
      rowSpan={rowSpan}
      aria-sort={sort === key ? (descending ? 'descending' : 'ascending') : 'none'}
      className={`${className} !py-1.5 align-bottom font-medium`}
      title={title}
    >
      <button
        type="button"
        onClick={() => sortBy(key)}
        className={`inline-flex items-center gap-0.5 whitespace-nowrap hover:text-brand-700 dark:hover:text-brand-400 ${sort === key ? 'text-zinc-900 dark:text-zinc-100' : ''}`}
      >
        {label}
        <SortIndicator active={sort === key} descending={descending} />
      </button>
    </th>
  );
  const count = (n: number, strong = false, title?: string) => (
    <td className={`${table.num} !py-1.5 ${n ? (strong ? 'font-medium' : '') : 'text-zinc-400 dark:text-zinc-600'}`} title={title}>
      {n ? n.toLocaleString('zh-TW') : '—'}
    </td>
  );
  const editsTitle = (r: Row) =>
    of('admin')
      .filter((m) => r.counts[m.key])
      .map((m) => `${m.label} ${r.counts[m.key]}`)
      .join('、') || undefined;
  const active7 = rows.filter((r) => r.lastActiveAt && Date.now() - Date.parse(r.lastActiveAt) < 7 * 86400e3).length;

  return (
    <section className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        共 {accounts.length} 個帳號，管理員 {accounts.filter((a) => a.admin).length} 個，近 7 天有活動 {active7} 個。
      </p>
      <TableScroller card label="帳號與活動，可左右捲動">
        <table className="w-full text-sm">
          <thead className={head}>
            <tr className="bg-(--table-head-bg)">
              {th('name', '帳號', table.leadHead, undefined, 2)}
              {th('role', '身分', table.cell, undefined, 2)}
              <th colSpan={2} className={groupHead}>
                合計
              </th>
              <th colSpan={of('use').length} className={groupHead} title="讀者自己的使用">
                互動
              </th>
              <th colSpan={of('contribute').length + 1} className={groupHead} title="投票與管理修改">
                貢獻
              </th>
              <th colSpan={2} className={groupHead}>
                時間
              </th>
            </tr>
            <tr className="bg-(--table-head-bg)">
              {th('use', '互動', table.num, '追蹤與 API 金鑰的數量')}
              {th('contribute', '貢獻', table.num, '類型投票與管理修改的次數')}
              {of('use').map((m) => th(`m:${m.key}`, m.label, table.num, m.key === 'apiKeys' ? '建立過的金鑰，含已撤銷的' : undefined))}
              {of('contribute').map((m) => th(`m:${m.key}`, m.label, table.num))}
              {th(
                'edits',
                '管理修改',
                table.num,
                of('admin')
                  .map((m) => m.label)
                  .join('、'),
              )}
              {th('lastActiveAt', '最近活動', table.cell)}
              {th('lastLoginAt', '最近登入', table.cell)}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sorted.map((r) => (
              <tr key={r.id} className={`${table.row} whitespace-nowrap`}>
                <th
                  scope="row"
                  className={`${table.lead} !py-1.5 text-left font-normal`}
                  title={`${r.email}${r.createdAt ? ` · ${when(r.createdAt, true)} 加入` : ''}`}
                >
                  <span className={`${table.leadBox} flex items-center gap-2`}>
                    <Avatar src={r.picture} label={r.name ?? r.email} size={24} />
                    <span className={`${table.leadText} font-medium`}>{r.name ?? r.email}</span>
                  </span>
                </th>
                <td
                  className={`${table.cell} !py-1.5 text-xs text-zinc-600 dark:text-zinc-400`}
                  title={r.admin ? '寫在伺服器的 BLOG_ADMIN_EMAILS' : undefined}
                >
                  {r.admin ? '管理員' : '讀者'}
                </td>
                {count(r.use, true)}
                {count(r.contribute, true)}
                {of('use').map((m) => (
                  <Fragment key={m.key}>{count(r.counts[m.key] ?? 0)}</Fragment>
                ))}
                {of('contribute').map((m) => (
                  <Fragment key={m.key}>{count(r.counts[m.key] ?? 0)}</Fragment>
                ))}
                {count(r.edits, false, editsTitle(r))}
                <td className={`${table.cell} !py-1.5 tabular-nums`}>{when(r.lastActiveAt)}</td>
                <td className={`${table.cell} !py-1.5 tabular-nums text-zinc-600 dark:text-zinc-400`}>{when(r.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        互動是讀者自己的使用：追蹤的部落格、建立的 API
        金鑰。貢獻是類型投票與管理修改；管理修改依稽核紀錄計算，游標移到（手機點一下）數字上可看細項。最近活動是以上任一項的最後時間；游標移到名字上可看
        Email 和加入時間。管理員只能由伺服器設定 BLOG_ADMIN_EMAILS 加入，對方用 Google 登入一次後生效，這裡不能新增或取消。
      </p>
    </section>
  );
}
