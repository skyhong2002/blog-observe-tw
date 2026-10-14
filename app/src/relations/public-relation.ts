// Stable source-post / exact target / location identity survives crawler ordinal changes.
// This only filters public presentation; original observations/discovery evidence are never mutated.
export const PUBLIC_RELATION = `EXISTS (SELECT 1 FROM posts visible_post JOIN blogs visible_blog ON visible_blog.id=visible_post.blog_id
  WHERE visible_post.id=l.source_post_id AND visible_post.blog_id=l.source_blog_id AND visible_blog.status='verified') AND EXISTS (SELECT 1 FROM relation_observations public_o WHERE public_o.post_id=l.source_post_id AND public_o.last_success_at IS NOT NULL AND public_o.status<>'reparse-pending') AND NOT EXISTS (SELECT 1 FROM admin_relation_overrides hidden_link
  WHERE hidden_link.source_post_id=l.source_post_id AND hidden_link.target_url_hash=SHA2(l.target_url,256)
  AND BINARY hidden_link.target_url=BINARY l.target_url AND hidden_link.location=l.location AND hidden_link.hidden=TRUE)`;
