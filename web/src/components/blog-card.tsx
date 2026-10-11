import Link from 'next/link';
import type { Blog } from '@/lib/api';

export default function BlogCard({ blog }: { blog: Blog }) {
  return (
    <article className="card blog-card">
      <div className="meta-row">
        {blog.category && <span className="pill">{blog.category}</span>}
        {blog.statusLabel && <span>{blog.statusLabel}</span>}
      </div>
      <h2><Link href={`/blogs/${encodeURIComponent(blog.slug)}/`}>{blog.name}</Link></h2>
      <p>{blog.description || '尚未提供網站簡介。'}</p>
      <div className="card-footer">
        <Link className="text-link" href={`/blogs/${encodeURIComponent(blog.slug)}/`}>查看網站 →</Link>
        {blog.url && <span className="domain">{blog.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>}
      </div>
    </article>
  );
}
