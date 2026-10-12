'use client';

import { type RefObject, useEffect } from 'react';
import { missedImageEvent } from '@/lib/images';

/**
 * A server-rendered <img> may finish loading, or fail, before React hydrates
 * and attaches onLoad/onError; that event is then lost and a broken image
 * would never fall back. Once mounted, replay the settled outcome for `src`.
 * Handlers must be idempotent: a late real event can arrive as well.
 */
export function useReplayedImageEvents(ref: RefObject<HTMLImageElement | null>, src: string | null | undefined) {
  useEffect(() => {
    const img = ref.current;
    const missed = missedImageEvent(img, src);
    if (img && missed) img.dispatchEvent(new Event(missed));
  }, [ref, src]);
}
