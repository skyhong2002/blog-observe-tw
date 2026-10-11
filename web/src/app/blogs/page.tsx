import BlogCard from '@/components/blog-card';
import { listBlogs } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function BlogsPage() {
  const blogs = await listBlogs();
  return (
    <section className="section-block directory-page">
      <div className="page-heading"><p className="eyebrow">DIRECTORY</p><h1>部落格目錄</h1><p>按分類探索作者自己的網站，從原站閱讀完整文章。</p></div>
      <div className="directory-toolbar"><span>{blogs.length} 個網站</span><span className="toolbar-note">資料會依來源更新頻率低頻檢查</span></div>
      {blogs.length ? <div className="card-grid">{blogs.map((blog) => <BlogCard key={blog.slug} blog={blog} />)}</div> : <div className="empty-state"><h2>目前沒有可顯示的網站</h2><p>請稍後再試。</p></div>}
    </section>
  );
}
