/** Private MariaDB FULLTEXT index of encoded Unicode bigrams. No provider/network calls.
 * FULLTEXT finds IDs only; every response rereads current public ownership and evidence.
 */
import { createHash } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { publicPost, publicSummary } from './public-post.ts';
import { bodySearchOwner, bodySearchSameArticle } from './search-body-index.ts';
import { PUBLIC_SEARCH_SQL } from './search-bounds.ts';

export const FULLTEXT_VERSION = 'nfkc-bigram-whole-body-v1';
export const FULLTEXT_BYTES = 128 * 1024;
export const FULLTEXT_CANDIDATES = 200;
export const FULLTEXT_TIMEOUT_MS = 1000;
export const normalizeFulltext = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const fulltextStatement = (sql: string) => `SET STATEMENT max_statement_time=${FULLTEXT_TIMEOUT_MS / 1000} FOR ${sql}`;
/** Fixed-width ASCII tokens evade stopwords, punctuation and the server's CJK word parser.
 * A code point fits four base36 digits; tokens are always nine letters/digits.
 */
export function fulltextTokens(text: string): string[] {
  const chars = Array.from(normalizeFulltext(text));
  const terms = new Set<string>();
  for (let i = 0; i + 1 < chars.length; i++)
    terms.add('x' + chars[i].codePointAt(0)!.toString(36).padStart(4, '0') + chars[i + 1].codePointAt(0)!.toString(36).padStart(4, '0'));
  return [...terms];
}
export function fulltextMetadata(row: RowDataPacket): [string, string, string] {
  return [String(row.title ?? ''), String(row.summary ?? '').slice(0, 2000), String(row.blogName ?? '')];
}
export function currentSearchBody(row: RowDataPacket): string | null {
  if (
    row.bodyStatus !== 'ok' ||
    Number(row.bodyBlogId) !== Number(row.blogId) ||
    !row.obtainedAt ||
    new Date(row.obtainedAt).getTime() > Date.now()
  )
    return null;
  if (
    ![row.sourceUrl, row.articleUrl, row.url].every((url) => bodySearchOwner(url, row.blogUrl)) ||
    !bodySearchSameArticle(row.articleUrl, row.url)
  )
    return null;
  const bytes = Buffer.isBuffer(row.bodyBytes) ? row.bodyBytes : Buffer.from(row.bodyBytes ?? '', 'utf8');
  if (bytes.length > FULLTEXT_BYTES) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
export const fulltextColumns = `p.id,p.blog_id blogId,p.title,p.url,p.guid,LEFT(p.summary,2000) summary,p.author,p.published_at publishedAt,p.image_url imageUrl,
  b.slug blogSlug,b.name blogName,b.url blogUrl,c.blog_id bodyBlogId,c.status bodyStatus,c.source_url sourceUrl,c.article_url articleUrl,c.obtained_at obtainedAt,
  SUBSTRING(CAST(c.body_text AS BINARY),1,${FULLTEXT_BYTES + 1}) bodyBytes`;

export async function indexFulltextPosts(pool: Pool, ids: number[]) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 100 ||
    ids.some((id) => !Number.isSafeInteger(id) || id < 1) ||
    new Set(ids).size !== ids.length
  )
    throw Error('invalid_fulltext_batch');
  const [rows] = await pool.query<RowDataPacket[]>(
    fulltextStatement(`SELECT ${fulltextColumns},i.metadata_hash oldMetadataHash,i.body_hash oldBodyHash,i.index_version oldVersion FROM posts p JOIN blogs b ON b.id=p.blog_id
    LEFT JOIN content_post_bodies c ON c.post_id=p.id LEFT JOIN post_search_documents i ON i.post_id=p.id WHERE p.id IN (?) AND ${PUBLIC_SEARCH_SQL}`),
    [ids],
  );
  const result = [];
  for (const row of rows) {
    const metadata = fulltextMetadata(row),
      body = currentSearchBody(row);
    const metadataHash = hash(JSON.stringify(metadata)),
      bodyHash = body === null ? null : hash(body);
    if (row.oldVersion === FULLTEXT_VERSION && row.oldMetadataHash === metadataHash && row.oldBodyHash === bodyHash) {
      result.push({ postId: Number(row.id), body: body !== null, unchanged: true });
      continue;
    }
    const terms = new Set(metadata.flatMap(fulltextTokens));
    if (body !== null) for (const token of fulltextTokens(body)) terms.add(token);
    await pool.query(
      fulltextStatement(`INSERT INTO post_search_documents(post_id,index_version,metadata_hash,body_hash,tokens,indexed_at)
      VALUES(?,?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE index_version=VALUES(index_version),metadata_hash=VALUES(metadata_hash),body_hash=VALUES(body_hash),tokens=VALUES(tokens),indexed_at=VALUES(indexed_at)`),
      [row.id, FULLTEXT_VERSION, metadataHash, bodyHash, [...terms].join(' ')],
    );
    result.push({ postId: Number(row.id), body: body !== null, tokens: terms.size });
  }
  const missing = ids.filter((id) => !rows.some((row) => Number(row.id) === id));
  if (missing.length) await pool.query(fulltextStatement('DELETE FROM post_search_documents WHERE post_id IN (?)'), [missing]);
  // Index bytes may outlive withdrawal. Readers always apply current public SQL and hash checks.
  return result;
}

