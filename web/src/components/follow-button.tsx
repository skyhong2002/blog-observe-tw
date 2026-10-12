'use client';

import { useEffect, useState } from 'react';

export default function FollowButton({ slug }: { slug: string }) {
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/api/me/follows', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { follows?: Array<{ slug: string }> } | null) => {
        if (active) setFollowing(Boolean(payload?.follows?.some((item) => item.slug === slug)));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [slug]);
  async function toggle() {
    setBusy(true);
    setMessage('');
    try {
      const me = await fetch('/auth/me', { credentials: 'same-origin' });
      const account = me.ok ? ((await me.json()) as { user?: unknown }) : null;
      if (!account?.user) {
        window.location.href = `/auth/google?next=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      const response = await fetch(`/api/blogs/${encodeURIComponent(slug)}/follow`, {
        method: following ? 'DELETE' : 'POST',
        credentials: 'same-origin',
      });
      if (response.ok) setFollowing(!following);
      else setMessage('追蹤設定未更新，請稍後再試。');
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
