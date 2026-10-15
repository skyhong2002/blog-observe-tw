import type { FastifyInstance } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { topicBodyHash, topicBodyJoins } from './body.ts';
import { TopicResponseCache } from './cache.ts';
import { backgroundExcludedSql, DISPLAY_GATE, nativeLabelCte, nativeLabelJoin, windowGateCtes, windowGateSql } from './display-gate.ts';
import { FREQUENCY_POLICY } from './frequency.ts';
import { historyReadsEnabled } from './history-contracts.ts';
import { durableTopicDetail } from './history-read.ts';
import { digest, MATCHER_VERSION, normalizeTerm, POLICY_VERSION } from './policy.ts';
import { PUBLICATION_NOISE_VERSION, publicationExclusionReason, publicationLabelSql } from './publication-noise.ts';
import { enrichTopicSharedLabels } from './shared-label-enrichment.ts';
import { SOURCE } from './snapshot-client.ts';

export const matchingPolicy = {
  version: MATCHER_VERSION,
  policyVersion: POLICY_VERSION,
  publicationNoiseVersion: PUBLICATION_NOISE_VERSION,
  titleWeight: 2,
  bodyWeight: 1,
  sameBlogDecay: 0.5,
  sources: ['title', 'body'],
  recentBackfillHours: 48,
  frequency: FREQUENCY_POLICY,
  displayGate: DISPLAY_GATE,
};
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
// Window posts whose current index row still matches their title/body hashes.
// STRAIGHT_JOIN keeps the window (a few thousand posts) as the driver; letting the
// optimizer start from the whole snapshot index made busy-host plans flip to seconds.
const freshPosts = (
  blogScoped: boolean,
) => `scoped_posts AS (SELECT p.id,p.blog_id,p.published_at,p.content_hash FROM posts p JOIN blogs b ON b.id=p.blog_id WHERE p.published_at>=? AND p.published_at<=? AND b.status='verified' ${blogScoped ? 'AND b.slug=?' : ''}), fresh_posts AS (
 SELECT DISTINCT p.id,p.blog_id,p.published_at,i.snapshot_id FROM scoped_posts p
 JOIN topic_current c ON c.source=${literal(SOURCE)}
 STRAIGHT_JOIN topic_post_indexes_v3 i ON i.post_id=p.id AND i.snapshot_id=c.snapshot_id
 ${topicBodyJoins}
 WHERE i.status='ok' AND (i.post_hash<=>p.content_hash) AND (i.body_hash<=>(${topicBodyHash}))
 AND i.matcher_version=${literal(MATCHER_VERSION)}
)`;
const eligibleTermSql = `t.policy_version=${literal(POLICY_VERSION)}
 AND t.exclusion_reason IS NULL AND t.inactive_reason IS NULL AND ${publicationLabelSql('t.label')}`;
// Feed categories retain their provenance, but never create an independent ranking dictionary.
// Collapse title/body evidence per article before weighting; canonical labels merge source aliases.
export const evidence = (blogScoped = false, _verifiedOnly = true, displayGate = false) => `${freshPosts(blogScoped)}, evidence AS (
 SELECT p.id post_id,p.blog_id,p.published_at,CONCAT('tag:',t.id) topic_id,t.label,'tag-vocabulary' source,MAX(m.source='title') title_hit
 FROM fresh_posts p JOIN topic_matches_v3 m ON m.post_id=p.id AND m.snapshot_id=p.snapshot_id
 JOIN topic_canonical_terms_v3 t ON t.snapshot_id=m.snapshot_id AND t.id=m.term_id
 LEFT JOIN topic_term_frequencies f ON f.snapshot_id=t.snapshot_id AND f.term_id=t.id
 LEFT JOIN topic_frequency_runs fr ON fr.snapshot_id=t.snapshot_id AND fr.policy_version=${literal(FREQUENCY_POLICY.version)}
 WHERE ${eligibleTermSql} AND m.source IN ('title','body')
 AND (m.source='title' OR fr.snapshot_id IS NULL OR COALESCE(f.high_frequency,0)=0)
 GROUP BY p.id,p.blog_id,p.published_at,t.id,t.label
), ${displayGate ? windowGateCtes() : 'recent AS (SELECT * FROM evidence)'}`;
export const weightedScore = (titleCount: string, bodyCount: string) =>
  `(4*(1-POW(0.5,${titleCount}))+2*POW(0.5,${titleCount})*(1-POW(0.5,${bodyCount})))`;
