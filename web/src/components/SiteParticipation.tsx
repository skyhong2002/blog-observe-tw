'use client';

import { useCallback, useEffect, useState } from 'react';
import { candidateReasonText } from '@/lib/candidate-reasons';
import { blogHref } from '@/lib/page-links';
import { loginHref, useSession } from '@/lib/session';
import Link from './NoPrefetchLink';

type Challenge = { id: number; home: string; method: string; token: string; marker: string; fileUrl: string | null; expiresAt: string };
const button = 'min-h-9 rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700';
const field = 'w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700';
const errors: Record<string, string> = {
  same_origin_required: '請從本站頁面操作。',
  login_required: '請重新登入。',
  decision_preserved: '這個網站已有人工處理紀錄，請聯絡本站補充資料。',
  owner_excluded: '這個網站已要求排除，請聯絡本站處理。',
  claim_daily_limit: '今天建立的驗證申請已達上限，請明天再試。',
  recommendation_daily_limit: '今天具名推薦的網站已達五個，請明天再試。',
  review_daily_limit: '今天要求重新檢查的次數已達上限，請明天再試。',
  review_cooldown: '這個網站一小時內已要求檢查，請稍後再試。',
  verification_daily_limit: '今天檢查驗證碼的次數已達上限，請明天再試。',
  verification_cooldown: '請至少等一分鐘再檢查驗證碼。',
  verification_fetch_failed: '目前無法讀取網站，請確認已公開發布後再試。',
  verification_marker_not_found: '還沒找到驗證碼。請確認已發布到正式網站；介紹頁請放在開頭的第一個獨立段落。',
  claim_expired: '這次驗證申請已過期或撤回，請重新建立。',
  already_verified: '你已完成這個網站的驗證，可以在「我的網站」查看。',
  site_already_claimed: '這個網站已有驗證管理者，請聯絡本站處理共同管理或移交。',
  platform_verification_unsupported: '這個平台還需要專用驗證方式。你仍可具名推薦收錄；認領請聯絡本站。',
  invalid_home: '請輸入有效的部落格網址。',
};
async function send<T extends object = { review?: { status: string }; error?: string }>(path: string, body: object = {}): Promise<T> {
  let response: Response;
  let data: T & { error?: string };
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    data = await response.json();
  } catch {
    throw new Error('連線失敗或回應無法讀取，請稍後再試。');
  }
  if (!response.ok) {
    if (response.status === 401) window.location.href = loginHref(location.pathname + location.search);
    throw new Error(errors[data.error || ''] || '操作沒有完成，請稍後再試。');
  }
  return data;
}
function reviewMessage(review?: { status: string }) {
  if (review?.status === 'listed') return '網站已收錄。';
  if (review?.status === 'cooldown') return '已保存資料；近期已有檢查紀錄，可於一小時後重新要求檢查。';
  if (review?.status === 'daily_limit') return '已保存資料；今天的即時檢查申請已達上限，仍會由例行排程檢查。';
  return '已排入優先檢查，結果可在「我的網站」或待查清單查看。排程每五分鐘執行，仍可能受抓取額度與連線狀況影響。';
}
export function ClaimInstructions({ challenge, busy, onVerify }: { challenge: Challenge; busy: boolean; onVerify: () => void }) {
  return (
    <div className="space-y-3 rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
      <p>
        {challenge.method === 'meta'
          ? '將以下標籤加入網站首頁的 HTML head，發布後按下驗證。'
          : challenge.method === 'file'
            ? '建立純文字檔案，內容如下，並發布到指定網址。'
            : '將以下驗證碼放在「關於我」頁開頭的第一個獨立段落。首頁必須連到這個介紹頁；請勿放在留言區。'}
      </p>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded border border-zinc-200 p-2 text-xs dark:border-zinc-700">
        {challenge.marker}
      </pre>
      {challenge.fileUrl && <p className="break-all text-xs">檔案網址：{challenge.fileUrl}</p>}
      <p className="text-xs text-zinc-500">
        申請有效至 {new Date(challenge.expiresAt).toLocaleString('zh-TW')}。驗證碼可公開放在網站，不包含帳號或 Email。
      </p>
      <button type="button" className={button} disabled={busy} onClick={onVerify}>
        {busy ? '驗證中…' : '我已發布，驗證網站'}
      </button>
    </div>
  );
}
/** Same controls under address search, the queue and the private website manager. */
export function SiteParticipation({
  home,
  onChange,
  initialChallenge,
}: {
  home: string;
  onChange?: () => void;
  initialChallenge?: Challenge;
}) {
  const session = useSession();
  const [mode, setMode] = useState<'claim' | 'recommend' | null>(initialChallenge ? 'claim' : null);
  const [method, setMethod] = useState('about');
  const [relationship, setRelationship] = useState('both');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(initialChallenge || null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function act(action: () => Promise<string>) {
    setBusy(true);
    setMessage('');
    try {
      setMessage(await action());
      onChange?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '連線失敗，請稍後再試。');
    } finally {
      setBusy(false);
    }
  }
  if (!session?.enabled) return null;
  if (!session.user)
    return (
      <p className="mt-2 text-sm">
        <a className="text-brand-700 underline dark:text-brand-400" href={loginHref(`/queue/?q=${encodeURIComponent(home)}`)}>
          登入後驗證自己的網站、具名推薦或要求重新檢查
        </a>
      </p>
    );
  return (
    <div className="mt-3 space-y-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <button
          className={button}
          type="button"
          aria-pressed={mode === 'claim'}
          disabled={busy}
          onClick={() => {
            setMode('claim');
            setConfirmed(false);
            setMessage('');
          }}
        >
          這是我撰寫或管理的網站
        </button>
        <button
          className={button}
          type="button"
          aria-pressed={mode === 'recommend'}
          disabled={busy}
          onClick={() => {
            setMode('recommend');
            setConfirmed(false);
            setMessage('');
          }}
        >
          我想具名推薦這個網站
        </button>
        <button
          className={button}
          type="button"
          disabled={busy}
          onClick={() => act(async () => reviewMessage((await send('/api/me/sites/recheck', { url: home })).review))}
        >
          要求重新檢查
        </button>
      </div>
      {mode && !challenge && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            act(async () => {
              if (mode === 'recommend') {
                const result = await send('/api/me/sites/recommend', { url: home, confirm: confirmed, reason });
                setMode(null);
                return reviewMessage(result.review);
              }
              const result = await send<Challenge>('/api/me/sites/claims', { url: home, method, relationship, confirm: confirmed });
              setChallenge(result);
              return '驗證申請已建立，請依照下方步驟完成。';
            });
          }}
        >
          {mode === 'claim' ? (
            <>
              <label className="block space-y-1">
                <span>我與網站的關係</span>
                <select className={field} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
                  <option value="both">作者與管理者</option>
                  <option value="author">作者</option>
                  <option value="manager">管理者</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span>選擇一種驗證方式</span>
                <select className={field} value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="about">在關於頁放入驗證碼</option>
                  <option value="meta">在首頁加入 HTML 標籤</option>
                  <option value="file">上傳純文字驗證檔案</option>
                </select>
              </label>
            </>
          ) : (
            <label className="block space-y-1">
              <span>推薦理由（選填，最多 500 字）</span>
              <textarea
                className={field}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder="例如：長期閱讀、認識作者、社群成員"
              />
            </label>
          )}
          <label className="flex items-start gap-2">
            <input className="mt-1" type="checkbox" required checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>
              {mode === 'claim'
                ? '我確認能管理這個網站，且這是符合本站收錄範圍的個人、作者共筆或社群部落格。驗證成功僅代表網站控制權。'
                : '我確認這是實際經營、符合收錄範圍的部落格，願意以此登入帳號留下推薦紀錄。推薦不會取得網站管理權。'}
            </span>
          </label>
          <button type="submit" disabled={busy || !confirmed} className={button}>
            {busy ? '處理中…' : mode === 'claim' ? '建立驗證申請' : '確認推薦並排入檢查'}
          </button>
        </form>
      )}
      {challenge && mode === 'claim' && (
        <ClaimInstructions
          challenge={challenge}
          busy={busy}
          onVerify={() =>
            act(async () => {
              const result = await send(`/api/me/sites/claims/${challenge.id}/verify`);
              setChallenge(null);
              setMode(null);
              return `網站控制權已驗證。${reviewMessage(result.review)}`;
            })
          }
        />
      )}
      {message && (
        <p role="status" className="leading-relaxed">
          {message}
        </p>
      )}
      <Link className="inline-block text-brand-700 underline dark:text-brand-400" href="/my/sites/">
        我的網站與推薦紀錄
      </Link>
    </div>
  );
}

