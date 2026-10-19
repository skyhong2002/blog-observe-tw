'use client';

import { useEffect, useRef, useState } from 'react';
import { filterChipClass } from '@/components/FilterChips';
import { loginHref, useSession } from '@/lib/session';
import { BLOG_GENRES, GENRE_TEXT_LIMIT, genreKey } from '../../../app/src/blog-genre-vocabulary.ts';
import type { GenreState } from '../../../app/src/blog-genres/resolve.ts';

type PrivateState = { votes: Record<string, number>; admin: boolean; csrfToken: string };
const control = 'min-h-8 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 text-xs dark:border-zinc-700 dark:bg-zinc-900';
const button =
  'min-h-8 shrink-0 rounded-md border border-zinc-300 px-2.5 text-xs hover:border-brand-600 hover:text-brand-700 disabled:opacity-50 dark:border-zinc-700 dark:hover:text-brand-400';
const SOURCE = { ai: 'AI 初判', community: '讀者', admin: '管理員' };
const unavailable: GenreState = { status: 'unavailable', items: [] };
type Action = (genre: string, kind: 'vote' | 'propose' | 'admin', value: number | string) => void;

/** What a reader typed, as genre keys: commas and 、 separate several; text no genre can be is dropped. */
export const typedGenres = (text: string) => [
  ...new Set(
    text
      .split(/[,，、;；]/)
      .map(genreKey)
      .filter((key): key is string => key !== null),
  ),
];

/** A free-text genre box with suggestions and its buttons on one line: reader 新增, or the admin's overrides. */
function GenreInput({
  id,
  placeholder,
  suggestions,
  pending,
  actions,
}: {
  id: string;
  placeholder: string;
  suggestions: string[];
  pending: boolean;
  actions: Array<{ label: string; run: (genres: string[]) => void }>;
}) {
  const [text, setText] = useState('');
  const genres = typedGenres(text);
  const run = (action: (typeof actions)[number]) => {
    if (!genres.length) return;
    action.run(genres);
    setText('');
  };
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        run(actions[0]);
      }}
    >
      <input
        name="genre"
        aria-label={placeholder}
        placeholder={placeholder}
        list={`${id}-suggestions`}
        value={text}
        maxLength={GENRE_TEXT_LIMIT * 3}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(event) => setText(event.target.value)}
        className={control}
      />
      <datalist id={`${id}-suggestions`}>
        {suggestions.map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>
      {actions.map((action, index) => (
        <button
          key={action.label}
          type={index === 0 ? 'submit' : 'button'}
          disabled={pending || !genres.length}
          className={button}
          onClick={index === 0 ? undefined : () => run(action)}
        >
          {action.label}
        </button>
      ))}
    </form>
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
  // The starting genres not on this blog yet; readers may also type any other.
  const suggestions = Object.entries(BLOG_GENRES)
    .filter(([key]) => !listed.has(key))
    .map(([, label]) => label);
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
                  <a href={`/blogs/?genre=${encodeURIComponent(item.genre)}`} className={filterChipClass(item.visible)}>
                    {item.label}
                  </a>
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
          {signedIn && (
            <GenreInput
              id="genre-add"
              placeholder="新增類型，例如：咖啡"
              suggestions={suggestions}
              pending={pending}
              actions={[
                {
                  label: '新增',
                  run: (genres) => {
                    for (const genre of genres) onAction?.(genre, 'propose', 1);
                  },
                },
              ]}
            />
          )}
          {signedIn && admin && (
            <details className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
              <summary className="cursor-pointer text-zinc-500 dark:text-zinc-400">管理員覆寫</summary>
              <div className="mt-2">
                <GenreInput
                  id="genre-admin"
                  placeholder="類型"
                  suggestions={[...state.items.map((item) => item.label), ...suggestions]}
                  pending={pending}
                  actions={[
                    {
                      label: '指定顯示',
                      run: (genres) => {
                        for (const genre of genres) onAction?.(genre, 'admin', 'set');
                      },
                    },
                    {
                      label: '隱藏',
                      run: (genres) => {
                        for (const genre of genres) onAction?.(genre, 'admin', 'hide');
                      },
                    },
                    {
                      label: '解除覆寫',
                      run: (genres) => {
                        for (const genre of genres) onAction?.(genre, 'admin', 'release');
                      },
                    },
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
            登入後投票或新增類型 →
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
  const queue = useRef(Promise.resolve());
  const send = async (genre: string, kind: 'vote' | 'propose' | 'admin', value: number | string) => {
    if (!own) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch(
        kind === 'propose'
          ? `/api/blogs/${encodeURIComponent(slug)}/genres/propose`
          : `/api/blogs/${encodeURIComponent(slug)}/genres/${encodeURIComponent(genre)}/${kind}`,
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
      if (kind !== 'admin')
        setOwn((current) => current && { ...current, votes: { ...current.votes, [genre]: kind === 'propose' ? 1 : Number(value) } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '儲存失敗');
    } finally {
      setPending(false);
    }
  };
  // Several typed genres run one after another, each on the state the previous one returned.
  const act: Action = (genre, kind, value) => {
    queue.current = queue.current.then(() => send(genre, kind, value));
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