const daysValue = (raw: unknown) =>
  raw === undefined ? 30 : typeof raw === 'string' && ['7', '30', '90'].includes(raw) ? Number(raw) : null;
const range = (days: number, now = new Date()) => [new Date(now.getTime() - days * 86400_000), now];
export async function vocabularyStatus(pool: Pool) {
  const [[row]] = await pool.query<RowDataPacket[]>(
    "SELECT s.id,s.manifest,s.synced_at FROM topic_current c JOIN topic_snapshots s ON s.id=c.snapshot_id WHERE c.source=? AND s.status='published'",
    [SOURCE],
  );
  const manifest = row ? (typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest) : null;
  const [[selection]] = row
    ? await pool.query<RowDataPacket[]>('SELECT * FROM topic_policy_selections WHERE snapshot_id=? AND policy_version=?', [
        row.id,
        POLICY_VERSION,
      ])
    : [[]];
  const configuration = selection ? (typeof selection.config === 'string' ? JSON.parse(selection.config) : selection.config) : null;
  const [excluded] =
    row && !(selection?.status === 'ready' && configuration?.exclusionReasons)
      ? await pool.query<RowDataPacket[]>(
          'SELECT exclusion_reason reason,COUNT(*) n FROM topic_canonical_terms_v3 WHERE snapshot_id=? AND policy_version=? AND exclusion_reason IS NOT NULL GROUP BY exclusion_reason',
          [row.id, POLICY_VERSION],
        )
      : [[]];
  const exclusionReasons: Record<string, number> =
    selection?.status === 'ready' && configuration?.exclusionReasons
      ? configuration.exclusionReasons
      : Object.fromEntries(excluded.map((item) => [item.reason, Number(item.n)]));
  const [[baseline]] = row
    ? await pool.query<RowDataPacket[]>('SELECT * FROM topic_frequency_runs WHERE snapshot_id=? AND policy_version=?', [
        row.id,
        FREQUENCY_POLICY.version,
      ])
    : [[]];
  return {
    status: row ? 'ready' : 'unavailable',
    source: SOURCE,
    version: row?.id ?? null,
    coverage: manifest?.coverage ?? null,
    syncedAt: row?.synced_at ?? null,
    window: manifest?.window ?? null,
    invalidTagCount: manifest?.invalidTagCount ?? null,
    normalizedTagCount: manifest?.normalizedTagCount ?? null,
    tagNormalization: manifest?.tagNormalization ?? null,
    upstreamSnapshotConsistent: manifest?.coverage === 'all-current-indexed-article-tags',
    excludedTermCount: Object.values(exclusionReasons).reduce((sum, count) => sum + count, 0),
    exclusionReasons,
    frequencyBaseline: baseline
      ? {
          since: baseline.baseline_from,
          until: baseline.baseline_until,
          totalPosts: Number(baseline.total_posts),
          coveredPosts: Number(baseline.covered_posts),
          thresholdRatio: Number(baseline.threshold_ratio),
          version: baseline.policy_version,
        }
      : null,
    totalSourceTerms: typeof manifest?.total === 'number' ? manifest.total : null,
    activeSet: selection
      ? {
          status: selection.status,
          version: selection.selection_id,
          asOf: selection.as_of,
          eligibleTerms: Number(selection.eligible_terms),
          activeTerms: Number(selection.active_terms),
          termLimit: Number(configuration.limits.maxTerms),
          codePointLimit: Number(configuration.limits.maxCodePoints),
          memoryBudgetBytes: Number(configuration.limits.maxEstimatedBytes),
          estimatedBytes: Number(selection.estimated_bytes),
          inactiveReasons: configuration?.inactiveReasons ?? {},
        }
      : null,
  };
}
const item = (r: RowDataPacket) => {
  const recentShare = Number(r.recent_total) > 0 ? Number(r.posts) / Number(r.recent_total) : null;
  const baselineShare = Number(r.baseline_total) > 0 ? Number(r.baseline_matched ?? 0) / Number(r.baseline_total) : null;
  return {
    id: r.topic_id,
    label: r.label,
    source: r.source,
    score: Number(r.score),
    posts: Number(r.posts),
    blogs: Number(r.blogs),
    titlePosts: Number(r.title_posts),
    bodyOnlyPosts: Number(r.body_posts),
    recentShare,
    baselineShare,
    lift: recentShare !== null && baselineShare !== null && baselineShare > 0 ? recentShare / baselineShare : null,
    // Only the compact/full rankings compute heat (see HEAT_SQL); per-blog rankings omit it.
    ...(r.heat === undefined || r.heat === null ? {} : { heat: Number(r.heat) }),
    matchingRule: Number(r.high_frequency) ? 'title-only' : 'title-and-body',
    matchingReason: Number(r.window_high_frequency)
      ? DISPLAY_GATE.reason
      : Number(r.high_frequency)
        ? 'high-document-frequency-title-only'
        : null,
  };
};
export async function ranking(
  pool: Pool,
  days: number,
  slug?: string,
  verifiedOnly = true,
  limit = 100,
  now = new Date(),
  includeMatchedPosts = false,
) {
  const args: unknown[] = [...range(days, now)];
  if (slug) args.push(slug);
  const boundedLimit = Math.min(200, Math.max(1, Math.floor(limit)));
  const [rows] = await pool.query<RowDataPacket[]>(
    `WITH ${evidence(Boolean(slug), verifiedOnly, true)},
    ${nativeLabelCte},
    ${includeMatchedPosts ? 'marked AS (SELECT recent.*,ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY topic_id)=1 first_match FROM recent),' : ''}
    per_blog AS (
    SELECT r.topic_id,r.label,r.source,r.blog_id,COUNT(*) n,SUM(title_hit) title_n,SUM(1-title_hit) body_n${includeMatchedPosts ? ',SUM(first_match) matched_n' : ''} FROM ${includeMatchedPosts ? 'marked' : 'recent'} r
    GROUP BY r.topic_id,r.label,r.source,r.blog_id)
    SELECT ranked.*${includeMatchedPosts ? ',(SELECT COUNT(DISTINCT post_id) FROM recent) matched_posts' : ''},(SELECT COUNT(*) FROM scoped_posts) recent_total,
      COALESCE(${backgroundExcludedSql},FALSE) background_excluded,
      fr.total_posts baseline_total,${windowGateSql()} window_high_frequency,
      (IF(fr.snapshot_id IS NOT NULL,COALESCE(f.high_frequency,0),0) OR ${windowGateSql()}) high_frequency,
      IF(f.high_frequency=1 OR ${windowGateSql()},f.title_posts,f.matched_posts) baseline_matched
    FROM (SELECT topic_id,label,source,SUM(${weightedScore('title_n', 'body_n')}) score,SUM(n) posts,COUNT(*) blogs,SUM(title_n) title_posts,SUM(body_n) body_posts${includeMatchedPosts ? ',SUM(matched_n) matched_n' : ''} FROM per_blog
    GROUP BY topic_id,label,source ${includeMatchedPosts ? '' : `HAVING COUNT(*)>=${slug ? 1 : 2}`}) ranked
    LEFT JOIN window_frequencies wf ON wf.topic_id=ranked.topic_id
    LEFT JOIN topic_current tc ON tc.source=${literal(SOURCE)}
    LEFT JOIN topic_frequency_runs fr ON fr.snapshot_id=tc.snapshot_id AND fr.policy_version=${literal(FREQUENCY_POLICY.version)}
    LEFT JOIN topic_term_frequencies f ON f.snapshot_id=fr.snapshot_id AND f.term_id=SUBSTRING(ranked.topic_id,5)
    LEFT JOIN topic_canonical_terms_v3 display_term ON display_term.snapshot_id=tc.snapshot_id AND display_term.id=SUBSTRING(ranked.topic_id,5)
    ${nativeLabelJoin}
    ${includeMatchedPosts ? '' : `WHERE NOT COALESCE(${backgroundExcludedSql},FALSE)`}
    ORDER BY ${includeMatchedPosts ? `(ranked.blogs>=${slug ? 1 : 2} AND background_excluded=0) DESC,` : ''}ranked.score DESC,ranked.blogs DESC,ranked.posts DESC,ranked.topic_id LIMIT ${boundedLimit + 1}`,
    args,
  );
  // Count each evidence article exactly once before the minimum-blog filter.
  // Ineligible topic rows remain last so an empty ranking still carries coverage.
  const eligible = includeMatchedPosts
    ? rows.filter((row) => Number(row.blogs) >= (slug ? 1 : 2) && !Number(row.background_excluded))
    : rows;
  return {
    ...(includeMatchedPosts ? { matchedPosts: Number(rows[0]?.matched_posts ?? 0) } : {}),
    items: eligible.slice(0, boundedLimit).map((row) => ({ ...item(row), ...(slug || !verifiedOnly ? { lift: null } : {}) })),
    truncated: eligible.length > boundedLimit,
  };
}
/** Compact home projection: aggregate article evidence once, then apply the exact same public quality gates.
 * Window functions keep the original per-topic source counts alongside each blog's counts; no duplicate
 * evidence/window_frequencies joins and no data retained between anonymous requests.
 * Matches are counted per term and blog before the term tables are read: the same per_blog counts as
 * grouping `evidence`, with one vocabulary/frequency lookup per (term, blog) instead of per (post, term).
 * A high-frequency term counts only its title posts, exactly as `evidence` drops its body rows. */
