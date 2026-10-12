'use client';

import { useState } from 'react';
import SafeImage from '@/components/SafeImage';
import { articleImage, type ImageState } from '@/lib/images';
import styles from './home.module.css';

/**
 * Optional homepage article image, including its link box. With no valid image,
 * or once the image fails to load, nothing renders at all: no Wordmark
 * placeholder, no fixed-size box and no empty anchor. The story keeps its
 * text-only layout. `data-image-state` exposes loading/loaded for styling.
 */
export default function NewsImage({
  src,
  postId,
  href,
  analytics,
  title,
  variant,
}: {
  src: string | null | undefined;
  /** Public post ID for the same-origin derivative; absent keeps the original URL. */
  postId?: number | null;
  href: string;
  /** `open_original` when href is the source article. */
  analytics?: string;
  title: string;
  variant: 'hero' | 'thumbnail';
}) {
  const image = articleImage(src);
  const [settled, setSettled] = useState<{ src: string; state: ImageState } | null>(null);
  const state: ImageState = settled && settled.src === image ? settled.state : 'loading';
  if (!image || state === 'error') return null;
  const priority = variant === 'hero';
  return (
    <a
      href={href}
      data-analytics={analytics}
      className={priority ? styles.heroImage : styles.thumbnail}
      data-image-state={state}
      tabIndex={-1}
      aria-label={`閱讀：${title}`}
      rel="noopener noreferrer"
    >
      <span className={styles.picture}>
        <SafeImage
          src={image}
          postId={postId}
          // One derivative per box (hero up to 560px, thumbnail up to 150px CSS).
          srcWidth={priority ? 640 : 320}
          alt=""
          fill
          fetchPriority={priority ? 'high' : undefined}
          loading={priority ? 'eager' : 'lazy'}
          className={styles.photo}
          onLoad={() => setSettled({ src: image, state: 'loaded' })}
          onError={() => setSettled({ src: image, state: 'error' })}
        />
      </span>
    </a>
  );
}
