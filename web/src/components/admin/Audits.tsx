'use client';
import { useCallback, useEffect, useState } from 'react';
import { adminGet } from '@/lib/admin-client';
import { button, Evidence, Pager, panel, useAdminPaging } from './shared';

type Audit = {
  id: number;
  actorUserId: number;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson: unknown;
  afterJson: unknown;
  note: string | null;
  createdAt: string;
};
type Data = { items: Audit[]; nextCursor: number | null };
export default function Audits() {
  const paging = useAdminPaging();
  const cursor = paging.cursor;
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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
  return (
    <section className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">管理操作稽核</h2>
        <button type="button" className={button} disabled={loading} onClick={() => void load()}>
          重新載入
        </button>
      </div>
      <p className="text-sm text-zinc-500">依紀錄編號由舊至新，保留操作人、對象、原因與異動摘要。</p>
      {error ? (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status">載入稽核中…</p>
      ) : data ? (
        <>
          <ol className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {data.items.map((a) => (
              <li key={a.id} className="space-y-2 py-4 text-sm">
                <p className="break-all font-medium">
                  #{a.id} · {a.action}
                </p>
                <p className="text-xs text-zinc-500">
                  {new Date(a.createdAt).toLocaleString('zh-TW')} · 管理員 #{a.actorUserId}
                </p>
                <p className="break-all">
                  {a.entityType}：{a.entityId}
                </p>
                <p className="whitespace-pre-wrap break-words">{a.note || '未填原因'}</p>
                <Evidence value={{ before: a.beforeJson, after: a.afterJson }} label="異動前後摘要" />
              </li>
            ))}
          </ol>
          {!data.items.length ? <p className="py-5 text-zinc-500">此頁沒有稽核紀錄。</p> : null}
          <Pager nextCursor={data.nextCursor} paging={paging} busy={loading} />
        </>
      ) : null}
    </section>
  );
}
