'use client';

import { useEffect, useState } from 'react';

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
  return `RSS 偵測：${String(evidence.rssDetection || '待執行')} · 路徑：${String(evidence.discoveryPath || evidence.sourceUrl || '待補')}`;
}

export default function DiscoveryReview() {
  const [items, setItems] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [message, setMessage] = useState('載入中…');
  const load = async () => {
    const response = await fetch('/api/admin/discovery?status=candidate&limit=200', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) {
      setMessage(
        response.status === 401 ? '請先登入管理員帳號。' : response.status === 403 ? '此帳號沒有候選審核權限。' : '候選載入失敗。',
      );
      return;
    }
    const payload = (await response.json()) as { candidates?: Candidate[] };
    setItems(payload.candidates ?? []);
    setMessage(`${payload.candidates?.length ?? 0} 筆待審候選`);
  };
  // Candidate data is loaded once when the operator opens the page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional initial load
  useEffect(() => {
    void load();
  }, []);
  const review = async (status: 'approved' | 'rejected') => {
    if (!selected.length) return;
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
    setItems((current) => current.filter((item) => !selected.includes(item.id)));
    setSelected([]);
    setMessage(`已${status === 'approved' ? '核准' : '拒絕'}候選。`);
  };
  return (
    <div className="review-panel">
      <div className="directory-toolbar">
        <span>{message}</span>
        <span className="button-row review-actions">
          <button type="button" className="button" onClick={() => void review('approved')} disabled={!selected.length}>
            批次核准
          </button>
          <button type="button" className="button secondary" onClick={() => void review('rejected')} disabled={!selected.length}>
            批次拒絕
          </button>
        </span>
      </div>
      {items.length ? (
        <div className="review-list">
          {items.map((item) => (
            <label className="review-item" key={item.id}>
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={(event) =>
                  setSelected((current) => (event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id)))
                }
              />
              <span>
                <strong>{item.name || item.url}</strong>
                <small>{item.url}</small>
                <small>
                  {item.sourceType} · {item.sourceUrl || '來源頁待補'}
                </small>
                <small>{evidenceText(item.sourceEvidence)}</small>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h2>目前沒有待審候選</h2>
          <p>來源探索會依低頻排程更新。</p>
        </div>
      )}
    </div>
  );
}
