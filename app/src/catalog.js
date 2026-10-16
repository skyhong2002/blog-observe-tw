import { iconManifest } from './v1/favicon-routes.ts';
import { iconUrl } from './v1/icons.ts';

/** Complete directory projection. Overview is deliberately a bounded homepage feed. */
const categoryLabel = "COALESCE(NULLIF(b.category,''),'未分類')";
const statusLabel = "COALESCE(NULLIF(b.status_label,''),'待核對')";
// The newest post already published: feeds sometimes carry far-future dates (a 2115 post), which must neither show
// as the latest article nor sort first. Counts and the latest date use the same not-in-the-future rule.
const latestPublished = '(SELECT MAX(p.published_at) FROM posts p WHERE p.blog_id=b.id AND p.published_at<=UTC_TIMESTAMP())';
const authorCount = `(SELECT COUNT(DISTINCT ba.author_id) FROM blog_authors ba JOIN authors a ON a.id=ba.author_id
  WHERE ba.blog_id=b.id AND ba.status='active' AND a.status<>'rejected')`;
const sortColumns = {
  name: 'b.name',
  category: categoryLabel,
  posts: 'postCount',
  authors: 'authorCount',
  latest: 'lastPublishedAt',
  crawl: 'b.last_crawl_success_at',
  status: statusLabel,
};
/** The directory opens on the most recently updated blogs; a search opens on the best matches. */
const DEFAULT_SORT = 'latest';
const SEARCH_SORT = 'relevance';
/** Search text as tag.observe.tw folds it: NFKC (full-width ＡＢ → AB), lower case, single spaces. */
export const searchText = (value) => value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
/** Up to five space-separated words; each must appear in the blog's name, address, slug, other addresses or description. */
const searchWords = (q) => [...new Set(searchText(q).split(' ').filter(Boolean))].slice(0, 5);
// Explicit escape character makes percent, underscore and '=' literal search text.
const like = (word) => word.replace(/[=%_]/g, '=$&');
const searchFields = `CONCAT_WS(' ',b.name,b.url,b.slug,b.description,
  (SELECT GROUP_CONCAT(u.url SEPARATOR ' ') FROM blog_urls u WHERE u.blog_id=b.id))`;
const text = (value, length) => (typeof value === 'string' ? Array.from(value.trim()).slice(0, length).join('') : '');
const integer = (value, fallback) => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(1, number) : Number.MAX_SAFE_INTEGER;
};
export function catalogFilters(query = {}) {
  const q = text(query.q, 100);
  // An explicit column sort wins; otherwise a search ranks by match and the plain directory by latest article.
  const sort =
    typeof query.sort === 'string' && (Object.hasOwn(sortColumns, query.sort) || (query.sort === SEARCH_SORT && q))
      ? query.sort
      : q
        ? SEARCH_SORT
        : DEFAULT_SORT;
  return {
    q,
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
  const where = ["b.status='verified'"];
  const parameters = [];
  const words = filters.q ? searchWords(filters.q) : [];
  for (const word of words) {
    // utf8mb4_unicode_ci already ignores case; the words are NFKC-folded above.
    where.push(`${searchFields} LIKE ? ESCAPE '='`);
    parameters.push(`%${like(word)}%`);
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
      (SELECT COUNT(*) FROM posts p JOIN blogs pb ON pb.id=p.blog_id WHERE pb.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())) AS posts,
      (SELECT COUNT(DISTINCT a.id) FROM authors a JOIN blog_authors ba ON ba.author_id=a.id
        JOIN blogs ab ON ab.id=ba.blog_id WHERE a.status <> 'rejected' AND ba.status='active' AND ab.status='verified') AS authors
      FROM blogs b WHERE b.status='verified'`),
    pool.query(
      `SELECT ${categoryLabel} AS value,COUNT(*) AS count FROM blogs b WHERE b.status='verified' GROUP BY ${categoryLabel} ORDER BY value`,
    ),
    pool.query(
      `SELECT ${statusLabel} AS value,COUNT(*) AS count FROM blogs b WHERE b.status='verified' GROUP BY ${statusLabel} ORDER BY value`,
    ),
    pool.query(`SELECT COUNT(*) AS total FROM blogs b WHERE ${condition}`, parameters),
  ]);
  const total = Number(countResult[0][0].total);
  const pages = Math.max(1, Math.ceil(total / filters.limit));
  const page = Math.min(filters.page, pages);
  // Relevance: the whole query as the name, then name start, address start, name, address, then the rest
  // (description or an older address); ties go to the blog with more articles.
  const whole = searchText(filters.q);
  const host = "REGEXP_REPLACE(COALESCE(b.url,''),'^https?://(www[.])?','')";
  const relevance = `CASE WHEN b.name=? THEN 0 WHEN b.name LIKE ? ESCAPE '=' THEN 1 WHEN ${host} LIKE ? ESCAPE '=' THEN 2
    WHEN b.name LIKE ? ESCAPE '=' THEN 3 WHEN b.url LIKE ? ESCAPE '=' OR b.slug LIKE ? ESCAPE '=' THEN 4 ELSE 5 END`;
  const ranked = filters.sort === SEARCH_SORT;
  const order = ranked ? `${relevance} ASC,postCount DESC,b.id ASC` : `${sortColumns[filters.sort]} ${filters.dir.toUpperCase()},b.id ASC`;
  const orderParameters = ranked
    ? [whole, `${like(whole)}%`, `${like(whole)}%`, `%${like(whole)}%`, `%${like(whole)}%`, `%${like(whole)}%`]
    : [];
  const [blogs] = await pool.query(
    `SELECT b.id,b.slug,b.name,b.url,${categoryLabel} AS category,${statusLabel} AS statusLabel,
      b.last_crawl_success_at AS lastCrawlSuccessAt,${latestPublished} AS lastPublishedAt,${authorCount} AS authorCount,
      b.expected_interval_hours AS expectedIntervalHours,
      (SELECT COUNT(*) FROM posts p WHERE p.blog_id=b.id AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())) AS postCount
      FROM blogs b WHERE ${condition} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...parameters, ...orderParameters, filters.limit, (page - 1) * filters.limit],
  );
  const icons = await iconManifest();
  const totals = totalsResult[0][0];
  const facets = (rows) => rows.map((row) => ({ value: row.value, count: Number(row.count) }));
  return {
    blogs: blogs.map((blog) => ({
      ...blog,
      iconUrl: iconUrl(blog.slug, icons),
      postCount: Number(blog.postCount),
      authorCount: Number(blog.authorCount),
    })),
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
