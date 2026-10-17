'use client';
import { useCallback, useEffect, useState } from 'react';
import { adminGet } from '@/lib/admin-client';
import { type RobotsStatus, robotsLabel, robotsTone } from '@/lib/robots';
import { button, Evidence, External, input, Pager, panel, primary, type RunAction, useAdminPaging } from './shared';

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
function RobotsLine({ robots }: { robots?: RobotsStatus | null }) {
  const { label, tone, title } = robotsLabel(robots);
  return (
    <p className="text-xs text-zinc-500">
      robots.txt：<span className={robotsTone[tone]}>{label}</span>
      <span className="ml-1 break-words">{title}</span>
    </p>
  );
}
type Payload = { candidates: Candidate[]; nextCursor: number | null };
export default function Candidates({ run, busy }: { run: RunAction; busy: boolean }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('candidate');
  const [filter, setFilter] = useState({ q: '', status: 'candidate' });
  const paging = useAdminPaging();
  const cursor = paging.cursor;
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
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
  return (
    <section className={panel}>
      <h2 className="text-lg font-semibold">候選來源</h2>
      <p className="text-sm text-zinc-500">
        每批最多 25 筆。「驗證」更新證據；「核准」仍須通過來源身分、RSS 與爬取安全規則。拒絕候選不會移除已收錄的部落格。
      </p>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          paging.reset();
          setFilter({ q: query.trim(), status });
        }}
      >
        <label className="text-sm">
          名稱或網址
          <input className={input} maxLength={150} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label className="text-sm">
          狀態
          <select className={input} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="candidate">待判定</option>
            <option value="approved">已核准</option>
            <option value="rejected">已拒絕</option>
          </select>
        </label>
        <button type="submit" className={`${button} self-end`} disabled={loading || busy}>
          搜尋
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p role="status">載入候選中…</p>
      ) : data ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={data.candidates.length > 0 && selected.length === data.candidates.length}
                disabled={busy || !data.candidates.length}
                onChange={(e) => setSelected(e.target.checked ? data.candidates.map((c) => c.id) : [])}
              />
              選取本頁（{selected.length}／25）
            </label>
            <button type="button" className={button} disabled={busy} onClick={() => void load()}>
              重新載入
            </button>
          </div>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {data.candidates.map((c) => (
              <li key={c.id} className="space-y-2 py-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5 shrink-0"
                    checked={selected.includes(c.id)}
                    disabled={busy}
                    onChange={(e) => setSelected((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((id) => id !== c.id)))}
                  />
                  <span className="min-w-0 break-words font-medium">
                    {c.name || c.url}
                    <span className="ml-2 text-xs text-zinc-500">#{c.id}</span>
                  </span>
                </label>
                <div className="space-y-1 pl-8 text-sm">
                  <p>
                    <External url={c.url} />
                  </p>
                  <p className="text-xs text-zinc-500">
                    來源：{c.sourceType} · 發現於 {new Date(c.discoveredAt).toLocaleString('zh-TW')}
                  </p>
                  <RobotsLine robots={c.robots} />
                  <p>
                    發現頁面：
                    <External url={c.sourceUrl} />
                  </p>
                  <Evidence value={c.sourceEvidence} label="發現路徑、blogroll 與 RSS 驗證證據" />
                </div>
              </li>
            ))}
          </ul>
          {!data.candidates.length ? <p className="py-6 text-zinc-500">沒有符合條件的候選。</p> : null}
          <label className="block text-sm">
            本次處理原因
            <textarea
              className={input}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="說明驗證或決定的依據，會保留在稽核紀錄。"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {[
              ['verify', '驗證所選'],
              ['approve', '核准所選'],
              ['reject', '拒絕所選'],
            ].map(([action, label]) => (
              <button
                type="button"
                key={action}
                className={action === 'approve' ? primary : button}
                disabled={busy || !selected.length || !note.trim()}
                onClick={() => void act(action)}
              >
                {label}
              </button>
            ))}
          </div>
          <Pager key={`${filter.status}:${filter.q}`} nextCursor={data.nextCursor} paging={paging} busy={busy || loading} />
        </>
      ) : null}
      {result ? <Evidence value={result} label="本批處理結果（含未通過或延後原因）" /> : null}
    </section>
  );
}
