import type { Metadata } from 'next';
import Link from 'next/link';
import { getBlog, type Post } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const blog = await getBlog(slug);
  return { title: blog?.name ?? '找不到部落格', description: blog?.description ?? undefined };
}

export default async function BlogDetailPage({ params }: Props) {
  const { slug } = await params;
  const blog = await getBlog(slug);
  if (!blog) return <section className="empty-state"><h1>找不到這個部落格</h1><p><Link className="text-link" href="/blogs/">返回部落格目錄</Link></p></section>;
  const posts = blog.latestPosts ?? blog.posts ?? [];
  return (
    <section className="detail-page">
      <Link className="back-link" href="/blogs/">← 返回部落格目錄</Link>
      <article className="detail-card">
        <div className="meta-row">{blog.category && <span className="pill">{blog.category}</span>}{blog.statusLabel && <span>{blog.statusLabel}</span>}</div>
        <h1>{blog.name}</h1>
        <p className="lead">{blog.description || '目前只有來源名單資料，待完成網址核對與 RSS 偵測。'}</p>
        <dl className="detail-meta">
          <div><dt>網站</dt><dd>{blog.url ? <a href={blog.url} rel="noreferrer noopener">{blog.url}</a> : '網址待核對'}</dd></div>
          <div><dt>收錄方式</dt><dd>公開來源清單與 RSS / Atom 偵測</dd></div>
        </dl>
        <div className="button-row">{blog.url && <a className="button" href={blog.url} rel="noreferrer noopener">前往原站閱讀 ↗</a>}<a className="button secondary" href={`/auth/google?next=${encodeURIComponent(`/blogs/${slug}/`)}`}>登入後追蹤</a></div>
      </article>
      <section className="posts-section" aria-labelledby="posts-title">
        <div className="section-heading"><div><p className="eyebrow">LATEST POSTS</p><h2 id="posts-title">最近收錄文章</h2></div></div>
        {posts.length ? <div className="post-list">{posts.map((post, index) => <PostItem key={post.guid ?? post.url ?? `${post.title}-${index}`} post={post} />)}</div> : <p className="muted">尚未偵測到文章，稍後會依禮貌頻率重新檢查。</p>}
      </section>
    </section>
  );
}

function PostItem({ post }: { post: Post }) {
  const content = <><h3>{post.title}</h3>{post.summary && <p>{post.summary}</p>}<time>{post.publishedAt ? new Date(post.publishedAt).toLocaleDateString('zh-TW') : '日期待補'}</time></>;
  return post.url ? <a className="post-item" href={post.url} rel="noreferrer noopener">{content}</a> : <div className="post-item">{content}</div>;
}
