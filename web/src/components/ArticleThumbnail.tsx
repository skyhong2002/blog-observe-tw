'use client';

import { useState } from 'react';
import { articleImage, type ImageState } from '@/lib/images';
import Link from './NoPrefetchLink';
import SafeImage from './SafeImage';

/** Optional list thumbnail. No valid image, or a failed load, removes the link
 * and its box entirely so the row falls back to the text-only layout. */
export default function ArticleThumbnail({ src, href, title }: { src: string | null; href: string; title: string }) {
  const image = articleImage(src);
  const [settled, setSettled] = useState<{ src: string; state: ImageState } | null>(null);
  const state: ImageState = settled && settled.src === image ? settled.state : 'loading';
  if (!image || state === 'error') return null;
  const setState = (next: ImageState) => setSettled({ src: image, state: next });
  return (
    <Link
      data-vital-region="article-thumbnail"
      data-image-state={state}
      href={href}
      tabIndex={-1}
      aria-label={`閱讀：${title}`}
      className="mt-0.5 block aspect-[16/11] w-16 flex-none overflow-hidden rounded data-[image-state=loading]:bg-zinc-100 sm:w-20 dark:data-[image-state=loading]:bg-zinc-800"
    >
      <SafeImage
        src={image}
        alt=""
        width={320}
        height={220}
        sizes="(max-width: 640px) 64px, 80px"
        className="aspect-[16/11] w-full object-cover"
        onLoad={() => setState('loaded')}
        onError={() => setState('error')}
      />
    </Link>
  );
}
