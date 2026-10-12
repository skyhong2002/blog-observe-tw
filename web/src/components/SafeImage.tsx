'use client';

import { type CSSProperties, type ImgHTMLAttributes, useRef, useState } from 'react';
import { afterImageError, articleImageSources, imageAttempt, type PostImageWidth } from '@/lib/images';
import { useReplayedImageEvents } from './image-events';

// next/image `fill` layout: the parent box is positioned and sized by its CSS.
const FILL: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', color: 'transparent' };

// Blog images are displayed directly in the browser, never fetched by the Next image proxy.
// With a post ID one same-origin WebP derivative (`srcWidth`, no srcSet: see
// articleImageSources) comes first; if it fails, the original URL is tried exactly once,
// and only then does onError fire. Invalid sources render nothing; callers own the
// wrapper and drop it too (lib/images.ts).
export default function SafeImage({
  src,
  postId,
  srcWidth = 640,
  fill = false,
  alt = '',
  style,
  onLoad,
  onError,
  ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'sizes' | 'onLoad' | 'onError'> & {
  src: string | null | undefined;
  /** Public post ID; absent or invalid keeps the original URL only. */
  postId?: number | null;
  /** The single derivative width to request, sized for the caller's box. */
  srcWidth?: PostImageWidth;
  fill?: boolean;
  onLoad?: () => void;
  /** Called once both the derivative and the original failed. */
  onError?: () => void;
}) {
  const sources = articleImageSources(postId, src, srcWidth);
  const [failed, setFailed] = useState<string | null>(null);
  const current = imageAttempt(sources, failed !== null && failed === sources?.src);
  const ref = useRef<HTMLImageElement>(null);
  useReplayedImageEvents(ref, current?.src);
  if (!sources || !current) return null;
  const error = () => {
    const next = afterImageError(sources, failed, current.src);
    if (next.final) onError?.();
    else setFailed(next.failed);
  };
  return (
    // A plain <img>: same-origin derivatives must not go through the Next
    // image proxy. A fresh element per source, so no stale event leaks over.
    <img
      key={current.src}
      ref={ref}
      src={current.src}
      alt={alt}
      decoding="async"
      referrerPolicy="no-referrer"
      {...props}
      style={fill ? { ...FILL, ...style } : style}
      onLoad={onLoad}
      onError={error}
    />
  );
}
