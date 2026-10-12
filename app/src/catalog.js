/** Complete directory projection. Overview is deliberately a bounded homepage feed. */
const categoryLabel = "COALESCE(NULLIF(b.category,''),'未分類')";
const statusLabel = "COALESCE(NULLIF(b.status_label,''),'待核對')";
const sortColumns = {
  name: 'b.name',
  category: categoryLabel,
  posts: 'postCount',
  latest: 'b.last_published_at',
  crawl: 'b.last_crawl_success_at',
  status: statusLabel,
};
const text = (value, length) => (typeof value === 'string' ? Array.from(value.trim()).slice(0, length).join('') : '');
const integer = (value, fallback) => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(1, number) : Number.MAX_SAFE_INTEGER;
};
export function catalogFilters(query = {}) {
  const sort = typeof query.sort === 'string' && Object.hasOwn(sortColumns, query.sort) ? query.sort : 'name';
  return {
    q: text(query.q, 100),
    category: text(query.category, 255),
    status: text(query.status, 64),
    sort,
    dir: ['asc', 'desc'].includes(query.dir) ? query.dir : ['name', 'category', 'status'].includes(sort) ? 'asc' : 'desc',
    page: integer(query.page, 1),
    limit: Math.min(200, integer(query.limit, 50)),
  };
}
export async function loadCatalog(pool, query = {}) {
  const filters = catalogFilters(query);
  const where = ["b.status <> 'moved'"];
  const parameters = [];
  if (filters.q) {
    // Explicit escape character makes percent, underscore and '=' literal search text.
    const pattern = `%${filters.q.toLowerCase().replace(/[=%_]/g, '=$&')}%`;
    where.push("(LOWER(b.name) LIKE ? ESCAPE '=' OR LOWER(b.url) LIKE ? ESCAPE '=')");
    parameters.push(pattern, pattern);
  }
  if (filters.category) {
    where.push(`${categoryLabel}=?`);
    parameters.push(filters.category);
  }
  if (filters.status) {
    where.push(`${statusLabel}=?`);
    parameters.push(filters.status);
  }
  const condition = where.join(' AND ');
  // Facets and summary cards describe the full catalog, independent of page and filters.
  const [totalsResult, categoriesResult, statusesResult, countResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS blogs,COALESCE(SUM(b.url IS NOT NULL AND b.url<>''),0) AS withUrls,
      MAX(b.last_crawl_success_at) AS updatedAt,
      (SELECT COUNT(*) FROM posts p JOIN blogs pb ON pb.id=p.blog_id WHERE pb.status <> 'moved') AS posts,
      (SELECT COUNT(DISTINCT a.id) FROM authors a JOIN blog_authors ba ON ba.author_id=a.id
        JOIN blogs ab ON ab.id=ba.blog_id WHERE a.status <> 'rejected' AND ba.status='active' AND ab.status <> 'moved') AS authors
      FROM blogs b WHERE b.status <> 'moved'`),
    pool.query(
      `SELECT ${categoryLabel} AS value,COUNT(*) AS count FROM blogs b WHERE b.status <> 'moved' GROUP BY ${categoryLabel} ORDER BY value`,
    ),
    pool.query(
      `SELECT ${statusLabel} AS value,COUNT(*) AS count FROM blogs b WHERE b.status <> 'moved' GROUP BY ${statusLabel} ORDER BY value`,
    ),
    pool.query(`SELECT COUNT(*) AS total FROM blogs b WHERE ${condition}`, parameters),
  ]);
  const total = Number(countResult[0][0].total);
  const pages = Math.max(1, Math.ceil(total / filters.limit));
  const page = Math.min(filters.page, pages);
  const [blogs] = await pool.query(
    `SELECT b.id,b.slug,b.name,b.url,${categoryLabel} AS category,${statusLabel} AS statusLabel,
      b.last_crawl_success_at AS lastCrawlSuccessAt,b.last_published_at AS lastPublishedAt,
      b.expected_interval_hours AS expectedIntervalHours,
      (SELECT COUNT(*) FROM posts p WHERE p.blog_id=b.id) AS postCount
      FROM blogs b WHERE ${condition} ORDER BY ${sortColumns[filters.sort]} ${filters.dir.toUpperCase()},b.id ASC LIMIT ? OFFSET ?`,
    [...parameters, filters.limit, (page - 1) * filters.limit],
  );
  const totals = totalsResult[0][0];
  const facets = (rows) => rows.map((row) => ({ value: row.value, count: Number(row.count) }));
  return {
    blogs: blogs.map((blog) => ({ ...blog, postCount: Number(blog.postCount) })),
    totals: {
      blogs: Number(totals.blogs),
      posts: Number(totals.posts),
      withUrls: Number(totals.withUrls),
      authors: Number(totals.authors),
    },
    updatedAt: totals.updatedAt,
    categories: facets(categoriesResult[0]),
    statuses: facets(statusesResult[0]),
    pagination: { page, pages, pageSize: filters.limit, total },
    filters: { ...filters, page },
  };
}
