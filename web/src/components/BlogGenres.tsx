'use client';

import { useEffect, useState } from 'react';
import { filterChipClass } from '@/components/FilterChips';
import { loginHref, useSession } from '@/lib/session';
import { BLOG_GENRES, type BlogGenre } from '../../../app/src/blog-genre-vocabulary.ts';
import type { GenreState } from '../../../app/src/blog-genres/resolve.ts';

type PrivateState = { votes: Partial<Record<BlogGenre, number>>; admin: boolean; csrfToken: string };
const control = 'min-h-8 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-900';
const button =
  'min-h-8 shrink-0 rounded-md border border-zinc-300 px-2.5 text-xs hover:border-brand-600 hover:text-brand-700 disabled:opacity-50 dark:border-zinc-700 dark:hover:text-brand-400';
const SOURCE = { ai: 'AI 初判', community: '讀者', admin: '管理員' };
const unavailable: GenreState = { status: 'unavailable', items: [] };
type Action = (genre: BlogGenre, kind: 'vote' | 'propose' | 'admin', value: number | string) => void;
const GENRES = Object.entries(BLOG_GENRES) as Array<[BlogGenre, string]>;

/** One genre picker and its buttons on one line: reader 提議, or the admin's 指定顯示 / 隱藏 / 解除覆寫. */
function GenrePicker({
  label,
  options,
  pending,
  actions,
}: {
  label: string;
  options: Array<[BlogGenre, string]>;
  pending: boolean;
  actions: Array<{ label: string; run: (genre: BlogGenre) => void }>;
}) {
  const [genre, setGenre] = useState<BlogGenre | ''>('');
  return (
    <div className="flex items-center gap-1.5">
      <select
        name="genre"
        aria-label={label}
        value={genre}
        onChange={(event) => setGenre(event.target.value as BlogGenre)}
        className={control}
      >
        <option value="" disabled>
          {label}
        </option>
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
      {actions.map((action) => (
        <button key={action.label} type="button" disabled={pending || !genre} className={button} onClick={() => genre && action.run(genre)}>
          {action.label}
        </button>
      ))}
    </div>
  );
}

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
  const listed = new Set(state.items.map((item) => item.genre));
  return (
    <section className="rounded-lg border border-zinc-200 p-3 text-xs dark:border-zinc-800" aria-label="部落格類型">
      <h2 className="mb-3 text-sm font-semibold">部落格類型</h2>
      {state.status === 'unavailable' ? (
        <p role="status" className="text-zinc-500 dark:text-zinc-400">
          類型資料暫時無法使用，請稍後再試。
        </p>
      ) : (
        <div className="space-y-3">
          {state.items.length > 0 && (
            <ul className="space-y-2">
              {state.items.map((item) => (
                <li key={item.genre} className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <span className={filterChipClass(item.visible)}>{BLOG_GENRES[item.genre]}</span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {SOURCE[item.source]}
                    {item.visible ? '' : ' · 未顯示'}
                    {item.adminOverride ? '（管理員覆寫）' : ''} · 同意 {item.agrees} · 不同意 {item.disagrees}
                  </span>
                  {signedIn && (
                    <span className="ml-auto flex gap-1.5">
                      <button
                        type="button"
                        disabled={pending}
                        aria-pressed={votes[item.genre] === 1}
                        className={filterChipClass(votes[item.genre] === 1)}
                        onClick={() => onAction?.(item.genre, 'vote', votes[item.genre] === 1 ? 0 : 1)}
                      >
                        {votes[item.genre] === 1 ? '已同意（收回）' : '同意'}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        aria-pressed={votes[item.genre] === -1}
                        className={filterChipClass(votes[item.genre] === -1)}
                        onClick={() => onAction?.(item.genre, 'vote', votes[item.genre] === -1 ? 0 : -1)}
                      >
                        {votes[item.genre] === -1 ? '已不同意（收回）' : '不同意'}
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {signedIn && GENRES.some(([id]) => !listed.has(id)) && (
            <GenrePicker
              label="提議其他類型"
              options={GENRES.filter(([id]) => !listed.has(id))}
              pending={pending}
              actions={[{ label: '提議', run: (genre) => onAction?.(genre, 'propose', 1) }]}
            />
          )}
          {signedIn && admin && (
            <details className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
              <summary className="cursor-pointer text-zinc-500 dark:text-zinc-400">管理員覆寫</summary>
              <div className="mt-2">
                <GenrePicker
                  label="選擇類型"
                  options={GENRES}
                  pending={pending}
                  actions={[
                    { label: '指定顯示', run: (genre) => onAction?.(genre, 'admin', 'set') },
                    { label: '隱藏', run: (genre) => onAction?.(genre, 'admin', 'hide') },
                    { label: '解除覆寫', run: (genre) => onAction?.(genre, 'admin', 'release') },
                  ]}
                />
              </div>
            </details>
          )}
        </div>
      )}
      {!signedIn && (
        <p className={state.items.length ? 'mt-3' : ''}>
          <a className="text-brand-700 hover:underline dark:text-brand-400" href={loginUrl}>
            登入後投票或提議類型 →
          </a>
        </p>
      )}
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
