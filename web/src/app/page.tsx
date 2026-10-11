import Link from 'next/link';
import BlogCard from '@/components/blog-card';
import { listBlogs } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const blogs = await listBlogs();
  const featured = blogs.slice(0, 6);
  return (
    <>
      <section className="hero">
        <p className="eyebrow">A directory for independent writing</p>
        <h1>找到值得持續閱讀的部落格。</h1>
        <p className="hero-copy">
          blog.observe.tw 收錄台灣部落格與獨立網站，整理更新狀態、分類與原站入口，讓探索和訂閱回到作者自己的網站。
        </p>
        <div className="button-row">
          <Link className="button" href="/blogs/">
            瀏覽部落格目錄
          </Link>
          <a className="button secondary" href="/auth/google?next=%2Fmy%2F">
            登入以保存訂閱
          </a>
        </div>
      </section>
      <section className="section-block" aria-labelledby="verified-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">COLLECTION</p>
            <h2 id="verified-title">已核對的網站</h2>
          </div>
          <Link className="text-link" href="/blogs/">
            查看全部 {blogs.length || ''} 個 →
          </Link>
        </div>
        {featured.length ? (
          <div className="card-grid">
            {featured.map((blog) => (
              <BlogCard key={blog.slug} blog={blog} />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </section>
    </>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <h2>目錄正在準備中</h2>
      <p>稍後再回來看看，或先閱讀資料來源與收錄方式。</p>
    </div>
  );
}
