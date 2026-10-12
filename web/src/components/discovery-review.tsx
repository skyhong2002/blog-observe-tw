'use client';

import { useCallback, useEffect, useState } from 'react';
import BlogIcon from '@/components/BlogIcon';

type Candidate = {
  id: number;
  url: string;
  name?: string | null;
  sourceType: string;
  sourceUrl?: string | null;
  sourceEvidence?: Record<string, unknown> | string | null;
  discoveredAt: string;
};

function evidenceText(value: Candidate['sourceEvidence']) {
  if (!value) return 'RSS 偵測：待執行';
  const evidence =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as Record<string, unknown>;
          } catch {
            return {};
          }
        })()
      : value;
  const review =
    evidence.automaticReview && typeof evidence.automaticReview === 'object' ? (evidence.automaticReview as Record<string, unknown>) : null;
  const reasons: Record<string, string> = {
    needs_publication_home: '原連結是文章或子頁，尚未確認所屬首頁',
    identity_not_confirmed: '首頁名稱尚未與來源名稱一致',
    platform_root: '平台總站，無法辨識個別作者',
    not_a_blog_publication: '連結不是部落格來源',
    missing_identity_name: '來源沒有可核對的名稱',
    no_verified_feed_or_sitemap: '尚未取得有效 RSS／Atom',
    feed_home_identity_mismatch: 'RSS 的首頁指向與候選不一致',
    feed_name_identity_mismatch: 'RSS 名稱與候選身份不一致',
    feed_entries_outside_publication: 'RSS 混有其他站點文章',
    robots_disallowed: 'robots 或來源存取規則限制',
    homepage_http_403: '來源拒絕存取（403）',
    homepage_http_404: '找不到候選首頁（404）',
    homepage_http_410: '來源已移除首頁（410）',
    homepage_http_500: '來源暫時發生錯誤（500）',
    fetch_failed: '來源連線或讀取失敗，保留待重試',
    redirect_not_publication_home: '轉址後不是可確認的部落格首頁',
    unsafe_xml: 'RSS 格式未通過安全檢查',
    empty_feed: 'RSS 尚無可驗證文章',
    timeout: '來源回應逾時，保留待重試',
  };
  const state = review ? reasons[String(review.reason)] || String(review.reason) : String(evidence.rssDetection || '待執行');
  return `自動驗證：${state} · 路徑：${String(evidence.discoveryPath || evidence.sourceUrl || '待補')}`;
}

export default function DiscoveryReview() {
  const [items, setItems] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [message, setMessage] = useState('載入中…');
  const load = useCallback(async () => {
    const response = await fetch('/api/admin/discovery?status=candidate&limit=200', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) {
      setMessage(
        response.status === 401 ? '請先登入管理員帳號。' : response.status === 403 ? '此帳號沒有候選審核權限。' : '候選載入失敗。',
      );
      return;
    }
    const payload = (await response.json()) as { candidates?: Candidate[] };
    setLoaded(true);
    setItems(payload.candidates ?? []);
    setMessage(`${payload.candidates?.length ?? 0} 筆保留候選`);
  }, []);
  // Candidate data is loaded once when the operator opens the page.
  useEffect(() => {
    void load().catch(() => setMessage('候選暫時無法載入，請稍後重新整理。'));
  }, [load]);
  const review = async (status: 'approved' | 'rejected') => {
    if (!selected.length || busy) return;
    if (selected.length > 100) {
      setMessage('每批最多選擇 100 筆候選。');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/admin/discovery/review', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: selected, status }),
      });
      if (!response.ok) {
        setMessage('審核失敗，請重新登入或稍後再試。');
        return;
      }
      await load();
      setSelected([]);
      const result = (await response.json()) as { changed: number };
      setMessage(`已${status === 'approved' ? '核准' : '拒絕'} ${result.changed} 筆候選。`);
    } catch {
      setMessage('網路錯誤，請重新整理確認審核結果。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span role="status">{message}</span>
        <span className="flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-10 rounded-lg bg-brand-700 px-4 text-sm text-white disabled:opacity-50"
            onClick={() => void review('approved')}
            disabled={!selected.length || busy}
          >
            批次核准
          </button>
          <button
            type="button"
            className="min-h-10 rounded-lg border border-zinc-300 px-4 text-sm disabled:opacity-50 dark:border-zinc-700"
            onClick={() => void review('rejected')}
            disabled={!selected.length || busy}
          >
            批次拒絕
          </button>
        </span>
      </div>
      {items.length ? (
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {items.map((item) => (
            <label
              className="flex items-start gap-3 py-4 text-sm [&_span]:min-w-0 [&_strong]:block [&_small]:block [&_small]:break-all [&_small]:text-xs [&_small]:leading-6 [&_small]:text-zinc-500"
              key={item.id}
            >
              <input
                type="checkbox"
                disabled={busy || (selected.length >= 100 && !selected.includes(item.id))}
                checked={selected.includes(item.id)}
                onChange={(event) =>
                  setSelected((current) => (event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)))
                }
              />
              <span>
                <strong>
                  <span className="inline-flex items-center gap-1.5">
                    <BlogIcon media={`candidate-${item.id}`} title={item.name || item.url} />
                    {item.name || item.url}
                  </span>
                </strong>
                <small>{item.url}</small>
                <small>
                  {item.sourceType} · {item.sourceUrl || '來源頁待補'}
                </small>
                <small>{evidenceText(item.sourceEvidence)}</small>
              </span>
            </label>
          ))}
        </div>
      ) : loaded ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-sm text-zinc-500 dark:border-zinc-700">
          <h2>目前沒有待審候選</h2>
          <p>來源探索會依低頻排程更新。</p>
        </div>
      ) : null}
    </div>
  );
}
