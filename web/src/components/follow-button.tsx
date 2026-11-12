'use client';

import { useState } from 'react';
import { ACTION_EVENT, type AnalyticsAction } from '@/lib/analytics-consent.mts';
import { useFollows } from '@/lib/follows-store';

const signIn = () => {
  window.location.href = `/auth/google?next=${encodeURIComponent(window.location.pathname)}`;
};

export default function FollowButton({ slug }: { slug: string }) {
  // One shared /api/me/follows read (lib/follows-store.ts); a toggle on this page overrides it until it unmounts.
  const follows = useFollows();
  const [toggled, setToggled] = useState<boolean | null>(null);
  const following = toggled ?? (follows.status === 'ready' && follows.follows.some((item) => item.slug === slug));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function toggle() {
    setBusy(true);
    setMessage('');
    try {
      // The follows read already said 401: go straight to sign-in. A session that expired since is caught below.
      if (follows.status === 'login') return signIn();
      const response = await fetch(`/api/blogs/${encodeURIComponent(slug)}/follow`, {
        method: following ? 'DELETE' : 'POST',
        credentials: 'same-origin',
      });
      if (response.status === 401) return signIn();
      if (response.ok) {
        // A completed follow only; no blog or reader identifiers.
        if (!following) window.dispatchEvent(new CustomEvent<AnalyticsAction>(ACTION_EVENT, { detail: 'follow' }));
        setToggled(!following);
      } else setMessage('追蹤設定未更新，請稍後再試。');
    } catch {
      setMessage('連線失敗，請稍後再試。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        className="inline-flex min-h-9 items-center rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:border-brand-600 hover:text-brand-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-brand-400"
        type="button"
        onClick={toggle}
        disabled={busy}
      >
        {busy ? '處理中…' : following ? '已追蹤 · 取消追蹤' : '追蹤這個部落格'}
      </button>
      {message && (
        <span role="status" className="text-xs text-zinc-500">
          {message}
        </span>
      )}
    </span>
  );
}
