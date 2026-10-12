'use client';
import { useEffect, useState } from 'react';
import BlogIcon from '@/components/BlogIcon';
import type { Follow } from '@/lib/api';
import { blogHref } from '@/lib/page-links';
import Link from './NoPrefetchLink';
export default function ReaderList() {
  const [follows, setFollows] = useState<Follow[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'login' | 'error'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/me/follows', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) {
          setState('login');
          return;
        }
        if (!response.ok) throw new Error('Unable to load follows');
        const data = (await response.json()) as { follows: Follow[] };
        setFollows(data.follows);
        setState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, []);
  if (state === 'loading')
    return (
      <p role="status" className="py-8 text-zinc-500">
        正在載入閱讀清單…
      </p>
    );
  if (state === 'error')
    return (
      <p role="alert" className="py-8 text-zinc-500">
        暫時無法取得閱讀清單，請稍後重新整理。
      </p>
    );
  if (state === 'login')
    return (
      <section className="rounded-xl border border-zinc-300 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">登入以保存你的閱讀清單</h2>
        <p className="my-3 text-sm leading-7 text-zinc-600 dark:text-zinc-400">Google 登入只用來管理追蹤與訂閱，不會代替你在原站閱讀。</p>
        <a href="/auth/google?next=%2Fmy%2F" className="inline-flex min-h-10 items-center rounded-lg bg-brand-700 px-4 text-sm text-white">
          使用 Google 登入
        </a>
      </section>
    );
  return (
    <>
      <div className="flex flex-wrap justify-between gap-3 text-sm">
        <span className="text-zinc-500">{follows?.length ?? 0} 個追蹤網站</span>
        <div className="flex flex-wrap gap-4">
          <a className="text-brand-700 hover:underline dark:text-brand-400" href="/me/feed.xml">
            個人 RSS
          </a>
          <a className="text-brand-700 hover:underline dark:text-brand-400" href="/me/opml">
            匯出 OPML
          </a>
        </div>
      </div>
      {follows?.length ? (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {follows.map((blog) => (
            <li key={blog.slug}>
              <Link href={blogHref(blog.slug, blog.canonicalPath)} className="flex min-h-14 items-center justify-between gap-3 py-3">
                <strong className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 dark:text-brand-400">
                  <BlogIcon media={blog.slug} iconUrl={blog.iconUrl} title={blog.name} />
                  {blog.name}
                </strong>
                <span className="text-xs text-zinc-500">{blog.category ?? '未分類'}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <section className="rounded-xl border border-dashed border-zinc-300 p-8 dark:border-zinc-700">
          <h2 className="text-lg font-semibold">還沒有追蹤的網站</h2>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            先從{' '}
            <Link href="/blogs/" className="text-brand-700 hover:underline dark:text-brand-400">
              部落格目錄
            </Link>{' '}
            找到想持續閱讀的作者。
          </p>
        </section>
      )}
    </>
  );
}
