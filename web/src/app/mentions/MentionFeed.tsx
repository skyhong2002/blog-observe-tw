'use client';

// The /mentions/ feed: the homepage's citation cards (HomeMentions.tsx), newest first, reading the next page from
// /api/mentions when the reader nears the end of the list. A list button does the same for keyboards and for
// browsers without IntersectionObserver. A failed page keeps every card already shown and offers a retry in place.

import { useCallback, useEffect, useRef, useState } from 'react';
import { SectionUnavailable } from '@/components/SectionBoundary';
import type { MentionFeed } from '@/lib/api';
import { createPublicLoader, type PublicLoad } from '@/lib/public-loader';
import { mentionsApiPath } from '@/lib/public-query';
import { asIs } from '@/lib/use-public-json';
import { MentionCardView, mentionCards } from '../_home/HomeMentions';
import styles from '../_home/home.module.css';

const loader = createPublicLoader();
/** How far below the viewport the next page starts loading. */
const AHEAD = '800px 0px';

export default function MentionFeedView({ first }: { first: MentionFeed | null }) {
  const [items, setItems] = useState(first?.items ?? []);
  // undefined: the first page is still to be read (its server read failed); null: there is nothing older.
  const [next, setNext] = useState<string | null | undefined>(first ? first.nextCursor : undefined);
  const [state, setState] = useState<'idle' | 'pending' | 'error'>(first ? 'idle' : 'pending');
  const runner = useRef<ReturnType<typeof loader.runner<MentionFeed>> | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const run = loader.runner<MentionFeed>((_path, load: PublicLoad<MentionFeed>) => {
      if (load.status !== 'ready') return setState('error');
      setItems((shown) => [...shown, ...load.data.items]);
      setNext(load.data.nextCursor);
      setState('idle');
    });
    runner.current = run;
    if (!first) run.run(mentionsApiPath(), asIs);
    return run.stop;
  }, [first]);

  const more = useCallback(() => {
    if (next === null) return;
    setState('pending');
    runner.current?.run(mentionsApiPath(next), asIs);
  }, [next]);

  // A new observer after every settled page: if the end is still in view (a short page), it fires again at once.
  useEffect(() => {
    const end = sentinel.current;
    if (state !== 'idle' || !next || !end || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && more(), { rootMargin: AHEAD });
    observer.observe(end);
    return () => observer.disconnect();
  }, [state, next, more]);

  const cards = mentionCards(items);
  return (
    <section className={styles.feed} aria-label="部落格引用" aria-busy={state === 'pending'}>
      {cards.length ? (
        <div className={styles.storyList}>
          {cards.map((card) => (
            <MentionCardView key={card.key} card={card} />
          ))}
        </div>
      ) : null}
      <div ref={sentinel} className="mt-4 text-center text-sm text-zinc-600 dark:text-zinc-400">
        {state === 'error' ? (
          <SectionUnavailable
            label={cards.length ? '更早的引用' : '部落格引用'}
            onRetry={
              next === undefined
                ? () => {
                    setState('pending');
                    runner.current?.run(mentionsApiPath(), asIs);
                  }
                : more
            }
          />
        ) : state === 'pending' ? (
          <p role="status">正在載入{cards.length ? '更早的' : ''}引用…</p>
        ) : next ? (
          <button
            type="button"
            onClick={more}
            className="rounded-full border border-zinc-300 px-4 py-2 hover:border-brand-700 dark:border-zinc-700 dark:hover:border-brand-400"
          >
            載入更早的引用
          </button>
        ) : cards.length ? (
          <p>沒有更早的引用了</p>
        ) : null}
      </div>
    </section>
  );
}
