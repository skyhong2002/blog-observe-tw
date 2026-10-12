'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { mediaIconClass, mediaIconSource, mediaIcons } from '@/lib/media-icons';
import { useReplayedImageEvents } from './image-events';

// One request for all mounted icons; monthly refreshes need no Next rebuild.
let currentIcons = mediaIcons;
let loading = false;
let freshUntil = 0;
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!loading && Date.now() > freshUntil) {
    loading = true;
    fetch('/api/icons', { signal: AbortSignal.timeout(5000) })
      .then(async (response) => {
        if (!response.ok) return;
        currentIcons = { ...mediaIcons, ...(await response.json()) };
        for (const notify of listeners) notify();
      })
      .catch(() => undefined)
      .finally(() => {
        loading = false;
        freshUntil = Date.now() + 60_000;
      });
  }
  return () => {
    listeners.delete(listener);
  };
}
const getIcons = () => currentIcons;
const getServerIcons = () => mediaIcons;

// The single place that turns a media id into its mark. Logos live in
// web/public/favicons (manifest: app/data/favicon-local.json); outlets without
// a reviewed logo show their first character so rows stay aligned. `iconUrl`
// (from the payload) lets server rendering show the logo before the manifest loads.
// Stored logos load as same-origin WebP derivatives sized for the icon; a missing
// derivative falls back to the stored PNG, then the next source, then the glyph.
export default function MediaIcon({
  media,
  iconUrl,
  title,
  size = 14,
  rem = false,
  className = '',
}: {
  media: string;
  /** The payload's icon URL; null or absent leaves only the /api/icons manifest. */
  iconUrl?: string | null;
  title?: string | null;
  size?: number;
  /** Size in rem (size / 16), for layouts that scale with the root font size. */
  rem?: boolean;
  className?: string;
}) {
  const icons = useSyncExternalStore(subscribe, getIcons, getServerIcons);
  const [failed, setFailed] = useState<string[]>([]);
  const source = mediaIconSource(media, icons, iconUrl, failed, size);
  const ref = useRef<HTMLImageElement>(null);
  useReplayedImageEvents(ref, source?.src);
  const px = (n: number) => (rem ? `${n / 16}rem` : n);
  const box = { width: px(size), height: px(size) };
  if (source) {
    const { src } = source;
    return (
      // A plain <img>: next/image cannot take the derivative srcSet. A fresh
      // element per source, so a dropped srcSet cannot race the new src.
      <img
        key={src}
        ref={ref}
        src={src}
        srcSet={source.srcSet}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed((previous) => (previous.includes(src) ? previous : [...previous, src]))}
        style={box}
        className={`shrink-0 rounded-sm object-contain ${source.local ? mediaIconClass(media, icons) : ''} ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ ...box, fontSize: px(Math.round(size * 0.65)) }}
      className={`inline-flex shrink-0 items-center justify-center rounded-sm bg-zinc-200 leading-none text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200 ${className}`}
    >
      {Array.from(title || media)[0]}
    </span>
  );
}