/**
 * Heat: this window's posts against what the term's 365-day baseline share predicts for a window this size,
 * smoothed by HEAT_SMOOTHING posts so a handful of articles cannot top the list. Rankings order by
 * heat × log2(1 + blogs): rising and widely written words first; everyday words (heat about 1) sink but stay.
 */
export const HEAT_SMOOTHING = 5;
const HEAT_SQL = `((SUM(IF(window_high_frequency,title_n,n))+${HEAT_SMOOTHING})/(COALESCE(MAX(baseline_matched)/NULLIF(MAX(baseline_total),0),0)*(SELECT COUNT(*) FROM scoped_posts)+${HEAT_SMOOTHING}))`;
const termBlogCtes = `term_blog AS (
       SELECT m.snapshot_id,m.term_id,p.blog_id,COUNT(DISTINCT p.id) all_n,COUNT(DISTINCT IF(m.source='title',p.id,NULL)) title_n
       FROM fresh_posts p JOIN topic_matches_v3 m ON m.post_id=p.id AND m.snapshot_id=p.snapshot_id
       WHERE m.source IN ('title','body') GROUP BY m.snapshot_id,m.term_id,p.blog_id
     ), per_blog AS (
       SELECT CONCAT('tag:',t.id) topic_id,t.id term_id,t.label,'tag-vocabulary' source,tb.blog_id,
         (fr.snapshot_id IS NULL OR COALESCE(f.high_frequency,0)=0) body_allowed,
         IF(fr.snapshot_id IS NULL OR COALESCE(f.high_frequency,0)=0,tb.all_n,tb.title_n) n,tb.title_n
       FROM term_blog tb JOIN topic_canonical_terms_v3 t ON t.snapshot_id=tb.snapshot_id AND t.id=tb.term_id
       LEFT JOIN topic_term_frequencies f ON f.snapshot_id=t.snapshot_id AND f.term_id=t.id
       LEFT JOIN topic_frequency_runs fr ON fr.snapshot_id=t.snapshot_id AND fr.policy_version=${literal(FREQUENCY_POLICY.version)}
       WHERE ${eligibleTermSql}
       HAVING n>0
     )`;
