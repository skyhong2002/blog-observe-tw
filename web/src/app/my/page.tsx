import Link from 'next/link';
import { listFollows } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function MyPage() {
  const follows = await listFollows();
  return (
    <section className="section-block my-page">
      <div className="page-heading">
        <p className="eyebrow">READER</p>
        <h1>我的閱讀</h1>
        <p>登入後管理追蹤的部落格，匯出個人 RSS 或 OPML。</p>
      </div>
      {follows === null ? (
        <div className="login-panel">
          <h2>登入以保存你的閱讀清單</h2>
          <p>Google 登入只用來管理追蹤與訂閱，不會代替你在原站閱讀。</p>
          <a className="button" href="/auth/google?next=%2Fmy%2F">
            使用 Google 登入
          </a>
        </div>
      ) : follows.length ? (
        <>
          <div className="directory-toolbar">
            <span>{follows.length} 個追蹤網站</span>
            <div className="export-links">
              <a href="/me/feed.xml">個人 RSS</a>
              <a href="/me/opml">匯出 OPML</a>
            </div>
          </div>
          <div className="follow-list">
            {follows.map((blog) => (
              <Link key={blog.slug} href={`/blogs/${encodeURIComponent(blog.slug)}/`} className="follow-item">
                <strong>{blog.name}</strong>
                <span>{blog.category ?? '未分類'}</span>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <div className="empty-state">
          <h2>還沒有追蹤的網站</h2>
          <p>
            先從{' '}
            <Link className="text-link" href="/blogs/">
              部落格目錄
            </Link>{' '}
            找到想持續閱讀的作者。
          </p>
        </div>
      )}
    </section>
  );
}
