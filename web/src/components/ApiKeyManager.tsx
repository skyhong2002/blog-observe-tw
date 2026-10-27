'use client';

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { plainSpaces } from '@/lib/api';
import { ApiKeyError, type ApiKeyMeta, createFence, createKey, listKeys, revokeKey } from '@/lib/api-keys';

// /my's API key section. Everything is loaded in the browser with no-store, so
// no key data is ever rendered on the server or cached. A new key's plaintext
// is shown once, kept only in state, and dropped when dismissed, on 401 and
// when the page is left (pagehide also covers the back/forward cache).

type Fresh = { key: string; label: string };

const card = 'rounded-xl border border-zinc-300 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900';
const primary =
  'inline-flex min-h-10 shrink-0 items-center rounded-lg bg-brand-700 px-4 text-sm text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60';
const secondary =
  'inline-flex min-h-9 shrink-0 items-center rounded-lg border border-zinc-300 px-3 text-sm hover:border-brand-600 hover:text-brand-700 disabled:opacity-60 dark:border-zinc-700 dark:hover:border-brand-400 dark:hover:text-brand-400';
const danger =
  'inline-flex min-h-9 shrink-0 items-center rounded-lg bg-red-700 px-3 text-sm text-white hover:bg-red-800 disabled:opacity-60';

