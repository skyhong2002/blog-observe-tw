import { publicPost } from './public-post.ts';
import { TopicResponseCache } from './topics/cache.ts';
import { iconManifest } from './v1/favicon-routes.ts';
import { iconUrl } from './v1/icons.ts';

const overviewCaches = new WeakMap();
export function loadOverview(pool, { home = false } = {}) {
  let cache = overviewCaches.get(pool);
  if (!cache) {
    cache = new TopicResponseCache(60000, 1);
    overviewCaches.set(pool, cache);
  }
  return cache.get(home ? 'overview:home' : 'overview', () => (home ? loadHomeProjection(pool) : loadProjection(pool)));
}
export function invalidateOverviewCache(pool) {
  overviewCaches.get(pool)?.clear();
}

const blogFields = `b.id,b.slug,b.name,b.url,b.category,b.description,b.status,b.status_label AS statusLabel,
  b.last_crawl_success_at AS lastCrawlSuccessAt,b.last_published_at AS lastPublishedAt,
  b.expected_interval_hours AS expectedIntervalHours,(SELECT COUNT(*) FROM posts cp WHERE cp.blog_id=b.id AND (cp.published_at IS NULL OR cp.published_at<=UTC_TIMESTAMP())) AS postCount,
  latest.id latestPostId,latest.title latestPostTitle,latest.url latestPostUrl,latest.published_at latestPostPublishedAt`;
const latestJoin = `LEFT JOIN posts latest ON latest.id=(SELECT lp.id FROM posts lp WHERE lp.blog_id=b.id
  AND (lp.published_at IS NULL OR lp.published_at<=UTC_TIMESTAMP()) ORDER BY lp.published_at DESC,lp.id DESC LIMIT 1)`;
const blogDto = (row, icons) => {
  const { latestPostId, latestPostTitle, latestPostUrl, latestPostPublishedAt, ...blog } = row;
  return {
    ...blog,
    iconUrl: iconUrl(blog.slug, icons),
    postCount: Number(blog.postCount),
    latestPost: latestPostId
      ? { id: Number(latestPostId), title: latestPostTitle, url: latestPostUrl, publishedAt: latestPostPublishedAt }
      : null,
  };
};

/** Homepage needs seven articles, thirty cloud labels, eight authors and ten recent blogs.
 * Keep the full overview contract available, but do not collect unused catalog/description rows.
 * Compact recentBlogs intentionally omit description and postCount: the home sidebar only
 * renders identity, the latest article and its timestamp. Full overview retains those fields.
 * All SQL reads remain fresh and use the same admission boundary as the full projection. */
async function loadHomeProjection(pool) {
  const [postRows, tagRows] = await Promise.all([
    pool.query(`SELECT p.id,p.guid,p.title,p.url,p.summary,p.author,p.published_at AS publishedAt,p.image_url AS imageUrl,
      b.slug AS blogSlug,b.name AS blogName FROM posts p JOIN blogs b ON b.id=p.blog_id
      WHERE b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP()) ORDER BY p.published_at DESC,p.id DESC LIMIT 7`),
    pool.query(`SELECT t.slug,t.label,COUNT(DISTINCT p.id) AS postCount,COUNT(DISTINCT p.blog_id) AS blogCount
      FROM tags t JOIN post_tags pt ON pt.tag_id=t.id JOIN posts p ON p.id=pt.post_id JOIN blogs b ON b.id=p.blog_id
      WHERE b.status='verified' AND t.visibility='public' AND t.status='active' AND pt.status='active' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())
      GROUP BY t.id,t.slug,t.label ORDER BY blogCount DESC,postCount DESC,t.slug LIMIT 30`),
  ]);
  const [authorRows, totalRows] = await Promise.all([
    pool.query(`SELECT a.id,a.display_name AS displayName,b.slug AS blogSlug,b.name AS blogName,
      COUNT(DISTINCT p.id) AS postCount FROM authors a
      JOIN blog_authors ba ON ba.author_id=a.id JOIN blogs b ON b.id=ba.blog_id
      LEFT JOIN post_authors pa ON pa.author_id=a.id AND pa.status='active'
      LEFT JOIN posts p ON p.id=pa.post_id AND p.blog_id=b.id AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())
      WHERE a.status <> 'rejected' AND ba.status='active' AND b.status='verified'
      GROUP BY a.id,a.display_name,b.slug,b.name ORDER BY a.display_name,b.slug LIMIT 8`),
    pool.query(`SELECT (SELECT COUNT(*) FROM blogs WHERE status='verified') AS blogs,
      (SELECT COUNT(*) FROM posts p JOIN blogs b ON b.id=p.blog_id WHERE b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())) AS posts,
      (SELECT MAX(last_crawl_success_at) FROM blogs WHERE status='verified') AS updatedAt`),
  ]);
  const [recentRows] = await pool.query(`SELECT b.id,b.slug,b.name,b.url,b.last_published_at AS lastPublishedAt,
    latest.id latestPostId,latest.title latestPostTitle,latest.url latestPostUrl,latest.published_at latestPostPublishedAt
    FROM blogs b ${latestJoin} WHERE b.status='verified' AND latest.published_at IS NOT NULL
    ORDER BY latest.published_at DESC,latest.id DESC,b.id LIMIT 10`);
  const icons = await iconManifest();
  const row = totalRows[0][0];
  return {
    view: 'home',
    generatedAt: new Date().toISOString(),
    cacheSeconds: 0,
    posts: postRows[0].map(publicPost),
    tags: tagRows[0],
    authors: authorRows[0],
    blogs: [],
    recentBlogs: recentRows.map(({ latestPostId, latestPostTitle, latestPostUrl, latestPostPublishedAt, ...blog }) => ({
      ...blog,
      iconUrl: iconUrl(blog.slug, icons),
      latestPost: latestPostId
        ? {
            id: Number(latestPostId),
            title: latestPostTitle,
            url: latestPostUrl,
            publishedAt: latestPostPublishedAt,
          }
        : null,
    })),
    totals: { blogs: Number(row.blogs), posts: Number(row.posts) },
    updatedAt: row.updatedAt,
  };
}

