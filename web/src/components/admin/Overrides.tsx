'use client';
import { useEffect, useRef, useState } from 'react';
import BlogIcon from '@/components/BlogIcon';
import { adminGet, manualOverride } from '@/lib/admin-client';
import { blogHref } from '@/lib/page-links';
import { button, input, primary, type RunAction } from './shared';

type Blog = { id: number; slug: string; name: string; url?: string | null; iconUrl?: string | null };
type Post = { id: number; title: string };
const heading = 'text-base font-semibold';
const hint = 'text-sm text-zinc-600 dark:text-zinc-400';
const section = 'space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800';

/** Correct how one blog is described on the site: its profile, its tags and the topics of one of its posts. */
export default function Overrides({ run, busy }: { run: RunAction; busy: boolean }) {
  const [q, setQ] = useState('');
  const [blogs, setBlogs] = useState<Blog[] | null>(null);
  const [blog, setBlog] = useState<Blog | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [existingTags, setExistingTags] = useState<Array<{ slug: string; label: string }>>([]);
  const [hasProfile, setHasProfile] = useState(false);
  const generation = useRef(0);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [bio, setBio] = useState('');
  const [topics, setTopics] = useState('');
  const [postId, setPostId] = useState('');
  const [postTopics, setPostTopics] = useState('');
  const [note, setNote] = useState('');
  const [tag, setTag] = useState('');
  const [allTags, setAllTags] = useState(false);
  const search = async () => {
    setSearching(true);
    setError('');
    try {
      const result = await adminGet<{ blogs: Blog[] }>(`/api/catalog?${new URLSearchParams({ q, limit: '10' })}`);
      setBlogs(result.blogs);
    } catch (e) {
      setError(e instanceof Error ? e.message : '搜尋失敗');
    } finally {
      setSearching(false);
    }
  };
  const choose = async (value: Blog) => {
    const version = ++generation.current;
    setBlog(value);
    setBlogs(null);
    setExistingTags([]);
    setHasProfile(false);
    setBio('');
    setTopics('');
    setPosts([]);
    setPostId('');
    setPostTopics('');
    setTag('');
    setAllTags(false);
    setSearching(true);
    setError('');
    try {
      const data = await adminGet<{ posts: Post[]; blog: Blog & { tags?: Array<{ slug: string; label: string }> } }>(
        `/api/blogs/${encodeURIComponent(value.slug)}`,
      );
      if (version !== generation.current) return;
      setBlog((b) => (b ? { ...b, url: data.blog.url ?? b.url, iconUrl: data.blog.iconUrl ?? b.iconUrl } : b));
      setPosts(data.posts.filter((p) => Number.isSafeInteger(p.id) && p.id > 0));
      setExistingTags(data.blog.tags ?? []);
      const inference = await adminGet<{ profile: { bio: string; topics: string[] } | null }>(
        `/api/blogs/${encodeURIComponent(value.slug)}/inference`,
      );
      if (version !== generation.current) return;
      if (inference.profile) {
        setHasProfile(true);
        setBio(inference.profile.bio);
        setTopics(inference.profile.topics.join('\n'));
      }
    } catch {
      if (version !== generation.current) return;
      setError('部分文章或目前的簡介沒有載入，請確認內容後再儲存。');
    } finally {
      if (version === generation.current) setSearching(false);
    }
  };
  // Opened from a row of /admin/blogs/ (?blog=<slug>): choose that blog, or leave the slug in the search box if it
  // cannot be read. Read in the browser, so no admin page reads searchParams (web/test/page-metadata.test.ts).
  // Runs once; choose() is redefined every render.
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('blog');
    if (!slug) return;
    adminGet<{ blog: Blog }>(`/api/blogs/${encodeURIComponent(slug)}`)
      .then(({ blog: b }) => choose({ id: b.id, slug: b.slug, name: b.name, url: b.url, iconUrl: b.iconUrl }))
      .catch(() => setQ(slug));
  }, []);
  const override = async (entityType: 'blog' | 'post', entityId: number, text: string, list: string) => {
    setError('');
    try {
      await run('/api/admin/ai-override', {
        entityType,
        entityId,
        task: entityType === 'blog' ? 'profile' : 'topics',
        result: manualOverride(text, list),
        note: note.trim(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    }
  };
  const saveTag = async (action: 'set' | 'remove') => {
    if (!blog) return;
    try {
      await run('/api/admin/tags', { blogId: blog.id, label: tag.trim(), action, note: note.trim() });
    } catch {
      /* shared action message */
    }
  };
  const noted = Boolean(note.trim());
  return (
    <div className="space-y-6">
      {blog ? (
        <div className="flex flex-wrap items-center gap-3">
          <BlogIcon media={blog.slug} iconUrl={blog.iconUrl} title={blog.name} size={32} />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold">{blog.name}</p>
            <p className="truncate text-sm text-zinc-500">
              #{blog.id}
              {blog.url ? ` · ${blog.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}` : ''} ·{' '}
              <a className="text-brand-700 hover:underline dark:text-brand-400" href={blogHref(blog.slug)}>
                看公開頁
              </a>
            </p>
          </div>
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => {
              generation.current++;
              setBlog(null);
              setSearching(false);
            }}
          >
            換一個部落格
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className={hint}>
            這頁用來修正某個部落格在站上的樣子：AI
            寫的部落格簡介、部落格標籤，以及單篇文章的主題。先找到要改的部落格；也可以從「部落格」分頁點名稱過來。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
            className="flex max-w-xl gap-2"
          >
            <label className="min-w-0 flex-1 text-sm">
              <span className="sr-only">名稱或網址</span>
              <input
                className={`${input} !mt-0`}
                type="search"
                placeholder="部落格名稱或網址"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                maxLength={150}
              />
            </label>
            <button type="submit" className={button} disabled={busy || searching || !q.trim()}>
              搜尋
            </button>
          </form>
          {blogs ? (
            blogs.length ? (
              <ul className="max-w-xl divide-y divide-zinc-200 dark:divide-zinc-800">
                {blogs.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-1 py-2.5 text-left hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-900"
                      disabled={busy || searching}
                      onClick={() => void choose(b)}
                    >
                      <BlogIcon media={b.slug} iconUrl={b.iconUrl} title={b.name} size={20} />
                      <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
                      <span className="truncate text-xs text-zinc-500">
                        {b.url?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={hint}>找不到符合的部落格。</p>
            )
          ) : null}
        </div>
      )}
      {searching ? <p role="status">正在載入…</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {blog ? (
        <>
          <label className="block max-w-xl text-sm">
            修改原因（必填，下面每一項修改都會連同原因留在稽核紀錄）
            <input className={input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </label>

          <section className={section}>
            <h2 className={heading}>部落格簡介</h2>
            <p className={hint}>
              {hasProfile
                ? '下面是站上現在顯示的 AI 簡介與主題。改好後儲存，公開頁會改顯示你的版本並標示「人工覆寫」。'
                : '這個部落格還沒有 AI 簡介。寫下的內容會顯示在公開頁，並標示「人工覆寫」。'}
            </p>
            <label className="block text-sm">
              簡介（最多 600 字）
              <textarea className={input} rows={4} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={600} />
            </label>
            <label className="block text-sm">
              主題（每行一個，最多 8 個）
              <textarea className={input} rows={3} value={topics} onChange={(e) => setTopics(e.target.value)} maxLength={488} />
            </label>
            <button
              type="button"
              className={primary}
              disabled={busy || searching || !noted}
              onClick={() => void override('blog', blog.id, bio, topics)}
            >
              儲存簡介
            </button>
          </section>

          <section className={section}>
            <h2 className={heading}>部落格標籤</h2>
            <p className={hint}>
              目前的標籤大多來自文章的 RSS 分類。這裡加的是人工標籤；移除也只會拿掉人工標籤，不會動到 RSS 帶來的。點下面的標籤可以帶入名稱。
            </p>
            {existingTags.length ? (
              <div className="flex flex-wrap gap-1.5">
                {(allTags ? existingTags : existingTags.slice(0, 30)).map((t) => (
                  <button
                    key={t.slug}
                    type="button"
                    className="rounded-full bg-zinc-100 px-3 py-1 text-sm hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                    disabled={busy}
                    onClick={() => setTag(t.label)}
                  >
                    {t.label}
                  </button>
                ))}
                {existingTags.length > 30 ? (
                  <button
                    type="button"
                    className="px-2 py-1 text-sm text-brand-700 hover:underline dark:text-brand-400"
                    onClick={() => setAllTags(!allTags)}
                  >
                    {allTags ? '收起' : `顯示全部 ${existingTags.length} 個`}
                  </button>
                ) : null}
              </div>
            ) : (
              <p className={hint}>目前沒有標籤。</p>
            )}
            <div className="flex max-w-xl flex-wrap items-end gap-2">
              <label className="min-w-48 flex-1 text-sm">
                標籤名稱
                <input className={input} value={tag} onChange={(e) => setTag(e.target.value)} maxLength={100} />
              </label>
              <button type="button" className={primary} disabled={busy || !tag.trim() || !noted} onClick={() => void saveTag('set')}>
                加入
              </button>
              <button type="button" className={button} disabled={busy || !tag.trim() || !noted} onClick={() => void saveTag('remove')}>
                移除
              </button>
            </div>
          </section>

          <section className={section}>
            <h2 className={heading}>單篇文章的主題</h2>
            <p className={hint}>AI 替每篇文章整理的主題有錯時，選一篇文章寫下正確的主題。</p>
            <label className="block text-sm">
              文章
              <select className={input} value={postId} onChange={(e) => setPostId(e.target.value)} disabled={!posts.length}>
                <option value="">{posts.length ? '選一篇最近的文章' : '這個部落格還沒有收錄文章'}</option>
                {posts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              主題（每行一個，最多 8 個）
              <textarea className={input} rows={3} value={postTopics} onChange={(e) => setPostTopics(e.target.value)} maxLength={488} />
            </label>
            <button
              type="button"
              className={primary}
              disabled={busy || !postId || !postTopics.trim() || !noted}
              onClick={() => void override('post', Number(postId), '', postTopics)}
            >
              儲存文章主題
            </button>
          </section>
        </>
      ) : null}
    </div>
  );
}