export async function compactHomeRanking(pool: Pool, days: number, now = new Date(), requestedLimit = 30) {
  const limit = Math.min(100, Math.max(1, Math.floor(requestedLimit)));
  const [rows] = await pool.query<RowDataPacket[]>(
    `WITH ${freshPosts(false)}, ${nativeLabelCte},
     ${termBlogCtes}, source_counts AS (
       SELECT per_blog.*,SUM(n) OVER (PARTITION BY topic_id) matched_posts,
         COUNT(*) OVER (PARTITION BY topic_id) blogs,
         SUM(n>=2) OVER (PARTITION BY topic_id) twice_sources,
         MAX(n) OVER (PARTITION BY topic_id) peak_posts FROM per_blog
     ), qualified AS (
       SELECT wf.*,${windowGateSql()} window_high_frequency,
         (IF(fr.snapshot_id IS NOT NULL,COALESCE(f.high_frequency,0),0) OR ${windowGateSql()}) high_frequency,
         fr.total_posts baseline_total,
         IF(f.high_frequency=1 OR ${windowGateSql()},f.title_posts,f.matched_posts) baseline_matched
       FROM source_counts wf LEFT JOIN topic_current tc ON tc.source=?
       LEFT JOIN topic_frequency_runs fr ON fr.snapshot_id=tc.snapshot_id AND fr.policy_version=?
       LEFT JOIN topic_term_frequencies f ON f.snapshot_id=fr.snapshot_id AND f.term_id=SUBSTRING(wf.topic_id,5)
       LEFT JOIN topic_canonical_terms_v3 display_term ON display_term.snapshot_id=tc.snapshot_id AND display_term.id=SUBSTRING(wf.topic_id,5)
       ${nativeLabelJoin}
       WHERE NOT COALESCE(${backgroundExcludedSql},FALSE)
     ) SELECT topic_id,label,source,
       SUM(${weightedScore('title_n', 'IF(window_high_frequency,0,n-title_n)')}) score,
       SUM(IF(window_high_frequency,title_n,n)) posts,COUNT(*) blogs,
       SUM(title_n) title_posts,SUM(IF(window_high_frequency,0,n-title_n)) body_posts,
       MAX(high_frequency) high_frequency,MAX(window_high_frequency) window_high_frequency,
       MAX(baseline_total) baseline_total,MAX(baseline_matched) baseline_matched,
       (SELECT COUNT(*) FROM scoped_posts) recent_total,
       ${HEAT_SQL} heat,${HEAT_SQL}*LOG2(1+COUNT(*)) rank_score
     FROM qualified WHERE title_n>0 OR NOT window_high_frequency
     GROUP BY topic_id,label,source HAVING COUNT(*)>=2
     ORDER BY rank_score DESC,score DESC,blogs DESC,posts DESC,topic_id LIMIT ${limit + 1}`,
    [...range(days, now), SOURCE, FREQUENCY_POLICY.version],
  );
  return { items: rows.slice(0, limit).map(item), truncated: rows.length > limit };
}
/** The /topics/ ranking, ordered like the homepage (heat × breadth, HEAT_SQL). It replaced
 * `ranking(…, 100, now, true)`, whose `evidence` CTE MariaDB re-evaluated for every reference (four times,
 * seconds per request). Items come from the compact projection; matchedPosts counts window posts with at least one surviving match: a title match, or
 * a body match on a term whose baseline allows body evidence and whose window gate did not close. */
