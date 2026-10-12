import type { Pool, RowDataPacket } from 'mysql2/promise';
import { topicBodyHash, topicBodyJoins } from './body.ts';
import { FREQUENCY_POLICY } from './frequency.ts';
import { historyReadsEnabled, type TopicHistory } from './history-contracts.ts';
import { digest, exclusionReason, MATCHER_VERSION, normalizeTerm } from './policy.ts';
import { publicationLabelSql } from './publication-noise.ts';
import { SOURCE } from './snapshot-client.ts';

const hex = /^[a-f0-9]{64}$/;
const iso = (value: unknown): string | null => {
  const d = new Date(value instanceof Date ? value : typeof value === 'string' ? value : NaN);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
export type TopicHistoryDisposition =
  | { status: 'unknown'; reason?: string }
  | { status: 'masked'; canonicalId: string; reason: string }
  | { status: 'gone'; canonicalId: string; label: string; reason: string }
  | { status: 'available'; canonicalId: string; label: string; merged: boolean };
/** Only explicit exclusion is negative. Missing current terms/inactive frequency are not. */
export const historyPublicTopicSql = (alias = 't') => `${publicationLabelSql(`${alias}.label`)}
 AND COALESCE(${alias}.reason,'') NOT IN ('explicit-noise','noise','excluded-term')
 AND NOT EXISTS (SELECT 1 FROM topic_current hc JOIN topic_canonical_terms_v3 ht ON ht.snapshot_id=hc.snapshot_id
 WHERE hc.source=${quote(SOURCE)} AND ht.id=${alias}.canonical_id AND ht.exclusion_reason IS NOT NULL)`;
/** Per-article public historical evidence. Changed hashes are pending, never a negative verdict. */
export const historyEvidenceSql = (scoped: boolean | 'many' = true) => `historical AS (
 SELECT e.canonical_id,p.id post_id,p.blog_id,p.published_at,MAX(e.last_observed_at) observed_at,
 MAX(e.state='confirmed' AND e.matcher_version=${quote(MATCHER_VERSION)} AND e.post_hash IS NOT NULL AND (e.post_hash<=>p.content_hash)
 AND (e.source='title' OR (e.body_hash IS NOT NULL AND (e.body_hash<=>(${topicBodyHash}))))) fresh,
 MAX(e.source='title' AND e.state='confirmed' AND e.matcher_version=${quote(MATCHER_VERSION)} AND e.post_hash IS NOT NULL AND (e.post_hash<=>p.content_hash)) title_hit
 FROM topic_article_evidence e JOIN posts p ON p.id=e.post_id JOIN blogs b ON b.id=p.blog_id ${topicBodyJoins}
 WHERE ${scoped === 'many' ? 'e.canonical_id IN (?) AND ' : scoped ? 'e.canonical_id=? AND ' : ''}e.state IN ('confirmed','pending') AND e.source IN ('title','body')
 AND b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())
 GROUP BY e.canonical_id,p.id,p.blog_id,p.published_at)`;
/** Deliberately uncached: restores and explicit revocations must not be hidden by negative caches. */
export async function topicHistoryDisposition(pool: Pool, key: string): Promise<TopicHistoryDisposition> {
  if (!historyReadsEnabled() || typeof key !== 'string' || key.length > 240) return { status: 'unknown' };
  let id: string | null = hex.test(key) ? key : /^tag:[a-f0-9]{64}$/.test(key) ? key.slice(4) : null;
  if (/^rss:[1-9]\d{0,9}$/.test(key)) {
    const [[tag]] = await pool.query<RowDataPacket[]>("SELECT label FROM tags WHERE id=? AND status='active' AND visibility='public'", [
      key.slice(4),
    ]);
    if (!tag) return { status: 'unknown' };
    id = digest(normalizeTerm(tag.label));
  }
  let first: RowDataPacket | undefined;
  if (id) {
    const [[row]] = await pool.query<RowDataPacket[]>('SELECT * FROM topic_pages WHERE canonical_id=?', [id]);
    first = row;
  }
  if (!first && !key.startsWith('rss:')) {
    const [[registered]] = await pool.query<RowDataPacket[]>("SELECT entity_id FROM public_route_keys WHERE kind='topic' AND route_key=?", [
      key,
    ]);
    if (registered) id = String(registered.entity_id);
    else if (/^tag:[a-f0-9]{64}$/.test(key)) {
      const [[alias]] = await pool.query<RowDataPacket[]>(
        'SELECT a.canonical_id FROM topic_term_aliases_v3 a JOIN topic_current c ON c.snapshot_id=a.snapshot_id AND c.source=? WHERE a.term_id=? LIMIT 1',
        [SOURCE, key.slice(4)],
      );
      id = alias ? String(alias.canonical_id) : null;
    }
  }
  if (!id || !hex.test(id)) return { status: 'unknown' };
  const seen = new Set<string>();
  let merged = false;
  for (let hops = 0; hops < 16; hops++) {
    if (seen.has(id)) return { status: 'unknown', reason: 'merge-cycle' };
    seen.add(id);
    const row: RowDataPacket | undefined =
      first ?? (await pool.query<RowDataPacket[]>('SELECT * FROM topic_pages WHERE canonical_id=?', [id]))[0][0];
    first = undefined;
    if (!row) return { status: 'unknown' };
    if (row.state === 'merged') {
      if (!hex.test(row.merged_into ?? '')) return { status: 'unknown', reason: 'invalid-merge' };
      id = String(row.merged_into);
      merged = true;
      continue;
    }
    const [[current]] = await pool.query<RowDataPacket[]>(
      'SELECT t.exclusion_reason FROM topic_canonical_terms_v3 t JOIN topic_current c ON c.snapshot_id=t.snapshot_id AND c.source=? WHERE t.id=? AND t.exclusion_reason IS NOT NULL LIMIT 1',
      [SOURCE, id],
    );
    const noise = exclusionReason(row.label) ?? current?.exclusion_reason;
    const [[counts]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) total,SUM(e.state<>'revoked' AND p.id IS NOT NULL) retained,
 SUM(e.state<>'revoked' AND p.id IS NOT NULL AND b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())) public_count
 FROM topic_article_evidence e LEFT JOIN posts p ON p.id=e.post_id LEFT JOIN blogs b ON b.id=p.blog_id WHERE e.canonical_id=?`,
      [id],
    );
    if (noise || row.reason === 'excluded-term' || row.reason === 'noise' || row.reason === 'explicit-noise')
      return { status: 'gone', canonicalId: id, label: row.label, reason: noise ?? row.reason };
    if (Number(counts?.total) > 0 && Number(counts?.retained) === 0)
      return { status: 'gone', canonicalId: id, label: row.label, reason: 'evidence-revoked' };
    if (!Number(counts?.total))
      return row.state === 'revoked'
        ? { status: 'gone', canonicalId: id, label: row.label, reason: row.reason ?? 'revoked' }
        : { status: 'unknown' };
    if (!Number(counts.public_count)) return { status: 'masked', canonicalId: id, reason: 'not-public' };
    return { status: 'available', canonicalId: id, label: row.label, merged };
  }
  return { status: 'unknown', reason: 'merge-limit' };
}
export function historyCursor(raw: string | undefined, canonicalId: string): { observedAt: string; postId: number } | null {
  if (!raw) return null;
  try {
    if (typeof raw !== 'string' || raw.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(raw)) throw Error();
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (c.v !== 1 || c.topic !== canonicalId || !Number.isSafeInteger(c.id) || c.id < 1 || typeof c.at !== 'string' || iso(c.at) !== c.at)
      throw Error();
    return { observedAt: c.at, postId: c.id };
  } catch {
    throw Object.assign(Error('invalid_history_cursor'), { statusCode: 400 });
  }
}
export async function readTopicHistory(pool: Pool, id: string, options: { cursor?: string; limit?: number } = {}): Promise<TopicHistory> {
  const empty: TopicHistory = { articles: [], nextCursor: null, confirmed: 0, pending: 0, lastObservedAt: null, total: 0 };
  if (!historyReadsEnabled() || !hex.test(id)) return empty;
  const cursor = historyCursor(options.cursor, id),
    limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 100)));
  const [[counts]] = await pool.query<RowDataPacket[]>(
    `WITH ${historyEvidenceSql()} SELECT COUNT(*) total,SUM(fresh=1) confirmed,SUM(fresh=0) pending,MAX(observed_at) last_observed FROM historical`,
    [id],
  );
  const [rows] = await pool.query<RowDataPacket[]>(
    `WITH ${historyEvidenceSql()}
 SELECT p.id,p.title,p.url,p.published_at publishedAt,b.slug blogSlug,b.name blogName,h.fresh,h.observed_at
 FROM historical h JOIN posts p ON p.id=h.post_id JOIN blogs b ON b.id=h.blog_id
 ${cursor ? 'WHERE (h.observed_at<? OR (h.observed_at=? AND h.post_id<?))' : ''}
 ORDER BY h.observed_at DESC,h.post_id DESC LIMIT ${limit + 1}`,
    [id, ...(cursor ? [new Date(cursor.observedAt), new Date(cursor.observedAt), cursor.postId] : [])],
  );
  const articles = rows.slice(0, limit).map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    url: String(r.url),
    publishedAt: iso(r.publishedAt),
    blogSlug: String(r.blogSlug),
    blogName: String(r.blogName),
    evidenceState: Number(r.fresh) ? ('confirmed' as const) : ('pending' as const),
    observedAt: iso(r.observed_at)!,
  }));
  const last = articles.at(-1);
  return {
    articles,
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ v: 1, topic: id, at: last.observedAt, id: last.id })).toString('base64url')
        : null,
    confirmed: Number(counts.confirmed ?? 0),
    pending: Number(counts.pending ?? 0),
    lastObservedAt: iso(counts.last_observed),
    total: Number(counts.total ?? 0),
  };
}
export const topicGone = () => Object.assign(Error('topic_gone'), { statusCode: 410 });

export async function durableTopicDetail(pool: Pool, key: string, days: number, now = new Date(), cursor?: string) {
  const disposition = await topicHistoryDisposition(pool, key);
  if (disposition.status === 'gone') throw topicGone();
  if (disposition.status !== 'available') return null;
  const id = disposition.canonicalId,
    since = new Date(now.getTime() - days * 86400_000);
  const history = await readTopicHistory(pool, id, { cursor });
  const [[frequency]] = await pool.query<RowDataPacket[]>(
    `SELECT f.high_frequency FROM topic_current tc
     JOIN topic_frequency_runs fr ON fr.snapshot_id=tc.snapshot_id AND fr.policy_version=?
     JOIN topic_term_frequencies f ON f.snapshot_id=fr.snapshot_id AND f.term_id=?
     WHERE tc.source=? LIMIT 1`,
    [FREQUENCY_POLICY.version, id, SOURCE],
  );
  const titleOnly = Number(frequency?.high_frequency) === 1;
  // Historical observations remain available; the current-period list keeps the existing frequency rule.
  const recentRule = titleOnly ? ' AND h.title_hit=1' : '';

  const [blogs] = await pool.query<RowDataPacket[]>(
    `WITH ${historyEvidenceSql()}
 SELECT b.id,b.slug,b.name,COUNT(*) posts,SUM(h.title_hit) titlePosts,SUM(1-h.title_hit) bodyOnlyPosts,
 (4*(1-POW(0.5,SUM(h.title_hit)))+2*POW(0.5,SUM(h.title_hit))*(1-POW(0.5,SUM(1-h.title_hit)))) score
 FROM historical h JOIN blogs b ON b.id=h.blog_id WHERE h.fresh=1 AND h.published_at>=? AND h.published_at<=?${recentRule}
 GROUP BY b.id,b.slug,b.name ORDER BY score DESC,posts DESC,b.id LIMIT 101`,
    [id, since, now],
  );
  const [articles] = await pool.query<RowDataPacket[]>(
    `WITH ${historyEvidenceSql()}
 SELECT p.id,p.title,p.url,p.published_at publishedAt,b.slug blogSlug,b.name blogName FROM historical h
 JOIN posts p ON p.id=h.post_id JOIN blogs b ON b.id=h.blog_id
 WHERE h.fresh=1 AND h.published_at>=? AND h.published_at<=?${recentRule} ORDER BY p.published_at DESC,p.id DESC LIMIT 101`,
    [id, since, now],
  );
  return {
    topic: {
      id: `tag:${id}`,
      canonicalId: `tag:${id}`,
      label: disposition.label,
      source: 'tag-vocabulary',
      excludedReason: null,
      inactiveReason: null,
      matchingStatus: 'active',
      articleCount: history.total,
      lastPublishedAt: null,
      matchingRule: titleOnly ? 'title-only' : 'title-and-body',
      matchingReason: titleOnly ? FREQUENCY_POLICY.reason : null,
    },
    blogs: blogs.slice(0, 100).map((b) => ({
      id: Number(b.id),
      slug: b.slug,
      name: b.name,
      posts: Number(b.posts),
      titlePosts: Number(b.titlePosts),
      bodyOnlyPosts: Number(b.bodyOnlyPosts),
      score: Number(b.score),
    })),
    articles: articles.slice(0, 100),
    truncated: blogs.length > 100 || articles.length > 100,
    history,
  };
}
