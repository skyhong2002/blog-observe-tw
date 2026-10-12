/** Shared worker/query freshness expression. Full private snapshots take precedence;
 * legacy relation extraction remains usable until a complete content snapshot exists. */
export const topicBodyHash = "CASE WHEN cb.status='ok' THEN cb.content_hash WHEN o.status='ok' THEN o.content_hash END";
export const topicBodyText = "CASE WHEN cb.status='ok' THEN cb.body_text WHEN o.status='ok' THEN o.body_text END";
export const topicBodyJoins = 'LEFT JOIN content_post_bodies cb ON cb.post_id=p.id LEFT JOIN relation_observations o ON o.post_id=p.id';

export const topicBodyHtml = "CASE WHEN cb.status='ok' THEN cb.body_html END";
export const topicBodyObtainedAt = "CASE WHEN cb.status='ok' THEN cb.obtained_at WHEN o.status='ok' THEN o.observed_at END";
