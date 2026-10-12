import { catalogFilters } from './catalog.js';

const publicRelations = `FROM authors a JOIN blog_authors ba ON ba.author_id=a.id JOIN blogs b ON b.id=ba.blog_id
  WHERE a.status <> 'rejected' AND ba.status='active' AND b.status='verified'`;
export function authorCatalogFilters(query = {}) {
  const { page, limit } = catalogFilters(query);
  if (query.author === undefined) return { author: null, page, limit };
  if (
    typeof query.author !== 'string' ||
    !/^[1-9]\d*$/.test(query.author) ||
    !Number.isSafeInteger(Number(query.author)) ||
    Number(query.author) > 2147483647
  )
    throw Object.assign(new Error('invalid author id'), { code: 'INVALID_AUTHOR' });
  return { author: Number(query.author), page, limit };
}
/** A row is an author/publication relationship, not a unique person. Never group by pen name. */
export async function loadAuthorCatalog(pool, query = {}) {
  const filters = authorCatalogFilters(query);
  const condition = publicRelations + (filters.author === null ? '' : ' AND a.id=?');
  const parameters = filters.author === null ? [] : [filters.author];
  const [totalResult, matchedResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS relationships,COUNT(DISTINCT a.id) AS authors ${publicRelations}`),
    pool.query(`SELECT COUNT(*) AS relationships,COUNT(DISTINCT a.id) AS authors ${condition}`, parameters),
  ]);
  const total = Number(matchedResult[0][0].relationships);
  const pages = Math.max(1, Math.ceil(total / filters.limit));
  const page = Math.min(filters.page, pages);
  const [authors] = await pool.query(
    `SELECT a.id,a.display_name AS displayName,b.slug AS blogSlug,b.name AS blogName,
      (SELECT COUNT(DISTINCT p.id) FROM post_authors pa JOIN posts p ON p.id=pa.post_id
        WHERE pa.author_id=a.id AND pa.status='active' AND p.blog_id=b.id) AS postCount
      ${condition} ORDER BY a.display_name,b.name,a.id,b.id LIMIT ? OFFSET ?`,
    [...parameters, filters.limit, (page - 1) * filters.limit],
  );
  return {
    authors: authors.map((author) => ({ ...author, postCount: Number(author.postCount) })),
    totals: { authors: Number(totalResult[0][0].authors), relationships: Number(totalResult[0][0].relationships) },
    matchedAuthors: Number(matchedResult[0][0].authors),
    pagination: { page, pages, pageSize: filters.limit, total },
    filters: { ...filters, page },
  };
}
