/**
 * Word-cloud input from the local topic ranking only (/api/topics?view=home on the homepage,
 * /api/blogs/<slug>/topics on a profile): the same ranked, policy-filtered pool the paired lists show.
 * Raw RSS categories and publisher tags never reach a cloud; this file adds no blacklist of its own.
 * Pure: node --test imports it.
 */
import { topicLink } from './page-links.ts';
import type { Period } from './public-query.ts';
import type { Topic } from './topics.ts';

/** `source` is read as provenance: only the approved shared tag pool may be drawn (see topicCloudWords). */
export type CloudTopic = Pick<Topic, 'id' | 'label' | 'canonicalPath' | 'posts' | 'blogs'> & { source?: unknown };
/** The one approved provenance: canonical terms of the shared tag vocabulary. */
export const CLOUD_SOURCE = 'tag-vocabulary';
export type TopicCloudWord = {
  label: string;
  count: number;
  href: string;
  ariaLabel: string;
  tone: 'brand';
  card: { rows: Array<[string, string]> };
};

/**
 * One word per ranked topic, in the ranking's order, sized by its article count; links follow topicLink.
 * Filtered by provenance, never by term: RSS-category rows, unknown or missing sources are not the approved pool.
 */
export function topicCloudWords(items: readonly CloudTopic[], days: Period, limit = 30): TopicCloudWord[] {
  return items
    .filter((t) => t.source === CLOUD_SOURCE)
    .filter((t) => typeof t.label === 'string' && t.label.trim() && Number.isSafeInteger(t.posts) && t.posts > 0)
    .slice(0, limit)
    .map((t) => ({
      label: t.label,
      count: Math.max(t.posts, t.blogs ?? 0, 1),
      href: topicLink(t.id, t.canonicalPath, days).href,
      ariaLabel: `${t.label}，近 ${days} 天 ${t.posts} 篇文章，${t.blogs} 個部落格`,
      tone: 'brand' as const,
      card: {
        rows: [
          [`近 ${days} 天文章`, `${t.posts} 篇`],
          ['部落格', `${t.blogs} 個`],
        ] as Array<[string, string]>,
      },
    }));
}
