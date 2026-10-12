'use client';
// Adapted from tag.observe.tw web/src/app/(site)/observe/opt-out/OptOutToggle.tsx, MIT, Copyright (c) 2026 Sky Hong.
import { useEffect, useState } from 'react';
import { type AnalyticsBlock, analyticsBlock, measurementId, OPT_OUT_EVENT, readOptOut, writeOptOut } from '@/lib/analytics-consent.mts';

const STATUS: Record<NonNullable<AnalyticsBlock> | 'counted', { label: string; note: string }> = {
  counted: { label: '計入統計', note: '這個瀏覽器在本站公開頁面的造訪會送到 Google Analytics。' },
  'opt-out': { label: '不計入統計', note: '已在這個瀏覽器關閉，Google Analytics 不會載入。' },
  unreadable: { label: '不計入統計', note: '無法讀取這個瀏覽器的網站資料設定，為保險起見不送統計。' },
  privacy: { label: '不計入統計', note: '瀏覽器已要求不要追蹤（Do Not Track 或 Global Privacy Control），不送統計。' },
  automation: { label: '不計入統計', note: '偵測到自動化測試瀏覽器或爬蟲，預設不送統計。' },
  environment: { label: '不計入統計', note: '這不是正式網站（blog.observe.tw）或統計未啟用，本來就不送統計。' },
};

function current() {
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {}
  const optedOut = readOptOut(storage);
  const block = analyticsBlock({
    production: process.env.NODE_ENV === 'production',
    hostname: location.hostname,
    measurementId: measurementId(process.env.NEXT_PUBLIC_GA_ID),
    webdriver: navigator.webdriver,
    doNotTrack: navigator.doNotTrack,
    globalPrivacyControl: (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl,
    userAgent: navigator.userAgent,
    optedOut,
  });
  return { optedOut: optedOut === true, block, storage };
}

export default function OptOutToggle() {
  const [state, setState] = useState<ReturnType<typeof current> | null>(null);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    setState(current());
    const refresh = () => setState(current());
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);
  if (!state)
    return (
      <p role="status" className="rounded-xl border border-zinc-300 p-4 text-sm dark:border-zinc-800">
        檢查這個瀏覽器的設定中…
      </p>
    );
  const status = STATUS[state.block ?? 'counted'];
  const set = (optedOut: boolean) => {
    try {
      if (!state.storage) throw Error('no storage');
      writeOptOut(state.storage, optedOut);
      window.dispatchEvent(new Event(OPT_OUT_EVENT));
      setError(false);
      setChanged(true);
      setState(current());
    } catch {
      setError(true);
    }
  };
  return (
    <section className="rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900" aria-live="polite">
      <p className="text-xs text-zinc-600 dark:text-zinc-400">這個瀏覽器目前</p>
      <p className="mt-1 flex items-center gap-2 text-xl font-semibold" data-analytics-status={state.block ?? 'counted'}>
        <span className={`h-2.5 w-2.5 rounded-full ${state.block ? 'bg-zinc-400' : 'bg-emerald-500'}`} aria-hidden="true" />
        {status.label}
      </p>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{status.note}</p>
      <div className="mt-4">
        {state.optedOut ? (
          <button
            type="button"
            onClick={() => set(false)}
            className="rounded-full bg-zinc-100 px-4 py-2 text-sm font-medium hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
          >
            恢復計入統計
          </button>
        ) : (
          <button
            type="button"
            onClick={() => set(true)}
            className="rounded-full bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800"
          >
            這個瀏覽器不計入統計
          </button>
        )}
      </div>
      {changed && !state.optedOut && !state.block && (
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">已恢復設定，下一次載入頁面起開始計入。</p>
      )}
      {changed && state.optedOut && <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">已關閉，從現在起不再送出統計。</p>}
      {error && (
        <p className="mt-3 text-sm text-red-700 dark:text-red-400">
          這個瀏覽器不允許儲存網站資料（例如封鎖了 Cookie 與網站資料），無法記住設定；在無法讀取設定時本站也不送統計。
        </p>
      )}
    </section>
  );
}