export async function fullRanking(pool: Pool, days: number, now = new Date()) {
  const results = await compactHomeRanking(pool, days, now, 100);
  const [[matched]] = await pool.query<RowDataPacket[]>(
    `WITH ${freshPosts(false)}, ${termBlogCtes}, topic_gate AS (
       SELECT term_id,MAX(body_allowed) body_allowed,SUM(n) matched_posts,COUNT(*) blogs,SUM(n>=2) twice_sources,MAX(n) peak_posts
       FROM per_blog GROUP BY term_id
     ) SELECT COUNT(DISTINCT p.id) n FROM fresh_posts p
     JOIN topic_matches_v3 m ON m.post_id=p.id AND m.snapshot_id=p.snapshot_id
     JOIN topic_gate g ON g.term_id=m.term_id
     WHERE m.source='title' OR (m.source='body' AND g.body_allowed AND NOT ${windowGateSql('g')})`,
    range(days, now),
  );
  return { matchedPosts: Number(matched?.n ?? 0), ...results };
}

/** Resolve retained source IDs without allowing native feed categories to extend the tag dictionary. */
export async function resolveTopic(pool: Pool, id: string) {
  if (id.startsWith('rss:')) {
    const [[native]] = await pool.query<RowDataPacket[]>("SELECT label FROM tags WHERE id=? AND status='active' AND visibility='public'", [
      id.slice(4),
    ]);
    if (!native) return null;
    const [[canonical]] = await pool.query<RowDataPacket[]>(
      'SELECT t.id,t.label,t.exclusion_reason,t.inactive_reason,t.article_count,t.last_published_at FROM topic_canonical_terms_v3 t JOIN topic_current c ON c.snapshot_id=t.snapshot_id AND c.source=? WHERE t.id=? AND t.policy_version=?',
      [SOURCE, digest(normalizeTerm(native.label)), POLICY_VERSION],
    );
    const excludedReason =
      publicationExclusionReason(canonical?.label ?? native.label) ?? (canonical ? canonical.exclusion_reason : 'not-in-tag-vocabulary');
    return {
      id,
      label: canonical?.label ?? native.label,
      source: 'rss-category',
      canonicalId: canonical ? `tag:${canonical.id}` : null,
      excludedReason,
      inactiveReason: canonical?.inactive_reason ?? null,
      matchingStatus: excludedReason ? 'excluded' : canonical?.inactive_reason ? 'inactive' : 'active',
      articleCount: canonical ? Number(canonical.article_count) : null,
      lastPublishedAt: canonical?.last_published_at ?? null,
    };
  }
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT t.id,t.label,t.exclusion_reason,t.inactive_reason,t.article_count,t.last_published_at FROM topic_canonical_terms_v3 t JOIN topic_current c ON c.snapshot_id=t.snapshot_id AND c.source=?
     LEFT JOIN topic_term_aliases_v3 a ON a.snapshot_id=t.snapshot_id AND a.canonical_id=t.id AND a.term_id=?
     WHERE (t.id=? OR a.term_id=?) AND t.policy_version=? ORDER BY (t.id=?) DESC LIMIT 1`,
    [SOURCE, id.slice(4), id.slice(4), id.slice(4), POLICY_VERSION, id.slice(4)],
  );
  const excludedReason = rows[0] ? (publicationExclusionReason(rows[0].label) ?? rows[0].exclusion_reason) : null;
  return rows[0]
    ? {
        id,
        label: rows[0].label,
        source: 'tag-vocabulary',
        canonicalId: `tag:${rows[0].id}`,
        excludedReason,
        inactiveReason: rows[0].inactive_reason,
        matchingStatus: excludedReason ? 'excluded' : rows[0].inactive_reason ? 'inactive' : 'active',
        articleCount: Number(rows[0].article_count),
        lastPublishedAt: rows[0].last_published_at ?? null,
      }
    : null;
}
export async function topicEvidenceDetail(
  pool: Pool,
  id: string,
  days: number,
  verifiedOnly = true,
  now = new Date(),
  historyCursor?: string,
) {
  if (historyReadsEnabled()) return durableTopicDetail(pool, id, days, now, historyCursor);
  const resolved = await resolveTopic(pool, id);
  if (!resolved) return null;
  const [[frequency]] = resolved.canonicalId
    ? await pool.query<RowDataPacket[]>(
        `SELECT f.high_frequency FROM topic_term_frequencies f JOIN topic_current c ON c.snapshot_id=f.snapshot_id AND c.source=? JOIN topic_frequency_runs r ON r.snapshot_id=f.snapshot_id AND r.policy_version=? WHERE f.term_id=?`,
        [SOURCE, FREQUENCY_POLICY.version, resolved.canonicalId.slice(4)],
      )
    : [[]];
  const topic = {
    ...resolved,
    matchingRule: Number(frequency?.high_frequency) ? 'title-only' : 'title-and-body',
    matchingReason: Number(frequency?.high_frequency) ? 'high-document-frequency-title-only' : null,
  };
  if (!topic.canonicalId || topic.excludedReason || topic.inactiveReason) return { topic, blogs: [], articles: [], truncated: false };
  const args = [...range(days, now), topic.canonicalId];
  const [blogs] = await pool.query<RowDataPacket[]>(
    `WITH ${evidence(false, verifiedOnly)} SELECT b.id,b.slug,b.name,COUNT(*) posts,SUM(r.title_hit) titlePosts,SUM(1-r.title_hit) bodyOnlyPosts,${weightedScore('SUM(r.title_hit)', 'SUM(1-r.title_hit)')} score FROM recent r JOIN blogs b ON b.id=r.blog_id WHERE r.topic_id=? GROUP BY b.id,b.slug,b.name ORDER BY score DESC,posts DESC,b.id LIMIT 101`,
    args,
  );
  const [articles] = await pool.query<RowDataPacket[]>(
    `WITH ${evidence(false, verifiedOnly)} SELECT p.id,p.title,p.url,p.published_at publishedAt,b.slug blogSlug,b.name blogName FROM recent r JOIN posts p ON p.id=r.post_id JOIN blogs b ON b.id=r.blog_id WHERE r.topic_id=? ORDER BY p.published_at DESC,p.id DESC LIMIT 101`,
    args,
  );
  return {
    topic,
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
  };
}
const caches = new WeakMap<Pool, Set<TopicResponseCache>>();
export function invalidateTopicCache(pool: Pool) {
  for (const cache of caches.get(pool) ?? []) cache.clear();
}
export function registerTopicRoutes(app: FastifyInstance, pool: Pool) {
  const cache = new TopicResponseCache();
  const active = caches.get(pool) ?? new Set<TopicResponseCache>();
  active.add(cache);
  caches.set(pool, active);
  app.addHook('onClose', async () => {
    active.delete(cache);
    if (!active.size) caches.delete(pool);
  });
  const metadata = () => ({ generatedAt: new Date().toISOString(), cacheSeconds: cache.ttlMs / 1000, matchingPolicy });
  app.get<{ Querystring: { days?: string; view?: string } }>('/api/topics', async (req, reply) => {
    const days = daysValue(req.query.days);
    reply.header('cache-control', 'no-store');
    if (!days) return reply.code(400).send({ error: 'invalid_days' });
    if (req.query.view !== undefined && req.query.view !== 'home') return reply.code(400).send({ error: 'invalid_view' });
    if (req.query.view === 'home')
      return cache.get(`rank:${days}:home`, async () => {
        // One fresh ranking read serves both the compact list and the larger masthead cloud.
        // The cloud draws 30 words but skips body-mention words (web topicCloudWords), so it
        // gets twice that many ranked candidates.
        const results = await compactHomeRanking(pool, days, undefined, 60);
        return {
          ...metadata(),
          view: 'home',
          days,
          source: 'tag-vocabulary',
          items: results.items.slice(0, 8),
          truncated: results.items.length > 8 || results.truncated,
          cloudItems: results.items,
          cloudTruncated: results.truncated,
          minimumBlogs: 2,
          limit: 8,
        };
      });
    return cache.get(`rank:${days}`, async () => {
      const now = new Date();
      const [results, vocabulary] = await Promise.all([fullRanking(pool, days, now), vocabularyStatus(pool)]);
      const dates = range(days, now);
      const [[coverage]] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) datedPosts,COALESCE(SUM(cb.status='ok' OR o.status='ok'),0) bodyObservedPosts FROM posts p JOIN blogs b ON b.id=p.blog_id ${topicBodyJoins} WHERE p.published_at>=? AND p.published_at<=? AND b.status='verified'`,
        dates,
      );
      const [[undated]] = await pool.query<RowDataPacket[]>(
        "SELECT COUNT(*) unknownDatePosts FROM posts p JOIN blogs b ON b.id=p.blog_id WHERE p.published_at IS NULL AND b.status='verified'",
      );
      const [[capped]] = await pool.query<RowDataPacket[]>(
        "SELECT COUNT(*) n FROM topic_post_indexes_v3 i JOIN topic_current c ON c.snapshot_id=i.snapshot_id AND c.source=? WHERE i.status='capped' AND i.matcher_version=?",
        [SOURCE, MATCHER_VERSION],
      );
      return {
        ...metadata(),
        days,
        source: 'tag-vocabulary',
        vocabulary,
        coverage: {
          datedPosts: Number(coverage.datedPosts ?? 0),
          unknownDatePosts: Number(undated.unknownDatePosts ?? 0),
          bodyObservedPosts: Number(coverage.bodyObservedPosts ?? 0),
          matchedPosts: results.matchedPosts ?? 0,
          cappedPosts: Number(capped.n),
        },
        items: results.items,
        truncated: results.truncated,
        minimumBlogs: 2,
        limit: 100,
      };
    });
  });
  app.get<{ Params: { id: string }; Querystring: { days?: string; historyCursor?: string } }>('/api/topics/:id', async (req, reply) => {
    const days = daysValue(req.query.days);
    if (!days) return reply.code(400).send({ error: 'invalid_days' });
    const id = req.params.id;
    if (!/^(rss:[1-9]\d{0,9}|tag:[0-9a-f]{64})$/.test(id)) return reply.code(400).send({ error: 'invalid_topic' });
    if (historyReadsEnabled()) {
      reply.header('cache-control', 'no-store');
      try {
        // The detail's authoritative disposition decides status; no earlier preflight can go stale.
        const detail = await topicEvidenceDetail(pool, id, days, true, new Date(), req.query.historyCursor);
        if (!detail) return reply.code(404).send({ error: 'topic_not_found' });
        return reply.send({
          ...metadata(),
          days,
          vocabulary: await vocabularyStatus(pool),
          ...(await enrichTopicSharedLabels(pool, detail)),
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'topic_gone') return reply.code(410).send({ error: 'topic_gone' });
        throw error;
      }
    }
    const result = await cache.get(`detail:${days}:${id}`, async () => {
      const detail = await topicEvidenceDetail(pool, id, days);
      return detail
        ? { ...metadata(), days, vocabulary: await vocabularyStatus(pool), ...(await enrichTopicSharedLabels(pool, detail)) }
        : null;
    });
    return result ?? reply.code(404).send({ error: 'topic_not_found' });
  });
  app.get<{ Params: { slug: string }; Querystring: { days?: string } }>('/api/blogs/:slug/topics', async (req, reply) => {
    const days = daysValue(req.query.days);
    if (!days) return reply.code(400).send({ error: 'invalid_days' });
    if (req.params.slug.length > 255) return reply.code(400).send({ error: 'invalid_slug' });
    const [[blog]] = await pool.query<RowDataPacket[]>("SELECT id FROM blogs WHERE slug=? AND status='verified' LIMIT 1", [
      req.params.slug,
    ]);
    if (!blog) return reply.code(404).send({ error: 'blog_not_found' });
    return cache.get(`blog:${days}:${req.params.slug}`, async () => ({
      ...metadata(),
      days,
      vocabulary: await vocabularyStatus(pool),
      ...(await ranking(pool, days, req.params.slug)),
      minimumBlogs: 1,
    }));
  });
}
