// A profile's word cloud, server-rendered into SourceProfile's `cloud` slot inside its own Suspense. It reads the
// same blogTopicsApiPath (the profile's original 90-day period) as BlogTopics, so React's per-request cache
// (public-api.ts) makes one no-store read for both. null is the gateway's 404 (no topic data offered); other
// failures throw like BlogTopics does.
import { publicJsonOrNull } from '@/lib/public-api';
import { BLOG_TOPICS_PERIOD, blogTopicsApiPath } from '@/lib/public-query';
import { topicCloudWords } from '@/lib/topic-cloud';
import type { Topics } from '@/lib/topics';
import MediaWordCloud from './MediaWordCloud';

export default async function BlogTopicCloud({ slug }: { slug: string }) {
  const data = await publicJsonOrNull<Topics>(blogTopicsApiPath(slug));
  return <MediaWordCloud words={data ? topicCloudWords(data.items, BLOG_TOPICS_PERIOD) : null} />;
}
