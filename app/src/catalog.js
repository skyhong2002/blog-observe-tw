import { genreKey } from './blog-genre-vocabulary.ts';
import { loadShownGenres } from './blog-genres/store.ts';
import { robotsFor, robotsStatuses } from './crawl/robots-observations.ts';
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
/**
 * Who runs the blog, from evidence only (crawl/site-observation.ts and the author rows): 組織 when the homepage
 * says so (編輯部, 公司, 商店…), 個人 when it introduces one person in the first person or the blog has one named
 * author, 多人 at three or more named authors. Everything else — two names (often one person's two spellings),
 * or no names at all — stays 未確認 rather than guessed.
 */
export const SITE_KINDS = ['personal', 'group', 'organization', 'unknown'];
const observed = (column) => `EXISTS(SELECT 1 FROM blog_site_observations o WHERE o.blog_id=b.id AND o.${column}=1)`;
const siteKind = `CASE WHEN ${observed('organization')} THEN 'organization' WHEN ${observed('personal')} THEN 'personal'
  WHEN ${authorCount}>=3 THEN 'group' WHEN ${authorCount}=1 THEN 'personal' ELSE 'unknown' END`;
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
export const NO_GENRE = '-';
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
    // A genre key (blog-genre-vocabulary.ts genreKey), or '-' for blogs no genre is shown for yet.
    genre: query.genre === NO_GENRE ? NO_GENRE : (genreKey(query.genre) ?? ''),
    status: text(query.status, 64),
    kind: SITE_KINDS.includes(query.kind) ? query.kind : '',
    sort,
    dir: ['asc', 'desc'].includes(query.dir) ? query.dir : ['name', 'category', 'status'].includes(sort) ? 'asc' : 'desc',
    page: integer(query.page, 1),
    limit: Math.min(200, integer(query.limit, 50)),
  };
}
/** The WHERE clause of a directory query (filters as catalogFilters returns them); shared with the OPML export. */
async function catalogCondition(pool, filters, { onGenreFailure } = {}) {
  const where = ["b.status='verified'"];
  const parameters = [];
  // Reader and AI genres, several per blog: the directory's 類型 chips and filter (replacing the imported category).
  let genreStatus = 'ready';
  const shown = await loadShownGenres(pool).catch((error) => {
    genreStatus = 'unavailable';
    onGenreFailure?.(error);
    return new Map();
  });
  if (filters.genre && genreStatus === 'ready') {
    const tagged = [...shown.keys()];
    if (filters.genre === NO_GENRE) {
      if (tagged.length) {
        where.push('b.id NOT IN (?)');
        parameters.push(tagged);
      }
    } else {
      const ids = tagged.filter((id) => shown.get(id).some((item) => item.genre === filters.genre));
      where.push(ids.length ? 'b.id IN (?)' : '0=1');
      if (ids.length) parameters.push(ids);
    }
  }
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
  if (filters.kind) {
    where.push(`${siteKind}=?`);
    parameters.push(filters.kind);
  }
  return { condition: where.join(' AND '), parameters, shown, genreStatus };
}

export async function loadCatalog(pool, query = {}, options = {}) {
  const filters = catalogFilters(query);
  const { condition, parameters, shown, genreStatus } = await catalogCondition(pool, filters, options);
  // Facets and summary cards describe the full catalog, independent of page and filters.
  const [totalsResult, categoriesResult, statusesResult, kindsResult, countResult] = await Promise.all([
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
    pool.query(
      `SELECT kind AS value,COUNT(*) AS count FROM (SELECT ${siteKind} AS kind FROM blogs b WHERE b.status='verified') k GROUP BY kind`,
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
      ${siteKind} AS siteKind,b.expected_interval_hours AS expectedIntervalHours,
      (SELECT COUNT(*) FROM posts p WHERE p.blog_id=b.id AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())) AS postCount
      FROM blogs b WHERE ${condition} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...parameters, ...orderParameters, filters.limit, (page - 1) * filters.limit],
  );
  const icons = await iconManifest();
  // The directory still answers when robots reads are unavailable (e.g. before the table's migration).
  const robots = await robotsStatuses(
    pool,
    blogs.map((blog) => blog.url),
  ).catch(() => new Map());
  const totals = totalsResult[0][0];
  const facets = (rows) => rows.map((row) => ({ value: row.value, count: Number(row.count) }));
  // Like the other chips, genre counts describe the whole directory, not the current filters.
  const genreCounts = new Map();
  for (const items of shown.values())
    for (const item of items) genreCounts.set(item.genre, { label: item.label, count: (genreCounts.get(item.genre)?.count ?? 0) + 1 });
  const genres = [...genreCounts]
    .map(([value, { label, count }]) => ({ value, label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hant'));
  return {
    blogs: blogs.map((blog) => ({
      ...blog,
      iconUrl: iconUrl(blog.slug, icons),
      postCount: Number(blog.postCount),
      authorCount: Number(blog.authorCount),
      robots: robotsFor(robots, blog.url),
      genres: (shown.get(Number(blog.id)) ?? []).map((item) => ({ value: item.genre, label: item.label })),
    })),
    totals: {
      blogs: Number(totals.blogs),
      posts: Number(totals.posts),
      withUrls: Number(totals.withUrls),
      authors: Number(totals.authors),
    },
    updatedAt: totals.updatedAt,
    categories: facets(categoriesResult[0]),
    genreStatus,
    genres,
    ungenred: Number(totals.blogs) - shown.size,
    statuses: facets(statusesResult[0]),
    // Fixed order, so the chips do not move as counts change.
    kinds: SITE_KINDS.map((value) => ({ value, count: Number(kindsResult[0].find((row) => row.value === value)?.count ?? 0) })),
    pagination: { page, pages, pageSize: filters.limit, total },
    filters: { ...filters, page },
  };
}

/** Feeds of every blog the directory filters match (no paging; capped), for an OPML export of the filtered list. */
export const OPML_LIMIT = 1000;
export async function loadCatalogFeeds(pool, query = {}) {
  const filters = catalogFilters(query);
  const { condition, parameters, shown } = await catalogCondition(pool, filters);
  // The chip text of the asked genre, for the file's title ('-' is 未分類).
  const genreLabel =
    filters.genre === NO_GENRE
      ? '未分類'
      : ([...shown.values()].flat().find((item) => item.genre === filters.genre)?.label ?? filters.genre);
  // The newest feed that last worked, as /me/opml picks it; blogs without one are left out.
  const [rows] = await pool.query(
    `SELECT b.name,b.url,f.url AS feedUrl,f.type FROM blogs b
      JOIN feed_sources f ON f.id=(SELECT f2.id FROM feed_sources f2 WHERE f2.blog_id=b.id AND f2.type IN ('rss','atom')
        AND f2.last_success_at IS NOT NULL ORDER BY f2.last_success_at DESC,f2.id LIMIT 1)
      WHERE ${condition} ORDER BY b.name,b.id LIMIT ?`,
    [...parameters, OPML_LIMIT],
  );
  return { filters, genreLabel: filters.genre ? genreLabel : '', feeds: rows };
}
