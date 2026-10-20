// The homepage's 最近共同話題 list, read on its own so the rest of the page (hero, articles, meta) streams
// without waiting for the ranking. A failed read throws to the error boundary; it is never an empty list.

import Link from '@/components/NoPrefetchLink';
import { topicLink } from '@/lib/page-links';
import { publicJson } from '@/lib/public-api';
import { homeTopicsApiPath } from '@/lib/public-query';
import type { Topic } from '@/lib/topics';
import styles from './home.module.css';

/** /api/topics?view=home (homeTopics in public-contracts.ts): the top eight, without vocabulary or coverage. */
export type HomeTopics = {
  view: 'home';
  generatedAt: string;
  cacheSeconds: number;
  days: number;
  source: 'tag-vocabulary';
  items: Array<Pick<Topic, 'id' | 'label' | 'canonicalPath' | 'source' | 'posts' | 'blogs'>>;
  /** The same ranked, quality-filtered pool at the cloud's length (at most 30); absent on older gateways. */
  cloudItems?: Array<Pick<Topic, 'id' | 'label' | 'canonicalPath' | 'source' | 'posts' | 'blogs' | 'titlePosts' | 'heat'>>;
  cloudTruncated?: boolean;
  truncated: boolean;
  minimumBlogs: number;
  limit: number;
};

export default async function HomeTopicRanking() {
  const topics = await publicJson<HomeTopics>(homeTopicsApiPath('30'));
  return topics.items.length ? (
    <ol className={styles.ranking}>
      {topics.items.slice(0, 8).map((tag, i) => (
        <li key={tag.id}>
          <Link {...topicLink(tag.id, tag.canonicalPath, '30')}>
            <span className={styles.rank}>{String(i + 1).padStart(2, '0')}</span>
            <span className={styles.rankBody}>
              <strong>{tag.label}</strong>
              <small>
                {tag.blogs} 個部落格 · {tag.posts} 篇{tag.source === 'rss-category' ? ' · RSS' : ''}
              </small>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  ) : null;
}

// One stable key per placeholder row (the ranking's eight); the rows carry no data.
const PENDING_ROWS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'] as const;

/** While the ranking loads: the list's frame with blank rows, no rank, label or count. */
export function HomeTopicsPending() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">正在載入最近共同話題…</span>
      <ol className={styles.ranking} aria-hidden="true">
        {PENDING_ROWS.map((row) => (
          <li key={row} className="flex flex-col gap-2 px-3 py-[15px]">
            <span className="block h-3.5 w-28 rounded bg-zinc-200 motion-safe:animate-pulse dark:bg-zinc-800" />
            <span className="block h-2.5 w-40 rounded bg-zinc-100 motion-safe:animate-pulse dark:bg-zinc-800/60" />
          </li>
        ))}
      </ol>
    </div>
  );
}
