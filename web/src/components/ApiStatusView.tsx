'use client';

import { useCallback, useEffect, useState } from 'react';
import { table } from '@/lib/table-styles';

// The gateway's public status metadata (GET /api/status, Accept: application/json).
// Only a validated `status: 'ok'` reads as healthy; anything else is shown as a failure.
export interface ApiStatus {
  status: string;
  version: string;
  endpoints: Array<{ path: string; summary: string }>;
  updatedAt: string;
}

type State = { kind: 'loading' } | { kind: 'ready'; data: ApiStatus } | { kind: 'error'; reason: string };

export function parseStatus(value: unknown): ApiStatus | null {
  const v = value as Partial<ApiStatus> | null;
  if (!v || typeof v !== 'object' || typeof v.status !== 'string' || typeof v.version !== 'string' || !Array.isArray(v.endpoints))
    return null;
  const endpoints = v.endpoints.filter((e) => e && typeof e.path === 'string' && typeof e.summary === 'string');
  return { status: v.status, version: v.version, endpoints, updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : '' };
}

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
};

const card = 'rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900';
const button =
  'inline-flex min-h-9 items-center rounded-full border border-zinc-300 px-3 text-sm hover:border-brand-400 disabled:opacity-60 dark:border-zinc-700';

export default function ApiStatusView() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ kind: 'loading' });
    try {
      const response = await fetch('/api/status', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
      });
      if (!response.ok) return setState({ kind: 'error', reason: `狀態端點回應 HTTP ${response.status}` });
      const data = parseStatus(await response.json().catch(() => null));
      setState(data ? { kind: 'ready', data } : { kind: 'error', reason: '狀態端點回傳的格式無法辨識' });
    } catch {
      if (signal?.aborted) return;
      setState({ kind: 'error', reason: '連線失敗或逾時' });
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const refresh = (
    <button type="button" className={button} onClick={() => load()} disabled={state.kind === 'loading'}>
      重新整理狀態
    </button>
  );

  if (state.kind === 'loading')
    return (
      <p role="status" className={`${card} text-zinc-500`}>
        正在檢查 API 狀態…
      </p>
    );
  if (state.kind === 'error')
    return (
      <div role="alert" className={`${card} space-y-3 border-red-300 dark:border-red-900`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/50 dark:text-red-300">
            無法確認
          </span>
          <p className="font-medium">暫時無法取得 API 狀態</p>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{state.reason}。這不代表 API 正常，請稍後重新整理。</p>
        {refresh}
      </div>
    );

  const { data } = state;
  const healthy = data.status === 'ok';
  const updated = time(data.updatedAt);
  return (
    <>
      <section aria-labelledby="availability" className="space-y-3">
        <h2 id="availability" className="text-lg font-semibold">
          服務狀態
        </h2>
        <div className={`${card} space-y-2 ${healthy ? '' : 'border-amber-300 dark:border-amber-900'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">公開 API {data.version}</h3>
            <span
              className={
                healthy
                  ? 'rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-800 dark:bg-brand-900/50 dark:text-brand-300'
                  : 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
              }
            >
              {healthy ? '正常' : '異常'}
            </span>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {healthy ? 'API 目前可以使用。' : `API 回報異常狀態（${data.status}），部分功能可能無法使用。`}
            {updated && <> 狀態時間：{updated}（台北時間）。</>}
          </p>
          {refresh}
        </div>
      </section>

      {data.endpoints.length > 0 && (
        <section aria-labelledby="endpoints" className="space-y-3">
          <h2 id="endpoints" className="text-lg font-semibold">
            端點用途
          </h2>
          {/* A two-column text table: phones stack each row (table-stack) so the
              full path stays readable, instead of truncating it in a sideways scroller. */}
          <div className="overflow-hidden rounded-xl border border-zinc-300 bg-white px-4 sm:px-0 dark:border-zinc-800 dark:bg-zinc-900">
            {/* -mt-px tucks the first stacked row's top rule under the card's own border. */}
            <table className={`w-full text-left text-sm max-sm:-mt-px ${table.stack}`}>
              <thead className="bg-zinc-50 text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                <tr>
                  <th scope="col" className={table.cell}>
                    端點
                  </th>
                  <th scope="col" className={table.cell}>
                    用途
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {data.endpoints.map((endpoint) => (
                  <tr key={endpoint.path}>
                    <td className={`${table.cell} font-mono text-[13px] break-all sm:whitespace-nowrap`} data-label="端點">
                      {endpoint.path}
                    </td>
                    <td className={table.cell} data-label="用途">
                      {endpoint.summary}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
