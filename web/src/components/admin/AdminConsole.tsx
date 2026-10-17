'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminApiError, AdminWriter, adminGet } from '@/lib/admin-client';
import Accounts from './Accounts';
import AdminTabs, { ADMIN_SECTIONS, type AdminSection } from './AdminTabs';
import Audits from './Audits';
import Blogs from './Blogs';
import Candidates from './Candidates';
import Overrides from './Overrides';
import { button, Evidence, primary, type RunAction } from './shared';

const labels: Record<string, string> = {
  approved: '已核准',
  rejected: '已拒絕',
  candidate: '保留候選',
  deferred: '延後處理',
  pending: '已排入或等待處理',
  busy: '已有工作執行中',
  scheduled_or_cooldown: '依排程等待或冷卻中',
  daily_limit_or_already_submitted: '已達每日上限或先前已提交',
  blocked: '來源目前限制存取',
  auth: '來源認證尚未就緒',
  'no-data': '來源沒有資料',
  ok: '完成',
  not_found: '找不到此筆資料',
};
function summary(value: unknown) {
  if (!value || typeof value !== 'object') return '操作已回傳。';
  const v = value as { results?: Array<{ status?: string }>; status?: string; ok?: boolean };
  if (Array.isArray(v.results)) {
    const counts = new Map<string, number>();
    for (const r of v.results) {
      const s = labels[r.status ?? ''] ?? r.status ?? '已檢查';
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return [...counts].map(([s, n]) => `${s} ${n} 筆`).join('；') || '此次沒有變更。';
  }
  return v.status ? (labels[v.status] ?? v.status) : v.ok ? '已儲存，並留下稽核紀錄。' : '操作已回傳，請查看處理結果。';
}
/** One /admin/ page: the shared tabs, then `section` once the admin session is confirmed. */
export default function AdminConsole({ section }: { section: AdminSection }) {
  const { href, label, intro } = ADMIN_SECTIONS[section];
  const [csrf, setCsrf] = useState('');
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [loginNeeded, setLoginNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const writer = useRef(new AdminWriter());
  const active = useRef(false);
  const initialize = useCallback(async () => {
    setLoading(true);
    setCsrf('');
    setAuthError('');
    setLoginNeeded(false);
    try {
      const session = await adminGet<{ csrfToken: string }>('/api/admin/session');
      if (typeof session.csrfToken !== 'string' || !session.csrfToken) throw Error('管理工作階段無法建立。');
      setCsrf(session.csrfToken);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : '管理入口暫時無法讀取。');
      setLoginNeeded(e instanceof AdminApiError && e.status === 401);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  const run: RunAction = async (path, body) => {
    if (active.current) throw new AdminApiError(409, 'intent_pending');
    active.current = true;
    setBusy(true);
    setFailed(false);
    setResult(null);
    setMessage('正在處理，來源驗證可能需要兩分鐘，請保持頁面開啟。');
    try {
      const out = await writer.current.post(path, body, csrf);
      setResult(out);
      setMessage(summary(out));
      return out;
    } catch (e) {
      const text = e instanceof AdminApiError ? e.message : '連線中斷，結果尚未確認。請先查看稽核紀錄；以相同內容重試會沿用原操作編號。';
      setMessage(text);
      setFailed(true);
      if (e instanceof AdminApiError && [401, 403].includes(e.status)) {
        setCsrf('');
        setAuthError(text);
        setLoginNeeded(e.status === 401);
      }
      throw e;
    } finally {
      active.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5 pb-8">
      <AdminTabs current={section} />
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{intro}所有異動都留有稽核紀錄。</p>
      </header>
      {loading ? (
        <p role="status">確認管理員工作階段中…</p>
      ) : authError ? (
        <section className="space-y-3">
          <p role="alert">{authError}</p>
          <div className="flex flex-wrap gap-3">
            {loginNeeded ? (
              <a className={primary} href={`/auth/google?next=${encodeURIComponent(href)}`}>
                登入管理員帳號
              </a>
            ) : null}
            <button type="button" className={button} onClick={() => void initialize()}>
              重新確認權限
            </button>
            <a className={button} href="/">
              回到首頁
            </a>
          </div>
        </section>
      ) : csrf ? (
        <>
          {message ? (
            <div
              className={`space-y-1 text-sm ${failed ? 'text-red-700 dark:text-red-400' : 'text-zinc-700 dark:text-zinc-300'}`}
              role={failed ? 'alert' : 'status'}
              aria-live="polite"
            >
              <p>{message}</p>
              {result ? <Evidence value={result} label="查看操作結果與逐筆原因" /> : null}
            </div>
          ) : null}
          <fieldset disabled={busy} className="min-w-0 space-y-5">
            <legend className="sr-only">{label}</legend>
            {section === 'discovery' ? (
              <Candidates run={run} busy={busy} />
            ) : section === 'blogs' ? (
              <Blogs />
            ) : section === 'accounts' ? (
              <Accounts />
            ) : section === 'overrides' ? (
              <Overrides run={run} busy={busy} />
            ) : (
              <Audits />
            )}
          </fieldset>
        </>
      ) : null}
    </div>
  );
}
