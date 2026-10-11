'use client';

import { useEffect, useState } from 'react';

export default function FollowButton({ slug }: { slug: string }) {
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
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
        headers: { Origin: window.location.origin },
      });
      if (response.ok) setFollowing(!following);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button className="button secondary" type="button" onClick={toggle} disabled={busy}>
      {busy ? '處理中…' : following ? '已追蹤 · 取消追蹤' : '追蹤這個部落格'}
    </button>
  );
}
