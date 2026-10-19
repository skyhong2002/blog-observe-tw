'use client';

import { useEffect, useState } from 'react';
import { candidateReasonText } from '@/lib/candidate-reasons';
import { blogHref } from '@/lib/page-links';
import { loginHref, useSession } from '@/lib/session';
import Link from './NoPrefetchLink';

// Under an empty search for an address (「thelingwu.com」): says whether that
// blog is collected or queued, and lets a signed-in reader add it
// (app/src/blog-suggestions.ts). Anything that is not an address renders nothing.
type State =
  | { state: 'invalid' }
  | { state: 'listed'; home: string; slug: string; name: string }
  | { state: 'unlisted'; home: string }
  | { state: 'queued'; home: string; checkedAt: string | null; reason: string | null }
  | { state: 'rejected'; home: string }
  | { state: 'new'; home: string };

/** Worth asking the gateway about: one word with a dot and a letter ending, with or without a scheme. */
export const looksLikeAddress = (q: string) => /^(https?:\/\/)?[^\s/]+\.[a-z¡-￿-]{2,}(\/\S*)?$/i.test(q.trim());

const shown = (home: string) => home.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
/** This site's row in the public 待查清單 (/queue/). */
export const queueHref = (site: string) => `/queue/?q=${encodeURIComponent(site)}`;

export function SuggestionNote({
  state,
  onAdd,
  busy,
  signIn,
}: {
  state: State;
  onAdd?: () => void;
  busy?: boolean;
  signIn?: string | null;
}) {
  const link = 'text-brand-700 hover:underline dark:text-brand-400';
  if (state.state === 'invalid') return null;
  const site = shown(state.home);
  if (state.state === 'listed')
    return (
      <p>
        {site} 已收錄：
        <Link className={link} href={blogHref(state.slug)}>
          {state.name}
        </Link>
        。
      </p>
    );
  if (state.state === 'unlisted') return <p>{site} 在本站資料中，但目前沒有公開。</p>;
  const queue = (
    <Link className={link} href={queueHref(site)}>
      待查清單
    </Link>
  );
  if (state.state === 'rejected')
    return (
      <p>
        {site} 先前已檢查過，沒有收錄（見{queue}）。
      </p>
    );
  if (state.state === 'queued') {
    const why = candidateReasonText(state.reason);
    return (
      <p>
        {site} 已在{queue}。{why && `上次檢查未通過：${why}。`}
      </p>
    );
  }
  return (
    <p>
      還沒收錄 {site}。
      {signIn ? (
        <a className={link} href={signIn}>
          登入後新增這個部落格
        </a>
      ) : (
        <button type="button" className={`${link} disabled:opacity-50`} onClick={onAdd} disabled={busy || !onAdd}>
          {busy ? '新增中…' : '新增這個部落格'}
        </button>
      )}
    </p>
  );
}

export default function BlogSuggestion({ query }: { query: string }) {
  const session = useSession();
  const address = looksLikeAddress(query) ? query.trim() : '';
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setState(null);
    setMessage('');
    if (!address) return;
    const controller = new AbortController();
    fetch(`/api/blog-suggestions?url=${encodeURIComponent(address)}`, { cache: 'no-store', credentials: 'omit', signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<State>) : null))
      .then((value) => value && setState(value))
      .catch(() => undefined);
    return () => controller.abort();
  }, [address]);
  if (!state) return null;
  async function add() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/me/blog-suggestions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: address }),
      });
      if (response.ok) setState((await response.json()) as State);
      else if (response.status === 401) window.location.href = loginHref(location.pathname + location.search);
      else setMessage(response.status === 429 ? '今天新增的部落格已達上限，明天再試。' : '沒有新增成功，請稍後再試。');
    } catch {
      setMessage('連線失敗，請稍後再試。');
    } finally {
      setBusy(false);
    }
  }
  // Sign-in disabled on this server: there is no way to add, so only collected/queued states are said.
  if (state.state === 'new' && session && !session.enabled) return null;
  return (
    <div className="mt-3 space-y-1">
      <SuggestionNote
        state={state}
        busy={busy || !session}
        onAdd={add}
        signIn={
          session?.enabled && !session.user ? loginHref(typeof location === 'undefined' ? '/' : location.pathname + location.search) : null
        }
      />
      {message && <p role="status">{message}</p>}
    </div>
  );
}