/** Keyset backfill, one caller/worker, bounded batches. Commits each document; reruns are idempotent.
 * A cyclic reconciliation catches old title/body changes even if their timestamps were not updated.
 */
export async function runFulltextBatch(pool: Pool, options: { after?: number; limit?: number; signal?: AbortSignal } = {}) {
  const after = options.after ?? 0,
    limit = options.limit ?? 50;
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw Error('invalid_fulltext_batch');
  const [rows] = await pool.query<RowDataPacket[]>(
    fulltextStatement(`SELECT p.id FROM posts p JOIN blogs b ON b.id=p.blog_id
    WHERE p.id>? ORDER BY p.id LIMIT ?`),
    [after, limit],
  );
  if (options.signal?.aborted) return { next: after, done: false, items: [] };
  const items = rows.length
    ? await indexFulltextPosts(
        pool,
        rows.map((row) => Number(row.id)),
      )
    : [];
  return { next: rows.length ? Number(rows.at(-1)!.id) : 0, done: !rows.length, items };
}

/** Validated matches and how many matched only in a body, for search_usage_daily (search-usage.ts); not public. */
export const matchedCounts = (items: { matchSource?: unknown }[]) => ({
  total: items.length,
  body: items.filter((item) => item.matchSource === 'body').length,
});

