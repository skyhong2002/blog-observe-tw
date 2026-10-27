/**
 * Read-only, evidence-backed acceptance audit. No network requests, mutations, or full evidence downloads.
 * node --env-file=/path/to/clone.env tools/audit-topic-history.ts [--seed=blog-topic-history-audit-v1]
 * Use a SELECT-only database account when available. Output contains only public topic metadata.
 */
import { pathToFileURL } from 'node:url';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createDb } from '../app/src/db/client.ts';
import { isPublicRouteKey } from '../app/src/seo/page-routes.ts';
import { FREQUENCY_POLICY } from '../app/src/topics/frequency.ts';
import { historyEvidenceSql, historyPublicTopicSql } from '../app/src/topics/history-read.ts';
import { digest, exclusionReason, MATCHER_VERSION, normalizeTerm } from '../app/src/topics/policy.ts';
import { SOURCE } from '../app/src/topics/snapshot-client.ts';

const ORIGIN = 'https://weblog.tw';
const DEFAULT_SEED = 'blog-topic-history-audit-v1';
const SPECIAL_LABELS = ['拍照', 'Inside', '預告片'];
const iso = (value: unknown): string | null => {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
type Topic = {
  canonicalId: string;
  topicId: string;
  label: string;
  oldUrl: string;
  newUrl: string | null;
  articles30Days: number;
  articles90Days: number;
  historicalArticles: number;
  confirmedArticles: number;
  pendingArticles: number;
  observedArticles90Days: number;
  latestPublishedAt: string | null;
};

/** One aggregate row per public topic crosses the database boundary, never millions of evidence rows. */
export async function auditTopicHistory(pool: Pool, seed = DEFAULT_SEED) {
  if (!seed || seed.length > 128 || /[\p{Cc}\p{Cf}]/u.test(seed)) throw Error('invalid_seed');
  const [[clock]] = await pool.query<RowDataPacket[]>('SELECT UTC_TIMESTAMP() as_of');
  const asOf = new Date(clock.as_of);
  if (!Number.isFinite(asOf.getTime())) throw Error('invalid_database_clock');
  const since30 = new Date(asOf.getTime() - 30 * 86400_000);
  const since90 = new Date(asOf.getTime() - 90 * 86400_000);
  const [rows] = await pool.query<RowDataPacket[]>(
    `WITH ${historyEvidenceSql(false)}, current_frequency AS (
       SELECT f.term_id,f.high_frequency FROM topic_current tc
       JOIN topic_frequency_runs fr ON fr.snapshot_id=tc.snapshot_id AND fr.policy_version=?
       JOIN topic_term_frequencies f ON f.snapshot_id=fr.snapshot_id WHERE tc.source=?)
     SELECT t.canonical_id,t.label,r.canonical_key,COUNT(*) historical_articles,
       SUM(h.fresh=1) confirmed_articles,SUM(h.fresh=0) pending_articles,
       SUM(h.fresh=1 AND h.published_at>=? AND (COALESCE(f.high_frequency,0)<>1 OR h.title_hit=1)) recent30,
       SUM(h.fresh=1 AND h.published_at>=? AND (COALESCE(f.high_frequency,0)<>1 OR h.title_hit=1)) recent90,
       SUM(h.published_at>=?) observed90,MAX(h.published_at) last_published
     FROM historical h JOIN topic_pages t ON t.canonical_id=h.canonical_id
     LEFT JOIN public_page_routes r ON r.kind='topic' AND r.entity_id=t.canonical_id
     LEFT JOIN current_frequency f ON f.term_id=t.canonical_id
     WHERE t.state IN ('active','pending') AND ${historyPublicTopicSql('t')}
       AND (h.published_at IS NULL OR h.published_at<=?)
     GROUP BY t.canonical_id,t.label,r.canonical_key`,
    [FREQUENCY_POLICY.version, SOURCE, since30, since90, since90, asOf],
  );
  const population: Topic[] = rows
    .filter((r) => !exclusionReason(String(r.label)))
    .map((r) => {
      const canonicalId = String(r.canonical_id);
      const topicId = `tag:${canonicalId}`;
      const key = typeof r.canonical_key === 'string' && isPublicRouteKey('topic', r.canonical_key) ? r.canonical_key : null;
      return {
        canonicalId,
        topicId,
        label: String(r.label),
        oldUrl: `${ORIGIN}/topics/${encodeURIComponent(topicId)}/`,
        newUrl: key ? `${ORIGIN}/topics/${encodeURIComponent(key)}/` : null,
        articles30Days: Number(r.recent30 ?? 0),
        articles90Days: Number(r.recent90 ?? 0),
        historicalArticles: Number(r.historical_articles),
        confirmedArticles: Number(r.confirmed_articles ?? 0),
        pendingArticles: Number(r.pending_articles ?? 0),
        observedArticles90Days: Number(r.observed90 ?? 0),
        latestPublishedAt: iso(r.last_published),
      };
    });
  // Deterministic ranking of the population; independent of SQL row order or process randomness.
  const sampled = population
    .map((topic) => ({ topic, order: digest(`${seed}:${topic.canonicalId}`) }))
    .sort((a, b) => a.order.localeCompare(b.order) || a.topic.canonicalId.localeCompare(b.topic.canonicalId))
    .map(({ topic }) => topic);
  const random20 = sampled.slice(0, 20);
  const historicalOnlyExamples = sampled.filter((t) => t.articles90Days === 0 && t.observedArticles90Days === 0 && t.historicalArticles > 0).slice(0, 3);
  const named = SPECIAL_LABELS.map((label) => ({
    requestedLabel: label,
    topic: population.find((t) => normalizeTerm(t.label) === normalizeTerm(label)) ?? null,
  }));
  const selectedIds = [
    ...new Set([...random20, ...historicalOnlyExamples, ...named.flatMap((t) => (t.topic ? [t.topic] : []))].map((t) => t.canonicalId)),
  ];
  const latest = new Map<string, Record<string, unknown>>();
  if (selectedIds.length) {
    const [matches] = await pool.query<RowDataPacket[]>(
      `WITH ${historyEvidenceSql('many')}, ranked AS (
       SELECT e.canonical_id,e.post_id,e.matcher_version,e.last_observed_at,e.source,e.state,h.fresh,
        ROW_NUMBER() OVER(PARTITION BY e.canonical_id ORDER BY e.last_observed_at DESC,e.post_id DESC,e.source DESC) ordinal
       FROM topic_article_evidence e JOIN historical h ON h.canonical_id=e.canonical_id AND h.post_id=e.post_id
       WHERE e.canonical_id IN (?) AND e.state IN ('confirmed','pending') AND e.source IN ('title','body')
       AND (h.published_at IS NULL OR h.published_at<=?))
       SELECT canonical_id,post_id,matcher_version,last_observed_at,source,state,fresh FROM ranked WHERE ordinal=1`,
      [selectedIds, selectedIds, asOf],
    );
    for (const row of matches)
      latest.set(String(row.canonical_id), {
        articleId: Number(row.post_id),
        matcherVersion: String(row.matcher_version),
        observedAt: iso(row.last_observed_at),
        source: String(row.source),
        storedEvidenceState: String(row.state),
        effectiveArticleState: Number(row.fresh) ? 'confirmed' : 'pending',
      });
  }
  const detail = (topic: Topic) => ({ ...topic, latestMatchingArticle: latest.get(topic.canonicalId) ?? null });
  const namedStatuses = [];
  for (const item of named) {
    if (item.topic) {
      namedStatuses.push({ requestedLabel: item.requestedLabel, public: true, ...detail(item.topic) });
      continue;
    }
    // Bounded point lookup only: absence from the public population must never expose masked evidence.
    const [[page]] = await pool.query<RowDataPacket[]>('SELECT canonical_id,label,state,reason FROM topic_pages WHERE canonical_id=?', [
      digest(normalizeTerm(item.requestedLabel)),
    ]);
    namedStatuses.push({
      requestedLabel: item.requestedLabel,
      public: false,
      status: page ? 'not-in-public-evidence-population' : 'never-observed',
      ledgerState: page ? String(page.state) : null,
      exclusionReason: page ? exclusionReason(String(page.label)) : null,
    });
  }
  return {
    auditVersion: 1,
    seed,
    asOf: asOf.toISOString(),
    matcherVersion: MATCHER_VERSION,
    population: 'public-blog-article-evidence; not the tag vocabulary pool',
    semantics: {
      historical:
        'Distinct public articles with retained confirmed or pending evidence, all publication dates, including undated articles.',
      recent:
        'Distinct fresh confirmed public articles published within the trailing 30/90 UTC days; current high-frequency terms require title hits, matching topic detail.',
      pending: 'Retained evidence with stale hashes/version remains historical, not fresh confirmed.',
      sampling: 'SHA-256(seed:canonicalId) ascending; stable for the same population and seed.',
      consistency: 'Read-only sequential SELECTs; ongoing worker writes can change evidence between aggregate and detail queries.',
    },
    cumulativePublicTopics: population.length,
    zero30And90Days: population.filter((t) => t.articles30Days === 0 && t.articles90Days === 0).length,
    missingReadableRoutes: population.filter((t) => !t.newUrl).length,
    random20: random20.map(detail),
    historicalOnlyExamples: historicalOnlyExamples.map(detail),
    historicalOnlyExampleShortfall: Math.max(0, 3 - historicalOnlyExamples.length),
    namedTopics: namedStatuses,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let db: ReturnType<typeof createDb> | undefined;
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some((arg) => !arg.startsWith('--seed='))) throw Error('invalid_arguments');
    db = createDb(process.env.BLOG_DB_URL, { poolSize: 1 });
    console.log(JSON.stringify(await auditTopicHistory(db.pool, args[0]?.slice('--seed='.length) ?? DEFAULT_SEED), null, 2));
  } catch {
    // Never print driver errors, configuration, connection URLs, or credentials.
    console.error(JSON.stringify({ error: 'topic_history_audit_failed' }));
    process.exitCode = 1;
  } finally {
    await db?.close();
  }
}
