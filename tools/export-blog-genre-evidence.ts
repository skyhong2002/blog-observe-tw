import { writeFile } from 'node:fs/promises';
import type { RowDataPacket } from 'mysql2/promise';
import { createDb } from '../app/src/db/client.ts';

const output = process.argv[process.argv.indexOf('--output') + 1];
if (!process.argv.includes('--output') || !output) throw Error('usage: --output evidence.json');
const store = createDb(undefined, { poolSize: 1 });
try {
  const [blogs] = await store.pool.query<RowDataPacket[]>(
    `SET STATEMENT max_statement_time=5 FOR SELECT id,slug,name,url,description,category FROM blogs
    WHERE status='verified' ORDER BY id LIMIT 2001`,
  );
  if (blogs.length > 2000) throw Error('export-blog-limit');
  const evidence = [];
  for (let offset = 0; offset < blogs.length; offset += 25) {
    const batch = blogs.slice(offset, offset + 25);
    const parts = batch.map(
      () => `(SELECT id,blog_id blogId,title,published_at publishedAt FROM posts WHERE blog_id=?
      AND (published_at IS NULL OR published_at<=UTC_TIMESTAMP()) ORDER BY published_at DESC,id DESC LIMIT 15)`,
    );
    const [posts] = await store.pool.query<RowDataPacket[]>(
      `SET STATEMENT max_statement_time=5 FOR ${parts.join(' UNION ALL ')}`,
      batch.map((b) => b.id),
    );
    const ids = posts.map((p) => p.id);
    const [tags] = ids.length
      ? await store.pool.query<RowDataPacket[]>(
          `SET STATEMENT max_statement_time=5 FOR SELECT p.blog_id blogId,t.label,COUNT(DISTINCT p.id) n
      FROM posts p JOIN post_tags pt ON pt.post_id=p.id JOIN tags t ON t.id=pt.tag_id
      WHERE p.id IN (?) AND pt.status='active' AND t.status='active' AND t.visibility='public'
      GROUP BY p.blog_id,t.id,t.label ORDER BY p.blog_id,n DESC,t.label LIMIT 12001`,
          [ids],
        )
      : [[]];
    if (tags.length > 12000) throw Error('export-tag-limit');
    for (const blog of batch)
      evidence.push({
        ...blog,
        recentPosts: posts.filter((p) => p.blogId === blog.id).map(({ id, title, publishedAt }) => ({ id, title, publishedAt })),
        feedCategories: tags
          .filter((t) => t.blogId === blog.id)
          .slice(0, 15)
          .map(({ label, n }) => ({ label, posts: Number(n) })),
      });
  }
  await writeFile(
    output,
    JSON.stringify(
      { observedAt: new Date().toISOString(), method: 'latest-15-public-posts-and-their-feed-categories', blogs: evidence },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ blogs: evidence.length, output }));
} finally {
  await store.close();
}
