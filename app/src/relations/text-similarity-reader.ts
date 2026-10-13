import { createHash } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { publicSummary } from '../public-post.ts';
import { publicationHome } from './identity.ts';
import {
  compareSimilarityText,
  type SimilaritySelection,
  TEXT_SIMILARITY_LIMITS,
  TEXT_SIMILARITY_VERSION,
  textSimilaritySelection,
} from './text-similarity.ts';

const admissions = new WeakMap<Pool, number>();
const unavailable = () => Error('text_similarity_unavailable');
async function boundedRead<T>(
  pool: Pool,
  work: (query: (sql: string, values: unknown[]) => Promise<RowDataPacket[]>) => Promise<T>,
): Promise<T> {
  const active = admissions.get(pool) ?? 0;
  if (active >= 2) throw unavailable();
  admissions.set(pool, active + 1);
  let connection: PoolConnection | undefined,
    expired = false,
    destroyed = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  const destroy = () => {
    if (connection && !destroyed) {
      destroyed = true;
      connection.destroy();
    }
  };
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      destroy();
      reject(unavailable());
    }, 1500);
  });
  const run = async () => {
    try {
      connection = await pool.getConnection();
      if (expired) {
        destroy();
        throw unavailable();
      }
      return await work(async (sql, values) => {
        if (expired) throw unavailable();
        const [rows] = await connection!.query<RowDataPacket[]>({
          sql: 'SET STATEMENT max_statement_time=0.25 FOR ' + sql,
          values,
          timeout: 500,
        });
        if (expired) throw unavailable();
        return rows;
      });
    } catch {
      destroy();
      throw unavailable();
    } finally {
      if (connection && !destroyed) connection.release();
      admissions.set(pool, (admissions.get(pool) ?? 1) - 1);
    }
  };
  try {
    return await Promise.race([run(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function owner(source: string, home: string) {
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
      !!publicationHome(home) &&
      publicationHome(source) === publicationHome(home) &&
      (!path || s.pathname === path || s.pathname.startsWith(`${path}/`))
    );
  } catch {
    return false;
  }
}
const iso = (v: unknown) => (v instanceof Date && Number.isFinite(v.getTime()) ? v.toISOString() : null);
const selectionSql = `FROM posts p JOIN blogs b ON b.id=p.blog_id JOIN content_post_bodies c ON c.post_id=p.id
 WHERE p.id IN (?) AND b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())
 AND c.status='ok' AND c.blog_id=p.blog_id AND c.obtained_at<=UTC_TIMESTAMP() LIMIT ${TEXT_SIMILARITY_LIMITS.articles}`;
const provenance = `p.id,p.blog_id blogId,p.url,p.title,LEFT(p.summary,4000) summary,p.published_at publishedAt,b.url blogUrl,c.source_url sourceUrl,c.article_url articleUrl,c.content_hash contentHash,c.obtained_at observedAt`;
type Body = { row: RowDataPacket; text: string; textHash: string };
/** No native caller, table, cache, worker or implicit pairing. Root must opt in with exact enabled:true. */
export async function loadTextSimilarity(pool: Pool, input: SimilaritySelection, options: { enabled?: boolean; now?: Date } = {}) {
  if (options.enabled !== true) return { status: 'not-enabled' as const };
  const ids = textSimilaritySelection(input),
    now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw unavailable();
  return boundedRead(pool, async (query) => {
    const rows = await query(
      `SELECT ${provenance},SUBSTRING(CAST(c.body_text AS BINARY),1,${TEXT_SIMILARITY_LIMITS.rawBytes + 1}) bodyBytes ${selectionSql}`,
      [ids],
    );
    const bodies = new Map<number, Body>(),
      issues = new Map<number, string>();
    for (const row of rows) {
      const id = Number(row.id);
      if (
        !ids.includes(id) ||
        !iso(row.observedAt) ||
        (row.publishedAt !== null && !iso(row.publishedAt)) ||
        !/^[a-f0-9]{64}$/.test(row.contentHash ?? '') ||
        ![row.url, row.sourceUrl, row.articleUrl].every((url) => owner(url, row.blogUrl))
      ) {
        issues.set(id, 'evidence-unavailable');
        continue;
      }
      const bytes = Buffer.isBuffer(row.bodyBytes) ? row.bodyBytes : Buffer.from(row.bodyBytes ?? '', 'utf8');
      if (bytes.length > TEXT_SIMILARITY_LIMITS.rawBytes) {
        issues.set(id, 'overcap');
        continue;
      }
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        issues.set(id, 'invalid-utf8');
        continue;
      }
      bodies.set(id, { row, text, textHash: hash(bytes) });
    }
    // One current-read recheck, over the same <=10 explicit IDs. Hash only the bounded raw prefix, never the full body.
    const current = await query(
      `SELECT ${provenance},SHA2(SUBSTRING(CAST(c.body_text AS BINARY),1,${TEXT_SIMILARITY_LIMITS.rawBytes + 1}),256) bodyTextHash ${selectionSql}`,
      [ids],
    );
    const fresh = new Map(current.map((row) => [Number(row.id), row]));
    const projected = (body: Body) => ({
      articleId: Number(body.row.id),
      url: body.row.url,
      title: publicSummary(body.row.title, 160),
      publishedAt: iso(body.row.publishedAt),
      observedAt: iso(body.row.observedAt),
      contextSource: 'post-summary' as const,
      previewSource: 'post-summary' as const,
      comparedContextSource: 'body-prefix' as const,
      excerpt: publicSummary(body.row.summary, TEXT_SIMILARITY_LIMITS.excerptCodepoints),
    });
    const valid = (body: Body | undefined) => {
      if (!body) return false;
      const next = fresh.get(Number(body.row.id));
      return (
        !!next &&
        next.bodyTextHash === body.textHash &&
        next.contentHash === body.row.contentHash &&
        ['title', 'summary', 'url', 'blogUrl', 'sourceUrl', 'articleUrl', 'blogId'].every((key) => next[key] === body.row[key]) &&
        iso(next.observedAt) === iso(body.row.observedAt) &&
        iso(next.publishedAt) === iso(body.row.publishedAt) &&
        [next.url, next.sourceUrl, next.articleUrl].every((url) => owner(url, next.blogUrl))
      );
    };
    const items = input.pairs.map((pair) => {
      const source = bodies.get(pair.sourceArticleId),
        target = bodies.get(pair.targetArticleId);
      if (!valid(source) || !valid(target) || (input.sourceBlogId !== undefined && Number(source!.row.blogId) !== input.sourceBlogId))
        return {
          sourceArticleId: pair.sourceArticleId,
          targetArticleId: pair.targetArticleId,
          status: 'unavailable' as const,
          lexicalSimilarity: null,
          reason: issues.get(pair.sourceArticleId) ?? issues.get(pair.targetArticleId) ?? 'stale-or-unavailable',
        };
      if (Number(source!.row.blogId) === Number(target!.row.blogId))
        return {
          sourceArticleId: pair.sourceArticleId,
          targetArticleId: pair.targetArticleId,
          status: 'unavailable' as const,
          lexicalSimilarity: null,
          reason: 'same-publication',
        };
      const score = compareSimilarityText(source!.text, target!.text);
      return {
        sourceArticleId: pair.sourceArticleId,
        targetArticleId: pair.targetArticleId,
        status: score.status,
        lexicalSimilarity: score.lexicalSimilarity,
        matchVersion: TEXT_SIMILARITY_VERSION,
        method: 'set-sorensen-dice-trigram',
        scope: 'normalized-body-prefix-only',
        exhaustive: false,
        source: {
          ...projected(source!),
          ...('source' in score
            ? { prefixCodepoints: score.source.prefixCodepoints, uniqueGrams: score.source.uniqueGrams, truncated: score.source.truncated }
            : {}),
        },
        target: {
          ...projected(target!),
          ...('target' in score
            ? { prefixCodepoints: score.target.prefixCodepoints, uniqueGrams: score.target.uniqueGrams, truncated: score.target.truncated }
            : {}),
        },
        observedAt: new Date(Math.max(source!.row.observedAt.getTime(), target!.row.observedAt.getTime())).toISOString(),
        analysedAt: now.toISOString(),
      };
    });
    return {
      status: 'ready' as const,
      matchVersion: TEXT_SIMILARITY_VERSION,
      scope: 'explicit-pairs-only',
      exhaustive: false,
      notCitation: true,
      notSemanticSimilarity: true,
      items,
    };
  });
}
