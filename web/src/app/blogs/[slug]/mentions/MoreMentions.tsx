'use client';

// /blogs/<key>/mentions/: the rows after the server's first page, read from /api/blogs/<slug>/mentions/all when the
// reader asks for them (a button, so the RSS link and footer stay reachable). With no first page (its server read
// failed) the browser reads it itself. A failed page keeps every row already shown and offers a retry in place.

import { useEffect, useRef, useState } from 'react';
import { MentionList, type ProfileMentionFeed } from '@/components/ProfileMentionList';
import { SectionUnavailable } from '@/components/SectionBoundary';
import { createPublicLoader, type PublicLoad } from '@/lib/public-loader';
import { blogMentionFeedApiPath } from '@/lib/public-query';
import { asIs } from '@/lib/use-public-json';

const loader = createPublicLoader();

export default function MoreMentions({ slug, first }: { slug: string; first: ProfileMentionFeed | null }) {
  const [items, setItems] = useState(first?.items ?? []);
  // undefined: the first page is still to be read; null: there is nothing older.
  const [next, setNext] = useState<string | null | undefined>(first ? first.nextCursor : undefined);
  const [state, setState] = useState<'idle' | 'pending' | 'error'>(first ? 'idle' : 'pending');
  const runner = useRef<ReturnType<typeof loader.runner<ProfileMentionFeed>> | null>(null);

  useEffect(() => {
    const run = loader.runner<ProfileMentionFeed>((_path, load: PublicLoad<ProfileMentionFeed>) => {
      if (load.status !== 'ready') return setState('error');
      setItems((shown) => [...shown, ...load.data.items]);
      setNext(load.data.nextCursor);
      setState('idle');
    });
    runner.current = run;
    if (!first) run.run(blogMentionFeedApiPath(slug), asIs);
    return run.stop;
  }, [first, slug]);

  const read = (cursor?: string) => {
    setState('pending');
    runner.current?.run(blogMentionFeedApiPath(slug, cursor), asIs);
  };

  return (
    <section aria-label="提到這個部落格的文章" aria-busy={state === 'pending'} className="space-y-4">
      {items.length > 0 && <MentionList items={items} />}
      <div className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        {state === 'error' ? (
          <SectionUnavailable label={items.length ? '更早的文章' : '提到這個部落格的文章'} onRetry={() => read(next ?? undefined)} />
        ) : state === 'pending' ? (
          <p role="status">正在載入{items.length ? '更早的' : ''}文章…</p>
        ) : next ? (
          <button
            type="button"
            onClick={() => read(next)}
            className="rounded-full border border-zinc-300 px-4 py-2 hover:border-brand-700 dark:border-zinc-700 dark:hover:border-brand-400"
          >
            載入更早的文章
          </button>
        ) : null}
      </div>
    </section>
  );
}
