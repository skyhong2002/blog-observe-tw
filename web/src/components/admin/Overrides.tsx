'use client';
import { useRef, useState } from 'react';
import { adminGet, manualOverride } from '@/lib/admin-client';
import { blogHref } from '@/lib/page-links';
import { button, input, panel, primary, type RunAction } from './shared';

type Blog = { id: number; slug: string; name: string };
type Post = { id: number; title: string };
export default function Overrides({ run, busy }: { run: RunAction; busy: boolean }) {
  const [q, setQ] = useState('');
  const [blogs, setBlogs] = useState<Blog[]>([]);
  const [blog, setBlog] = useState<Blog | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [existingTags, setExistingTags] = useState<Array<{ slug: string; label: string }>>([]);
  const [profileDraft, setProfileDraft] = useState({ bio: '', topics: '' });
  const generation = useRef(0);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [task, setTask] = useState('profile');
  const [entityId, setEntityId] = useState('');
  const [bio, setBio] = useState('');
  const [topics, setTopics] = useState('');
  const [note, setNote] = useState('');
  const [tag, setTag] = useState('');
  const [tagNote, setTagNote] = useState('');
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
    setProfileDraft({ bio: '', topics: '' });
    setExistingTags([]);
    setBlog(value);
    setTask('profile');
    setEntityId(String(value.id));
    setBio('');
    setTopics('');
    setPosts([]);
    setSearching(true);
    setError('');
    try {
      const data = await adminGet<{ posts: Post[]; blog: { tags?: Array<{ slug: string; label: string }> } }>(
        `/api/blogs/${encodeURIComponent(value.slug)}`,
      );
      if (version !== generation.current) return;
      setPosts(data.posts.filter((p) => Number.isSafeInteger(p.id) && p.id > 0));
      setExistingTags(data.blog.tags ?? []);
      const inference = await adminGet<{ profile: { bio: string; topics: string[] } | null }>(
        `/api/blogs/${encodeURIComponent(value.slug)}/inference`,
      );
      if (version !== generation.current) return;
      if (inference.profile) {
        setProfileDraft({ bio: inference.profile.bio, topics: inference.profile.topics.join('\n') });
        setBio(inference.profile.bio);
        setTopics(inference.profile.topics.join('\n'));
      }
    } catch {
      if (version !== generation.current) return;
      setError('已選取部落格；部分現有文章或簡介無法載入，請確認內容後再儲存。');
    } finally {
      if (version === generation.current) setSearching(false);
    }
  };
  const save = async () => {
    setError('');
    try {
      const id = Number(entityId);
      if (!Number.isSafeInteger(id) || id < 1) throw Error('請選擇或輸入有效的文章／部落格 ID。');
      const result = manualOverride(task === 'profile' ? bio : '', topics);
      await run('/api/admin/ai-override', {
        entityType: task === 'profile' ? 'blog' : 'post',
        entityId: id,
        task,
        result,
        note: note.trim(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '儲存失敗');
    }
  };
  const saveTag = async (action: string) => {
    if (!blog) return;
    try {
      await run('/api/admin/tags', { blogId: blog.id, label: tag.trim(), action, note: tagNote.trim() });
    } catch {
      /* shared action message */
    }
  };
  return (
    <div className="space-y-5">
      <section className={panel}>
        <h2 className="text-lg font-semibold">選擇部落格</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <label className="min-w-0 flex-1 text-sm">
            名稱或網址
            <input className={input} value={q} onChange={(e) => setQ(e.target.value)} maxLength={150} />
          </label>
          <button type="submit" className={button} disabled={busy || searching}>
            搜尋
          </button>
        </form>
        {searching ? <p role="status">正在載入…</p> : null}
        <ul className="grid gap-2 sm:grid-cols-2">
          {blogs.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                className={`${button} w-full text-left`}
                disabled={busy || searching}
                aria-pressed={blog?.id === b.id}
                onClick={() => void choose(b)}
              >
                {b.name} <small className="text-zinc-500">#{b.id}</small>
              </button>
            </li>
          ))}
        </ul>
        {blog ? (
          <p className="text-sm">
            目前選取：
            <a className="text-brand-700 underline dark:text-brand-400" href={blogHref(blog.slug)}>
              {blog.name}
            </a>
            （#{blog.id}）
          </p>
        ) : (
          <p className="text-sm text-zinc-500">請先搜尋並選擇來源，或在下方以確定的 ID 指定覆寫對象。</p>
        )}
      </section>
      <section className={panel}>
        <h2 className="text-lg font-semibold">AI 簡介與文章主題覆寫</h2>
        <p className="text-sm text-zinc-500">內容會標示「人工覆寫」。這個操作不會把候選站自動核准，也不會更改作者自行發布的標籤。</p>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              覆寫對象
              <select
                className={input}
                value={task}
                onChange={(e) => {
                  setTask(e.target.value);
                  setEntityId(e.target.value === 'profile' && blog ? String(blog.id) : '');
                  setBio(e.target.value === 'profile' ? profileDraft.bio : '');
                  setTopics(e.target.value === 'profile' ? profileDraft.topics : '');
                }}
              >
                <option value="profile">部落格簡介</option>
                <option value="topics">文章主題</option>
              </select>
            </label>
            <label className="text-sm">
              {task === 'profile' ? '部落格' : '文章'} ID
              <input
                className={input}
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                type="number"
                min="1"
                step="1"
                required
              />
            </label>
          </div>
          {task === 'topics' && posts.length ? (
            <label className="block text-sm">
              從此站已載入文章選擇
              <select
                className={input}
                value={posts.some((p) => String(p.id) === entityId) ? entityId : ''}
                onChange={(e) => {
                  setEntityId(e.target.value);
                  setTopics('');
                }}
              >
                <option value="">請選擇文章，或自行填入 ID</option>
                {posts.map((p) => (
                  <option key={p.id} value={p.id}>
                    #{p.id} · {p.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {task === 'profile' ? (
            <label className="block text-sm">
              簡介（最多 600 字）
              <textarea className={input} rows={5} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={600} />
            </label>
          ) : null}
          <label className="block text-sm">
            主題（每行一個，最多 8 個，每個 60 字）
            <textarea className={input} rows={4} value={topics} onChange={(e) => setTopics(e.target.value)} maxLength={488} />
          </label>
          <label className="block text-sm">
            覆寫原因
            <textarea className={input} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} required />
          </label>
          <button type="submit" className={primary} disabled={busy || searching || !entityId || !note.trim()}>
            儲存人工覆寫
          </button>
        </form>
        {error ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </section>
      <section className={panel}>
        <h2 className="text-lg font-semibold">人工標籤</h2>
        <p className="text-sm text-zinc-500">套用至上方選取的部落格。移除只影響這個人工標籤，不刪除 RSS 或社群標籤。</p>
        {existingTags.length ? (
          <fieldset className="flex flex-wrap gap-2" aria-label="目前公開標籤">
            {existingTags.map((t) => (
              <button key={t.slug} type="button" className={button} disabled={busy} onClick={() => setTag(t.label)}>
                {t.label}
              </button>
            ))}
          </fieldset>
        ) : null}
        <label className="block text-sm">
          標籤名稱
          <input className={input} value={tag} onChange={(e) => setTag(e.target.value)} maxLength={100} />
        </label>
        <label className="block text-sm">
          處理原因
          <textarea className={input} value={tagNote} onChange={(e) => setTagNote(e.target.value)} maxLength={500} rows={2} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={primary}
            disabled={busy || !blog || !tag.trim() || !tagNote.trim()}
            onClick={() => void saveTag('set')}
          >
            加入人工標籤
          </button>
          <button
            type="button"
            className={button}
            disabled={busy || !blog || !tag.trim() || !tagNote.trim()}
            onClick={() => void saveTag('remove')}
          >
            移除此人工標籤
          </button>
        </div>
      </section>
    </div>
  );
}
