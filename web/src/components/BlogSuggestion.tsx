'use client';

import { useEffect, useState } from 'react';
import { candidateReasonText } from '@/lib/candidate-reasons';
import { blogHref } from '@/lib/page-links';
import { loginHref, useSession } from '@/lib/session';
import Link from './NoPrefetchLink';
import { SiteParticipation } from './SiteParticipation';

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
  const [showActions, setShowActions] = useState(false);
  useEffect(() => {
    setState(null);
    setShowActions(false);
    if (!address) return;
    const controller = new AbortController();
    fetch(`/api/blog-suggestions?url=${encodeURIComponent(address)}`, { cache: 'no-store', credentials: 'omit', signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<State>) : null))
      .then((value) => value && setState(value))
      .catch(() => undefined);
    return () => controller.abort();
  }, [address]);
  if (!state) return null;
  // Sign-in disabled on this server: there is no way to add, so only collected/queued states are said.
  if (state.state === 'new' && session && !session.enabled) return null;
  return (
    <div className="mt-3 space-y-1">
      <SuggestionNote
        state={state}
        busy={!session}
        onAdd={() => setShowActions(true)}
        signIn={session?.enabled && !session.user ? loginHref(`/queue/?q=${encodeURIComponent(address)}`) : null}
      />
      {(state.state === 'queued' || state.state === 'listed' || (state.state === 'new' && showActions)) && (
        <SiteParticipation key={state.home} home={state.home} />
      )}
    </div>
  );
}

/**
 * The 待查清單's own way in (/queue/#add): type a blog's address, see whether it is collected or queued, and add it
 * when signed in. The same check and note as under an empty address search, so the rules stay in one place.
 */
export function BlogSubmitForm({ initialAddress = '' }: { initialAddress?: string } = {}) {
  const initial = looksLikeAddress(initialAddress) ? initialAddress : '';
  const [text, setText] = useState(initial);
  const [asked, setAsked] = useState(initial);
  const invalid = asked !== '' && !looksLikeAddress(asked);
  return (
    <section
      id="add"
      aria-labelledby="add-blog"
      className="scroll-mt-24 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
    >
      <h2 id="add-blog" className="mb-2 text-sm font-semibold">
        新增部落格
      </h2>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setAsked(text.trim());
        }}
      >
        <label htmlFor="add-blog-url" className="sr-only">
          部落格網址
        </label>
        <input
          id="add-blog-url"
          type="text"
          inputMode="url"
          value={text}
          autoComplete="off"
          enterKeyHint="go"
          placeholder="部落格網址，例如 example.com"
          onChange={(event) => setText(event.target.value)}
          className="min-h-9 w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-base sm:max-w-96 sm:text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="min-h-9 shrink-0 rounded-lg bg-brand-700 px-3 text-sm text-white hover:bg-brand-800 disabled:opacity-60"
        >
          檢查
        </button>
      </form>
      {invalid ? (
        <p role="status" className="mt-2 text-zinc-600 dark:text-zinc-400">
          請輸入網址，例如 example.com。
        </p>
      ) : asked ? (
        <div className="text-zinc-700 dark:text-zinc-300">
          <BlogSuggestion key={asked} query={asked} />
        </div>
      ) : null}
    </section>
  );
}