type SiteRow = {
  id: number;
  home: string;
  status: string;
  method?: string;
  relationship?: string;
  token?: string;
  expiresAt?: string;
  verifiedAt?: string;
  candidateStatus?: string;
  reason?: string;
  reviewReason?: string;
  reviewStatus?: string;
  requestedAt?: string;
  processedAt?: string;
  slug?: string;
  lastCrawlSuccessAt?: string;
};
export function MySites() {
  const session = useSession();
  const [data, setData] = useState<{ claims: SiteRow[]; recommendations: SiteRow[]; requests: SiteRow[] } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/me/sites', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) throw Error();
      setData(await response.json());
      setMessage('');
    } catch {
      setMessage('目前無法載入，請稍後重新整理。');
    }
  }, []);
  useEffect(() => {
    if (session?.user) load();
  }, [session, load]);
  if (!session) return <p>正在確認登入狀態…</p>;
  if (!session.user)
    return (
      <p>
        <a className="underline" href={loginHref('/my/sites/')}>
          登入後管理我的網站
        </a>
      </p>
    );
  return (
    <div className="space-y-5">
      <div className="flex gap-3">
        <Link className="underline" href="/queue/#add">
          新增或認領網站
        </Link>
        <button className="underline" type="button" onClick={load}>
          重新整理進度
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {!data ? (
        <p>正在載入網站資料…</p>
      ) : (
        (['claims', 'recommendations', 'requests'] as const).map((kind) => (
          <section className="space-y-3" key={kind}>
            <h2 className="text-lg font-semibold">
              {kind === 'claims' ? '我認領的網站' : kind === 'recommendations' ? '我的具名推薦' : '我要求的檢查'}
            </h2>
            {!data[kind].length && <p className="text-sm text-zinc-500">尚無紀錄。</p>}
            {data[kind].map((row) => {
              const pending = row.status === 'pending' && row.token && row.expiresAt && new Date(row.expiresAt).getTime() > Date.now();
              const challenge: Challenge | undefined = pending
                ? {
                    id: row.id,
                    home: row.home,
                    method: row.method!,
                    token: row.token!,
                    expiresAt: row.expiresAt!,
                    marker:
                      row.method === 'meta'
                        ? `<meta name="weblog-verification" content="${row.token}">`
                        : `weblog-verification: ${row.token}`,
                    fileUrl: row.method === 'file' ? `${row.home.replace(/\/$/, '')}/weblog-verification-${row.token}.txt` : null,
                  }
                : undefined;
              return (
                <article key={row.id} className="space-y-2 rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
                  <p className="break-all font-medium">{row.home}</p>
                  <p>
                    {kind === 'requests'
                      ? row.status === 'pending'
                        ? '等待優先檢查'
                        : '檢查已處理'
                      : row.status === 'verified'
                        ? '網站控制權已驗證'
                        : row.status === 'active'
                          ? '已具名推薦'
                          : row.status === 'revoked'
                            ? '已撤回'
                            : pending
                              ? '待完成控制權驗證'
                              : '驗證申請已過期'}
                    {row.candidateStatus === 'approved' ? ' · 已收錄' : ''}
                  </p>
                  {row.relationship && (
                    <p>
                      聲明的關係：{row.relationship === 'both' ? '作者與管理者' : row.relationship === 'author' ? '作者' : '管理者'}
                      。控制權驗證不會改寫文章署名。
                    </p>
                  )}
                  {row.slug && (
                    <Link href={blogHref(row.slug)} className="underline">
                      查看已收錄的網站
                    </Link>
                  )}
                  <p>
                    {row.candidateStatus === 'approved'
                      ? '網站已收錄，文章依抓取排程建立索引。'
                      : row.reviewStatus === 'pending'
                        ? '已排入優先檢查'
                        : candidateReasonText(row.reviewReason || (kind === 'claims' ? row.reason : null) || null)}
                  </p>
                  {kind === 'recommendations' && row.reason && <p>推薦理由：{row.reason}</p>}
                  {row.requestedAt && (
                    <p>
                      申請檢查：{new Date(row.requestedAt).toLocaleString('zh-TW')}
                      {row.processedAt && ` · 已處理：${new Date(row.processedAt).toLocaleString('zh-TW')}`}
                    </p>
                  )}
                  {row.lastCrawlSuccessAt && <p>上次成功抓取：{new Date(row.lastCrawlSuccessAt).toLocaleString('zh-TW')}</p>}
                  {row.status !== 'revoked' && (
                    <>
                      <SiteParticipation home={row.home} onChange={load} initialChallenge={challenge} />
                      {kind !== 'requests' && (
                        <button
                          className={button}
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await send(`/api/me/sites/${kind}/${row.id}/revoke`);
                              await load();
                            } catch (e) {
                              setMessage(e instanceof Error ? e.message : '撤回失敗。');
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          撤回{kind === 'claims' ? '認領' : '推薦'}（網站不會因此撤下）
                        </button>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
