'use client';

// The homepage's citations when the overview's own citation read gave up (its one-statement budget on a loaded
// host): the browser reads the newest page of /api/mentions — the same rows, from a query with a longer budget —
// and shows the homepage's eight. If that fails too, the section says so with a retry.

import { useEffect, useState } from 'react';
import Link from '@/components/NoPrefetchLink';
import { SectionUnavailable } from '@/components/SectionBoundary';
import type { MentionFeed } from '@/lib/api';
import { createPublicLoader, type PublicLoad } from '@/lib/public-loader';
import { mentionsApiPath } from '@/lib/public-query';
import { asIs } from '@/lib/use-public-json';
import { MentionCardView, mentionCards } from './HomeMentions';
import styles from './home.module.css';
import { HOME_BROWSER_TIMEOUT_MS } from './home-topics-browser';

/** The homepage shows at most eight article→blog rows (HOME_MENTION_LIMIT). */
const HOME_ROWS = 8;
const loader = createPublicLoader({ timeoutMs: HOME_BROWSER_TIMEOUT_MS });

export default function HomeMentionsFromBrowser() {
  const [load, setLoad] = useState<PublicLoad<MentionFeed>>({ status: 'pending' });
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry trigger.
  useEffect(() => {
    const run = loader.runner<MentionFeed>((_path, result) => setLoad(result));
    setLoad({ status: 'pending' });
    run.run(mentionsApiPath(), asIs);
    return run.stop;
  }, [attempt]);
  if (load.status === 'pending')
    return (
      <p role="status" aria-busy="true" className={styles.notice}>
        正在載入部落格引用…
      </p>
    );
  if (load.status !== 'ready')
    return <SectionUnavailable label="部落格引用" className={styles.notice} onRetry={() => setAttempt((n) => n + 1)} />;
  const cards = mentionCards(load.data.items.slice(0, HOME_ROWS));
  return cards.length ? (
    <div className={styles.storyList}>
      {cards.map((card) => (
        <MentionCardView key={card.key} card={card} />
      ))}
      <Link href="/mentions/" className={styles.more}>
        看更多部落格引用 <span aria-hidden="true">→</span>
      </Link>
    </div>
  ) : null;
}