export async function loadFulltextSearch(pool: Pool, filters: { q: string; page: number; limit: number; blog: string }) {
  const q = normalizeFulltext(filters.q),
    tokens = fulltextTokens(q);
  const coverage = {
    type: 'historical-indexed-metadata-and-whole-body',
    limit: FULLTEXT_CANDIDATES,
    scannedPosts: 0,
    truncated: null as boolean | null,
    metadata: { scope: 'all-indexed-public-posts', fields: ['title', 'summary', 'blog-name'], exhaustive: false },
    historicalBody: {
      status: 'indexed',
      indexVersion: FULLTEXT_VERSION,
      normalization: 'NFKC-lowercase-whitespace',
      scope: 'whole-collected-body',
      rawBodyByteLimit: FULLTEXT_BYTES,
      candidateLimit: FULLTEXT_CANDIDATES,
      candidates: 0,
      candidateTruncated: null as boolean | null,

      unindexed: 'unknown',
      exhaustive: false,
    },
    statementTimeoutMs: FULLTEXT_TIMEOUT_MS,
    maximumStatements: 2,
  };
  if (!tokens.length)
    return {
      items: [],
      pagination: { page: filters.page, pageSize: filters.limit, hasMore: false },
      coverage: { ...coverage, historicalBody: { ...coverage.historicalBody, status: 'short-query' } },
      matched: { total: 0, body: 0 },
    };
  const selectedTokens =
    tokens.length <= 16 ? tokens : Array.from({ length: 16 }, (_, n) => tokens[Math.floor((n * (tokens.length - 1)) / 15)]);
  const expression = selectedTokens.map((token) => '+' + token).join(' ');
  const [candidates] = await pool.query<RowDataPacket[]>(
    fulltextStatement(`SELECT i.post_id FROM post_search_documents i
    JOIN posts p ON p.id=i.post_id JOIN blogs b ON b.id=p.blog_id
    WHERE MATCH(i.tokens) AGAINST (? IN BOOLEAN MODE) AND i.index_version=? AND ${PUBLIC_SEARCH_SQL}
    ${filters.blog ? 'AND b.slug=?' : ''} ORDER BY i.post_id DESC LIMIT ${FULLTEXT_CANDIDATES + 1}`),
    [expression, FULLTEXT_VERSION, ...(filters.blog ? [filters.blog] : [])],
  );
  const ids = candidates.slice(0, FULLTEXT_CANDIDATES).map((row) => Number(row.post_id));

  const items = [];
  if (ids.length) {
    // A fresh read, no shared promise/cache or old transaction snapshot. Withdrawal committed before this read is excluded.
    const [rows] = await pool.query<RowDataPacket[]>(
      fulltextStatement(`SELECT ${fulltextColumns},i.metadata_hash metadataHash,i.body_hash bodyHash,i.indexed_at indexedAt
      FROM posts p JOIN blogs b ON b.id=p.blog_id JOIN post_search_documents i ON i.post_id=p.id
      LEFT JOIN content_post_bodies c ON c.post_id=p.id WHERE p.id IN (?) AND ${PUBLIC_SEARCH_SQL} AND i.index_version=?
      ${filters.blog ? 'AND b.slug=?' : ''} ORDER BY p.id DESC`),
      [ids, FULLTEXT_VERSION, ...(filters.blog ? [filters.blog] : [])],
    );

    for (const row of rows) {
      const metadata = fulltextMetadata(row),
        body = currentSearchBody(row);
      const metaValid = hash(JSON.stringify(metadata)) === row.metadataHash;
      const bodyValid = body !== null && hash(body) === row.bodyHash;
      const match = metaValid ? metadata.findIndex((text) => normalizeFulltext(text).includes(q)) : -1;
      const text = match >= 0 ? metadata[match] : bodyValid && normalizeFulltext(body!).includes(q) ? body! : null;
      if (text === null) {
        continue;
      }
      const normalized = normalizeFulltext(text),
        offset = normalized.indexOf(q);
      items.push({
        ...publicPost(row),
        articleId: Number(row.id),
        snippet: publicSummary(normalized.slice(Math.max(0, offset - 80), offset + 620), 240),
        matchSource: match >= 0 ? 'metadata' : 'body',
        contextSource: match >= 0 ? ['title', 'summary', 'blog-name'][match] : 'body',
        matchVersion: FULLTEXT_VERSION,
        snippetNormalization: 'NFKC-lowercase-whitespace',
        indexedAt: row.indexedAt,
      });
    }
  }
  // Public counts cover only currently validated results, never stale/private postings.
  coverage.scannedPosts = coverage.historicalBody.candidates = items.length;
  const start = (filters.page - 1) * filters.limit;
  return {
    items: items.slice(start, start + filters.limit),
    pagination: { page: filters.page, pageSize: filters.limit, hasMore: items.length > start + filters.limit },
    coverage,
    matched: matchedCounts(items),
  };
}

/** Keyset scan of newly ingested IDs, no repeated full-table anti-join. */
export async function indexMissingFulltextPosts(pool: Pool, after = 0, limit = 50) {
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw Error('invalid_fulltext_batch');
  const [rows] = await pool.query<RowDataPacket[]>(fulltextStatement('SELECT p.id FROM posts p WHERE p.id>? ORDER BY p.id LIMIT ?'), [
    after,
    limit,
  ]);
  const items = rows.length
    ? await indexFulltextPosts(
        pool,
        rows.map((row) => Number(row.id)),
      )
    : [];
  return { next: rows.length ? Number(rows.at(-1)!.id) : after, items };
}