const time = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : plainSpaces(
        d.toLocaleString('zh-TW', {
          timeZone: 'Asia/Taipei',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
      );
};

export default function ApiKeyManager({ example }: { example: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'login' | 'error'>('loading');
  const [keys, setKeys] = useState<ApiKeyMeta[]>([]);
  const [max, setMax] = useState(3);
  const csrf = useRef('');
  const [fresh, setFresh] = useState<Fresh | null>(null);
  const [copied, setCopied] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const keyField = useRef<HTMLInputElement>(null);
  const fence = useRef(createFence());

  const signedOut = useCallback(() => {
    csrf.current = '';
    setKeys([]);
    setFresh(null);
    setConfirming(null);
    setState('login');
  }, []);
  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof ApiKeyError && error.status === 401) return signedOut();
      setMessage(error instanceof ApiKeyError ? error.message : '連線失敗，請稍後再試。');
    },
    [signedOut],
  );

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await fence.current.settle(listKeys(signal));
        if (!result.live) return;
        const data = result.value;
        csrf.current = data.csrfToken;
        setKeys(data.keys);
        setMax(data.max);
        setState('ready');
      } catch (error) {
        if (signal?.aborted) return;
        if (error instanceof ApiKeyError && error.status === 401) return signedOut();
        setState((s) => (s === 'ready' ? s : 'error'));
        fail(error);
      }
    },
    [fail, signedOut],
  );

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  // Leaving the page drops the plaintext before the browser can snapshot it and
  // fences off requests still in flight (a pending create's key is discarded).
  // Coming back from the back/forward cache reloads metadata only: a key created
  // meanwhile is listed (and revocable) but its plaintext is never shown.
  useEffect(() => {
    const current = fence.current;
    const clear = () => {
      current.end();
      if (keyField.current) keyField.current.value = '';
      flushSync(() => {
        setFresh(null);
        setBusy(null);
        setConfirming(null);
      });
    };
    const back = (event: PageTransitionEvent) => {
      if (event.persisted) refresh();
    };
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', back);
    return () => {
      current.end();
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', back);
    };
  }, [refresh]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const name = label.trim();
    if (!name || busy) return;
    setBusy('create');
    setMessage(null);
    setFresh(null);
    try {
      const result = await fence.current.settle(createKey(name, csrf.current));
      if (!result.live) return;
      const data = result.value;
      setKeys(data.keys);
      setMax(data.max);
      setFresh({ key: data.key, label: name });
      setCopied(false);
      setLabel('');
      setBusy(null);
    } catch (error) {
      fail(error);
      setBusy(null);
    }
  };

  const revoke = async (id: string) => {
    if (busy) return;
    setBusy(id);
    setMessage(null);
    try {
      if (!(await fence.current.settle(revokeKey(id, csrf.current))).live) return;
      setConfirming(null);
      if (!(await fence.current.settle(refresh())).live) return;
      setBusy(null);
    } catch (error) {
      fail(error);
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.key);
      setCopied(true);
    } catch {
      keyField.current?.select();
      setMessage('無法自動複製，已選取金鑰，請手動複製。');
    }
  };

  const intro = (
    <div className="space-y-1.5 text-sm leading-7 text-zinc-600 dark:text-zinc-400">
      <p>API 金鑰用於讀取公開資料，每把金鑰每分鐘可呼叫 1000 次，每個帳號最多 {max} 把。金鑰不會授權存取你的追蹤清單或其他私人資料。</p>
      <p>伺服器只保存金鑰的 SHA-256 雜湊，完整金鑰只在建立當下顯示一次，請自行妥善保存；遺失時撤銷後重新建立即可。</p>
    </div>
  );

  return (
    <section
      id="api-keys"
      aria-labelledby="api-keys-title"
      className="scroll-mt-24 space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="api-keys-title" className="text-lg font-semibold">
          API 金鑰
        </h2>
        <a href="/api/" className="text-sm text-brand-700 hover:underline dark:text-brand-400">
          API 文件 →
        </a>
      </header>
      {intro}

      {state === 'loading' && (
        <p role="status" className="py-4 text-sm text-zinc-500">
          正在載入 API 金鑰…
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="py-4 text-sm text-zinc-500">
          {message ?? '暫時無法取得 API 金鑰，請稍後重新整理。'}
        </p>
      )}
      {state === 'login' && (
        <div className={card}>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">登入後即可建立與管理 API 金鑰。</p>
          <a href="/login/?next=/my" className={`${primary} mt-3`}>
            登入
          </a>
        </div>
      )}

      {state === 'ready' && (
        <>
          {message && (
            <p
              role="alert"
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            >
              {message}
            </p>
          )}

          {fresh && (
            <div className={`${card} space-y-3 border-brand-300 dark:border-brand-800`}>
              <p className="text-sm font-medium">
                已建立「<span className="break-all">{fresh.label}</span>」。這是唯一一次顯示完整金鑰，請立即複製保存。
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  ref={keyField}
                  readOnly
                  value={fresh.key}
                  aria-label="新的 API 金鑰"
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-h-10 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-3 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
                <div className="flex gap-2">
                  <button type="button" className={primary} onClick={copy}>
                    {copied ? '已複製' : '複製'}
                  </button>
                  <button type="button" className={secondary} onClick={() => setFresh(null)}>
                    我已保存，關閉
                  </button>
                </div>
              </div>
            </div>
          )}

          {keys.length > 0 ? (
            <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-300 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
              {keys.map((k) => {
                const used = time(k.lastUsedAt);
                return (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-baseline gap-2">
                        <span className="min-w-0 truncate font-medium" title={k.label}>
                          {k.label || '未命名金鑰'}
                        </span>
                        <code className="shrink-0 font-mono text-xs text-zinc-500">{k.prefix}…</code>
                      </p>
                      <p className="truncate text-xs text-zinc-500">
                        建立於 {time(k.createdAt) ?? '—'} · {used ? `最後使用 ${used}` : '尚未使用'}
                      </p>
                    </div>
                    {confirming === k.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-600 dark:text-zinc-400">撤銷後立即失效</span>
                        <button type="button" className={danger} disabled={busy !== null} onClick={() => revoke(k.id)}>
                          {busy === k.id ? '撤銷中…' : '確認撤銷'}
                        </button>
                        <button type="button" className={secondary} disabled={busy === k.id} onClick={() => setConfirming(null)}>
                          取消
                        </button>
                      </div>
                    ) : (
                      <button type="button" className={secondary} disabled={busy !== null} onClick={() => setConfirming(k.id)}>
                        撤銷
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">還沒有 API 金鑰。</p>
          )}

          {keys.length < max ? (
            <form onSubmit={create} className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                <span className="text-zinc-600 dark:text-zinc-400">金鑰名稱（例如用途或專案）</span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  maxLength={60}
                  required
                  autoComplete="off"
                  className="min-h-10 rounded-lg border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
              <button type="submit" className={primary} disabled={busy !== null || !label.trim()}>
                {busy === 'create' ? '建立中…' : '建立金鑰'}
              </button>
            </form>
          ) : (
            <p className="text-sm text-zinc-500">已達 {max} 把上限，撤銷一把後才能再建立。</p>
          )}

          <div className="space-y-1">
            <p className="text-sm font-medium">使用方式</p>
            <pre className="overflow-x-auto rounded-md bg-zinc-900 p-3 text-[13px] leading-relaxed text-zinc-100 dark:bg-zinc-900/80">
              <code>{`curl -s -H 'x-api-key: <你的 API 金鑰>' 'https://weblog.tw${example}'`}</code>
            </pre>
          </div>
        </>
      )}
    </section>
  );
}
