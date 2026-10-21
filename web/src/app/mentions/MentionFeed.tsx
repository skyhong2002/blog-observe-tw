'use client';

// The /mentions/ feed: the homepage's citation cards (HomeMentions.tsx), newest first, reading the next page from
// /api/mentions when the reader nears the end of the list. A list button does the same for keyboards and for
// browsers without IntersectionObserver. A failed page keeps every card already shown and offers a retry in place.
// On a wide screen the cards stack in two independent columns (each card joins the shorter one, by an estimate of its
// height), so cards are not stretched to their neighbour's height. A card keeps its column when more pages arrive.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SectionUnavailable } from '@/components/SectionBoundary';
import type { MentionFeed } from '@/lib/api';
import { createPublicLoader, type PublicLoad } from '@/lib/public-loader';
import { mentionsApiPath } from '@/lib/public-query';
import { asIs } from '@/lib/use-public-json';
import { type MentionCard, MentionCardView, mentionCards } from '../_home/HomeMentions';
import styles from '../_home/home.module.css';

const loader = createPublicLoader();
/** How far below the viewport the next page starts loading. */
const AHEAD = '800px 0px';
/** Matches home.module.css's .feedGrid breakpoint. */
const WIDE = '(min-width: 1024px)';
const subscribeWide = (change: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
};
/** Rough rendered height of a card in pixels: meta line, title, tags, and each target with its quote (two lines at most). */
const estimate = ({ article, targets }: MentionCard) =>
  60 +
  Math.ceil(article.postTitle.length / 24) * 28 +
  (article.postTags?.length ? 22 : 0) +
  targets.reduce((sum, t) => sum + 40 + Math.min(2, Math.ceil(((t.quote ?? t.context).length || 1) / 34)) * 26, 0);

export default function MentionFeedView({ first }: { first: MentionFeed | null }) {
  const [items, setItems] = useState(first?.items ?? []);
  // undefined: the first page is still to be read (its server read failed); null: there is nothing older.
  const [next, setNext] = useState<string | null | undefined>(first ? first.nextCursor : undefined);
  const [state, setState] = useState<'idle' | 'pending' | 'error'>(first ? 'idle' : 'pending');
  const runner = useRef<ReturnType<typeof loader.runner<MentionFeed>> | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  // Server and first client render: one list (the CSS grid still shows two columns); then the stacked columns.
  const wide = useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
  const placed = useRef({ column: new Map<string, 0 | 1>(), heights: [0, 0] });

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
      {cards.length && wide ? (
        <div className={styles.feedColumns}>
          {columns(cards, placed.current).map((column, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: always the same two columns
            <div key={i} className={styles.feedColumn}>
              {column.map((card) => (
                <MentionCardView key={card.key} card={card} />
              ))}
            </div>
          ))}
        </div>
      ) : cards.length ? (
        <div className={`${styles.storyList} ${styles.feedGrid}`}>
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

/** Each card not yet placed joins the shorter column; placed cards keep theirs, so loading more never moves a card. */
function columns(cards: MentionCard[], placed: { column: Map<string, 0 | 1>; heights: number[] }) {
  const out: [MentionCard[], MentionCard[]] = [[], []];
  for (const card of cards) {
    let column = placed.column.get(card.key);
    if (column === undefined) {
      column = placed.heights[1] < placed.heights[0] ? 1 : 0;
      placed.column.set(card.key, column);
      placed.heights[column] += estimate(card);
    }
    out[column].push(card);
  }
  return out;
}
