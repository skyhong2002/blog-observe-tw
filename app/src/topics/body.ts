/** Shared worker/query freshness expression. Full private snapshots take precedence;
 * legacy relation extraction remains usable until a complete content snapshot exists.
 * Every body source must belong to the current post owner; equal hashes never override ownership. */
export const topicBodyHash = "CASE WHEN cb.status='ok' THEN cb.content_hash WHEN o.status='ok' THEN o.content_hash END";
export const topicBodyText = "CASE WHEN cb.status='ok' THEN cb.body_text WHEN o.status='ok' THEN o.body_text END";
export const topicBodyJoins =
  'LEFT JOIN content_post_bodies cb ON cb.post_id=p.id AND cb.blog_id=p.blog_id LEFT JOIN relation_observations o ON o.post_id=p.id AND o.blog_id=p.blog_id';
/** The same joins for reads that need only topicBodyHash: index-only (migration 0035). The planner otherwise takes the
 * primary key, one wide clustered row (~45 KB average in content_post_bodies) per article. */
export const topicBodyHashJoins =
  'LEFT JOIN content_post_bodies cb FORCE INDEX (content_bodies_hash) ON cb.post_id=p.id AND cb.blog_id=p.blog_id LEFT JOIN relation_observations o FORCE INDEX (relation_observations_hash) ON o.post_id=p.id AND o.blog_id=p.blog_id';

export const topicBodyHtml = "CASE WHEN cb.status='ok' THEN cb.body_html END";
export const topicBodyObtainedAt = "CASE WHEN cb.status='ok' THEN cb.obtained_at WHEN o.status='ok' THEN o.observed_at END";
