/** Read-only projection for the shared Next UI. Counts describe indexed data,
 * not traffic, quality, or growth. No sibling database is queried. */
export async function loadOverview(pool) {
  const [postRows, tagRows, authorRows, blogRows, totalRows] = await Promise.all([
    pool.query(`SELECT p.id,p.guid,p.title,p.url,p.summary,p.author,p.published_at AS publishedAt,p.image_url AS imageUrl,
      b.slug AS blogSlug,b.name AS blogName FROM posts p JOIN blogs b ON b.id=p.blog_id
      WHERE b.status <> 'moved' ORDER BY p.published_at DESC,p.id DESC LIMIT 200`),
    pool.query(`SELECT t.slug,t.label,COUNT(DISTINCT p.id) AS postCount,COUNT(DISTINCT p.blog_id) AS blogCount
      FROM tags t JOIN post_tags pt ON pt.tag_id=t.id JOIN posts p ON p.id=pt.post_id JOIN blogs b ON b.id=p.blog_id
      WHERE b.status <> 'moved' AND t.visibility='public' AND t.status='active' AND pt.status='active'
      GROUP BY t.id,t.slug,t.label ORDER BY blogCount DESC,postCount DESC,t.slug LIMIT 100`),
    pool.query(`SELECT a.id,a.display_name AS displayName,b.slug AS blogSlug,b.name AS blogName,
      COUNT(DISTINCT p.id) AS postCount FROM authors a
      JOIN blog_authors ba ON ba.author_id=a.id JOIN blogs b ON b.id=ba.blog_id
      LEFT JOIN post_authors pa ON pa.author_id=a.id AND pa.status='active'
      LEFT JOIN posts p ON p.id=pa.post_id AND p.blog_id=b.id
      WHERE a.status <> 'rejected' AND ba.status='active' AND b.status <> 'moved'
      GROUP BY a.id,a.display_name,b.slug,b.name ORDER BY a.display_name,b.slug LIMIT 200`),
    pool.query(`SELECT b.id,b.slug,b.name,b.url,b.category,b.description,b.status,b.status_label AS statusLabel,
      b.last_crawl_success_at AS lastCrawlSuccessAt,b.last_published_at AS lastPublishedAt,
      b.expected_interval_hours AS expectedIntervalHours,COUNT(p.id) AS postCount
      FROM blogs b LEFT JOIN posts p ON p.blog_id=b.id WHERE b.status <> 'moved'
      GROUP BY b.id ORDER BY postCount DESC,b.name LIMIT 200`),
    pool.query(`SELECT (SELECT COUNT(*) FROM blogs WHERE status <> 'moved') AS blogs,
      (SELECT COUNT(*) FROM posts p JOIN blogs b ON b.id=p.blog_id WHERE b.status <> 'moved') AS posts,
      (SELECT MAX(last_crawl_success_at) FROM blogs) AS updatedAt`),
  ]);
  const row = totalRows[0][0];
  return {
    posts: postRows[0],
    tags: tagRows[0],
    authors: authorRows[0],
    blogs: blogRows[0],
    totals: { blogs: Number(row.blogs), posts: Number(row.posts) },
    updatedAt: row.updatedAt,
  };
}
