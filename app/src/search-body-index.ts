import { createHash } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { publicPost, publicSummary } from './public-post.ts';
import { publicationHome } from './relations/identity.ts';
import { boundedSearchStatement, CURRENT_BODY_SQL, PUBLIC_SEARCH_SQL } from './search-bounds.ts';

export const BODY_INDEX_VERSION = 'nfkc-lower-trigram-prefix-v1';
export const BODY_INDEX_CHARACTERS = 4096;
export const BODY_INDEX_BYTES = 64 * 1024;
export const BODY_INDEX_CANDIDATES = 200;
export const normalizeBodySearch = (text: string) => text.normalize('NFKC').toLowerCase();
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
export function bodySearchText(text: string) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > BODY_INDEX_BYTES || /\p{Cs}/u.test(text))
    return { status: 'overcap' as const };
  const characters = Array.from(normalizeBodySearch(text));
  const prefix = characters.slice(0, BODY_INDEX_CHARACTERS);
  return {
    status: 'ready' as const,
    textHash: sha(text),
    normalizedPrefix: prefix.join(''),
    prefixCharacters: prefix.length,
    truncated: characters.length > prefix.length,
  };
}
export function buildBodySearchIndex(text: string) {
  const built = bodySearchText(text);
  if (built.status !== 'ready') return built;
  const prefix = Array.from(built.normalizedPrefix),
    grams = new Set<string>();
  for (let i = 0; i + 2 < prefix.length; i++) grams.add(sha(prefix.slice(i, i + 3).join('')));
  return { ...built, grams: [...grams] };
}
export function bodySearchOwner(source: string, home: string) {
  try {
    const s = new URL(source),
      b = new URL(home),
      path = b.pathname.replace(/\/$/, '');
    return (
      !s.username &&
      !s.password &&
      !b.username &&
      !b.password &&
      s.origin === b.origin &&
      publicationHome(source) === publicationHome(home) &&
      !!publicationHome(home) &&
      (!path || s.pathname === path || s.pathname.startsWith(`${path}/`))
    );
  } catch {
    return false;
  }
}
export async function loadIndexedBodySearch(pool: Pool, q: string, blog = '') {
  const normalized = normalizeBodySearch(q),
    characters = Array.from(normalized);
  const coverage = {
    status: characters.length < 3 ? 'short-query' : 'partial',
    indexVersion: BODY_INDEX_VERSION,
    normalization: 'NFKC-then-lowercase',
    scope: 'indexed-prefix-only',
    prefixCodepoints: BODY_INDEX_CHARACTERS,
    rawBodyByteLimit: BODY_INDEX_BYTES,
    candidateLimit: BODY_INDEX_CANDIDATES,
    candidates: 0,
    candidateTruncated: false,
    staleOrIneligible: 0,
    invalidUtf8: 0,
    overcap: 0,
    prefixTruncatedCandidates: 0,
    unindexed: 'unknown',
    exhaustive: false,
  };
  if (characters.length < 3) return { items: [], coverage };
  // Index range only: no body LIKE, COUNT/GROUP scan or JSON/full body retrieval here.
  let candidates: RowDataPacket[];
  try {
    [candidates] = await pool.query<RowDataPacket[]>(
      boundedSearchStatement(
        `SELECT i.post_id FROM post_body_search_terms i STRAIGHT_JOIN posts p ON p.id=i.post_id STRAIGHT_JOIN blogs b ON b.id=p.blog_id WHERE i.gram_hash=? AND i.index_version=? AND ${PUBLIC_SEARCH_SQL} ${blog ? 'AND b.slug=?' : ''} ORDER BY i.post_id DESC LIMIT ${BODY_INDEX_CANDIDATES + 1}`,
        true,
      ),
      [sha(characters.slice(0, 3).join('')), BODY_INDEX_VERSION, ...(blog ? [blog] : [])],
    );
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_NO_SUCH_TABLE') return { items: [], coverage: { ...coverage, status: 'unavailable' } };
    throw error;
  }
  coverage.candidateTruncated = candidates.length > BODY_INDEX_CANDIDATES;
  const ids = candidates
    .slice(0, BODY_INDEX_CANDIDATES)
    .map((r) => Number(r.post_id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  coverage.candidates = ids.length;
  if (!ids.length) return { items: [], coverage };
  // Explicit bounded ID set precedes expensive normalization/hash verification in JavaScript.
  const [rows] = await pool.query<RowDataPacket[]>(
    boundedSearchStatement(
      `SELECT p.id,p.title,p.url,p.guid,p.summary,p.author,p.published_at publishedAt,p.image_url imageUrl,b.slug blogSlug,b.name blogName,
      b.url blogUrl,c.source_url sourceUrl,c.article_url articleUrl,
      SUBSTRING(CAST(c.body_text AS BINARY),1,${BODY_INDEX_BYTES + 1}) bodyBytes,
      i.body_text_hash bodyTextHash,i.prefix_truncated prefixTruncated
     FROM posts p JOIN blogs b ON b.id=p.blog_id JOIN content_post_bodies c ON c.post_id=p.id
     JOIN post_body_search_terms i ON i.post_id=p.id AND i.gram_hash=? AND i.index_version=? AND i.content_hash=c.content_hash
     WHERE p.id IN (?) AND ${PUBLIC_SEARCH_SQL} AND ${CURRENT_BODY_SQL} AND c.obtained_at<=UTC_TIMESTAMP()
     ${blog ? 'AND b.slug=?' : ''} ORDER BY p.id DESC LIMIT ${BODY_INDEX_CANDIDATES}`,
      true,
    ),
    [sha(characters.slice(0, 3).join('')), BODY_INDEX_VERSION, ids, ...(blog ? [blog] : [])],
  );
  coverage.staleOrIneligible = ids.length - rows.length;
  const items = [];
  for (const row of rows) {
    if (
      !bodySearchOwner(row.sourceUrl, row.blogUrl) ||
      !bodySearchOwner(row.articleUrl, row.blogUrl) ||
      !bodySearchOwner(row.url, row.blogUrl)
    ) {
      coverage.staleOrIneligible++;
      continue;
    }
    const bytes = Buffer.isBuffer(row.bodyBytes) ? row.bodyBytes : Buffer.from(row.bodyBytes ?? '', 'utf8');
    if (bytes.length > BODY_INDEX_BYTES) {
      coverage.overcap++;
      continue;
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      coverage.invalidUtf8++;
      continue;
    }
    const built = bodySearchText(text);
    if (built.status !== 'ready' || built.textHash !== row.bodyTextHash) {
      coverage.staleOrIneligible++;
      continue;
    }
    if (built.truncated) coverage.prefixTruncatedCandidates++;
    // Same normalization as the index. No MariaDB accent/case collation promise or false LIKE equivalence.
    const offset = built.normalizedPrefix.indexOf(normalized);
    if (offset < 0) continue;
    items.push({
      ...publicPost(row),
      articleId: row.id,
      snippet: publicSummary(built.normalizedPrefix.slice(Math.max(0, offset - 80), offset + 620), 240),
      matchSource: 'body',
      contextSource: 'body',
      matchVersion: BODY_INDEX_VERSION,
      snippetNormalization: 'NFKC-then-lowercase',
    });
  }
  return { items, coverage };
}
