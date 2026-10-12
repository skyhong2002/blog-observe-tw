'use client';
import { useCallback, useEffect, useState } from 'react';
import { adminGet } from '@/lib/admin-client';
import { button, External, input, Pager, panel, type RunAction, useAdminPaging } from './shared';

type Relation = {
  id: string;
  sourcePostId: number;
  targetUrl: string;
  location: string;
  anchorText: string;
  contextSnippet: string;
  hidden: boolean | number;
  fingerprint: string;
};
type Data = { items: Relation[]; nextCursor: string | null };
export default function Relations({ run, busy }: { run: RunAction; busy: boolean }) {
  const [post, setPost] = useState('');
  const [filter, setFilter] = useState('');
  const paging = useAdminPaging();
  const cursor = paging.cursor;
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ sourcePostId: filter || '0' });
      if (cursor !== '0') query.set('cursor', cursor);
      setData(await adminGet<Data>(`/api/admin/relations?${query}`));
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : '關係紀錄無法載入。');
    } finally {
      setLoading(false);
    }
  }, [filter, cursor]);
  useEffect(() => {
    void load();
  }, [load]);
  const toggle = async (item: Relation) => {
    try {
      await run('/api/admin/relations', {
        fingerprint: item.fingerprint,
        sourcePostId: item.sourcePostId,
        targetUrl: item.targetUrl,
        location: item.location,
        hidden: !item.hidden,
        reason: reason.trim(),
      });
      await load();
    } catch {
      /* shared action message */
    }
  };
  return (
    <section className={panel}>
      <h2 className="text-lg font-semibold">原始連結與顯示覆寫</h2>
      <p className="text-sm text-zinc-500">隱藏會影響公開的引用統計，原始連結證據仍保留。相同文章、目標網址與連結位置共用這個決定。</p>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter(post);
          paging.reset();
        }}
      >
        <label className="text-sm">
          來源文章 ID（留白看全部）
          <input className={input} type="number" min="1" step="1" value={post} onChange={(e) => setPost(e.target.value)} />
        </label>
        <button type="submit" className={button} disabled={busy || loading}>
          查詢
        </button>
      </form>
      <label className="block text-sm">
        本次隱藏／恢復的原因
        <textarea className={input} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status">載入連結中…</p>
      ) : data ? (
        <>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {data.items.map((r) => (
              <li key={r.id} className="space-y-2 py-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p>
                    文章 #{r.sourcePostId} ·{' '}
                    {{ body: '正文', blogroll: '部落卷', sidebar: '側欄', comment: '留言' }[r.location] ?? r.location} ·{' '}
                    {r.hidden ? '已隱藏' : '公開'}
                  </p>
                  <button type="button" className={button} disabled={busy || !reason.trim()} onClick={() => void toggle(r)}>
                    {r.hidden ? '恢復顯示' : '隱藏此關係'}
                  </button>
                </div>
                <p>
                  <External url={r.targetUrl} />
                </p>
                <p>連結文字：{r.anchorText || '無文字'}</p>
                <blockquote className="border-l-2 border-zinc-300 pl-3 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                  {r.contextSnippet || '未保留上下文'}
                </blockquote>
              </li>
            ))}
          </ul>
          {!data.items.length ? <p className="py-5 text-zinc-500">沒有符合條件的連結紀錄。</p> : null}
          <Pager key={filter} nextCursor={data.nextCursor} paging={paging} busy={busy || loading} />
        </>
      ) : null}
    </section>
  );
}
