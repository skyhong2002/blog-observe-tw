import { describe, expect, it } from 'vitest';
import { topicBodyHash, topicBodyHtml, topicBodyJoins, topicBodyObtainedAt, topicBodyText } from './body.ts';

describe('global topic body owner SQL contract', () => {
  it('both independent joins pin owner to current post, without changing precedence', () => {
    expect(topicBodyJoins).toContain('cb.post_id=p.id AND cb.blog_id=p.blog_id');
    expect(topicBodyJoins).toContain('o.post_id=p.id AND o.blog_id=p.blog_id');
    expect(topicBodyHash).toBe("CASE WHEN cb.status='ok' THEN cb.content_hash WHEN o.status='ok' THEN o.content_hash END");
    expect(topicBodyText).toBe("CASE WHEN cb.status='ok' THEN cb.body_text WHEN o.status='ok' THEN o.body_text END");
    expect(topicBodyHtml).toBe("CASE WHEN cb.status='ok' THEN cb.body_html END");
    expect(topicBodyObtainedAt).toBe("CASE WHEN cb.status='ok' THEN cb.obtained_at WHEN o.status='ok' THEN o.observed_at END");
  });
});