/** Read-only projection for the shared Next UI. Counts describe indexed data,
 * not traffic, quality, or growth. No sibling database is queried. */
async function loadProjection(pool) {
  const [postRows, tagRows, authorRows, blogRows, totalRows, recentRows] = await Promise.all([
    pool.query(`SELECT p.id,p.guid,p.title,p.url,p.summary,p.author,p.published_at AS publishedAt,p.image_url AS imageUrl,
      b.slug AS blogSlug,b.name AS blogName FROM posts p JOIN blogs b ON b.id=p.blog_id
      WHERE b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP()) ORDER BY p.published_at DESC,p.id DESC LIMIT 200`),
    pool.query(`SELECT t.slug,t.label,COUNT(DISTINCT p.id) AS postCount,COUNT(DISTINCT p.blog_id) AS blogCount
      FROM tags t JOIN post_tags pt ON pt.tag_id=t.id JOIN posts p ON p.id=pt.post_id JOIN blogs b ON b.id=p.blog_id
      WHERE b.status='verified' AND t.visibility='public' AND t.status='active' AND pt.status='active' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())
      GROUP BY t.id,t.slug,t.label ORDER BY blogCount DESC,postCount DESC,t.slug LIMIT 100`),
    pool.query(`SELECT a.id,a.display_name AS displayName,b.slug AS blogSlug,b.name AS blogName,
      COUNT(DISTINCT p.id) AS postCount FROM authors a
      JOIN blog_authors ba ON ba.author_id=a.id JOIN blogs b ON b.id=ba.blog_id
      LEFT JOIN post_authors pa ON pa.author_id=a.id AND pa.status='active'
      LEFT JOIN posts p ON p.id=pa.post_id AND p.blog_id=b.id AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())
      WHERE a.status <> 'rejected' AND ba.status='active' AND b.status='verified'
      GROUP BY a.id,a.display_name,b.slug,b.name ORDER BY a.display_name,b.slug LIMIT 200`),
    pool.query(`SELECT ${blogFields} FROM blogs b ${latestJoin} WHERE b.status='verified' ORDER BY postCount DESC,b.name LIMIT 200`),
    pool.query(`SELECT (SELECT COUNT(*) FROM blogs WHERE status='verified') AS blogs,
      (SELECT COUNT(*) FROM posts p JOIN blogs b ON b.id=p.blog_id WHERE b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())) AS posts,
      (SELECT MAX(last_crawl_success_at) FROM blogs WHERE status='verified') AS updatedAt`),
    pool.query(`SELECT ${blogFields} FROM blogs b ${latestJoin} WHERE b.status='verified' AND latest.published_at IS NOT NULL
      ORDER BY latest.published_at DESC,latest.id DESC,b.id LIMIT 20`),
  ]);
  const icons = await iconManifest();
  const row = totalRows[0][0];
  return {
    generatedAt: new Date().toISOString(),
    cacheSeconds: 0,
    posts: postRows[0].map(publicPost),
    tags: tagRows[0],
    authors: authorRows[0],
    blogs: blogRows[0].map((blog) => blogDto(blog, icons)),
    recentBlogs: recentRows[0].map((blog) => blogDto(blog, icons)),
    totals: { blogs: Number(row.blogs), posts: Number(row.posts) },
    updatedAt: row.updatedAt,
  };
}
