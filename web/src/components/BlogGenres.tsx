'use client';

import { useEffect, useState } from 'react';
import { loginHref, useSession } from '@/lib/session';
import { BLOG_GENRES, type BlogGenre } from '../../../app/src/blog-genre-vocabulary.ts';
import type { GenreState } from '../../../app/src/blog-genres/resolve.ts';

type PrivateState = { votes: Partial<Record<BlogGenre, number>>; admin: boolean; csrfToken: string };
const SOURCE = { ai: 'AI 初判', community: '讀者', admin: '管理員' };
const unavailable: GenreState = { status: 'unavailable', items: [] };
type Action = (genre: BlogGenre, kind: 'vote' | 'propose' | 'admin', value: number | string) => void;

export function BlogGenresView({
  state,
  signedIn,
  admin = false,
  votes = {},
  pending = false,
  onAction,
  loginUrl,
}: {
  state: GenreState;
  signedIn: boolean;
  admin?: boolean;
  votes?: PrivateState['votes'];
  pending?: boolean;
  onAction?: Action;
  loginUrl: string;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800" aria-label="部落格類型">
      <h2 className="font-semibold">部落格類型</h2>
      {state.status === 'unavailable' ? (
        <p role="status">類型資料暫時無法使用，請稍後再試。</p>
      ) : (
        <>
          {!state.items.length && <p>尚未分類，歡迎讀者提議。</p>}
          <ul className="space-y-3">
            {state.items.map((item) => (
              <li key={item.genre} className="space-y-1">
                <p>
                  <span className="rounded bg-zinc-100 px-2 py-1 dark:bg-zinc-800">{BLOG_GENRES[item.genre]}</span>{' '}
                  <span className="text-xs text-zinc-500">
                    {SOURCE[item.source]} · {item.visible ? '顯示中' : '未顯示'}
                    {item.adminOverride ? '（管理員覆寫）' : ''}
                  </span>
                </p>
                <p className="text-xs">
                  同意 {item.agrees} · 不同意 {item.disagrees}
                </p>
                {signedIn && (
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={pending}
                      aria-pressed={votes[item.genre] === 1}
                      onClick={() => onAction?.(item.genre, 'vote', votes[item.genre] === 1 ? 0 : 1)}
                    >
                      {votes[item.genre] === 1 ? '已同意（收回）' : '同意'}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      aria-pressed={votes[item.genre] === -1}
                      onClick={() => onAction?.(item.genre, 'vote', votes[item.genre] === -1 ? 0 : -1)}
                    >
                      {votes[item.genre] === -1 ? '已不同意（收回）' : '不同意'}
                    </button>
                    {admin && (
                      <button
                        type="button"
                        disabled={pending || !item.adminOverride}
                        onClick={() => onAction?.(item.genre, 'admin', 'release')}
                      >
                        解除管理員覆寫
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {signedIn && (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                onAction?.(data.get('genre') as BlogGenre, admin ? 'admin' : 'propose', admin ? String(data.get('action')) : 1);
              }}
            >
              <label>
                提議類型{' '}
                <select name="genre" className="rounded border p-1 dark:bg-zinc-900">
                  {Object.entries(BLOG_GENRES).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {admin && (
                <label>
                  管理員操作{' '}
                  <select name="action" className="rounded border p-1 dark:bg-zinc-900">
                    <option value="set">指定</option>
                    <option value="hide">隱藏</option>
                    <option value="release">解除覆寫</option>
                  </select>
                </label>
              )}
              <button type="submit" disabled={pending} className="rounded bg-brand-700 px-3 py-1 text-white">
                {admin ? '套用' : '提議並同意'}
              </button>
            </form>
          )}
        </>
      )}
      {!signedIn && (
        <p>
          <a className="text-brand-700 dark:text-brand-400" href={loginUrl}>
            登入後可同意、不同意或提議類型
          </a>
        </p>
      )}
      <p className="text-xs leading-5 text-zinc-500">
        AI 初判在同意票不少於不同意票時顯示；讀者提議須淨同意達 2 票。管理員覆寫優先，解除後恢復依票數判定。類型描述整個部落格，可能有誤。
      </p>
    </section>
  );
}

export default function BlogGenres({ slug, initialState }: { slug: string; initialState?: GenreState }) {
  const session = useSession();
  const [state, setState] = useState(initialState ?? unavailable);
  const [own, setOwn] = useState<PrivateState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setState(initialState ?? unavailable);
  }, [initialState]);
  useEffect(() => {
    const controller = new AbortController();
    setOwn(null);
    if (session?.user)
      fetch(`/api/me/blog-genres/${encodeURIComponent(slug)}`, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw Error();
          return response.json() as Promise<PrivateState>;
        })
        .then((value) => {
          if (!controller.signal.aborted) {
            setOwn(value);
            setError('');
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setError('無法載入投票功能，請重新整理。');
        });
    return () => controller.abort();
  }, [slug, session?.user]);
  const act: Action = async (genre, kind, value) => {
    if (!own || pending) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch(
        kind === 'propose'
          ? `/api/blogs/${encodeURIComponent(slug)}/genres/propose`
          : `/api/blogs/${encodeURIComponent(slug)}/genres/${genre}/${kind}`,
        {
          method: kind === 'propose' ? 'POST' : 'PUT',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'content-type': 'application/json', 'x-blog-csrf': own.csrfToken },
          body: JSON.stringify(kind === 'propose' ? { genre } : kind === 'vote' ? { vote: value } : { action: value }),
        },
      );
      if (!response.ok) throw Error(response.status === 429 ? '操作太頻繁，請稍候一分鐘再試。' : '儲存失敗，請重新整理後再試。');
      const result = await response.json();
      setState(result.genreState ?? unavailable);
      if (kind !== 'admin') setOwn({ ...own, votes: { ...own.votes, [genre]: kind === 'propose' ? 1 : Number(value) } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '儲存失敗');
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="space-y-2">
      <BlogGenresView
        state={state}
        signedIn={Boolean(session?.user)}
        admin={own?.admin}
        votes={own?.votes}
        pending={pending || !own}
        onAction={act}
        loginUrl={loginHref(`/blogs/${encodeURIComponent(slug)}/`)}
      />
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
