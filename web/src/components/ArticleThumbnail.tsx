'use client';

import Link from 'next/link';
import { useState } from 'react';
import SafeImage from './SafeImage';

export default function ArticleThumbnail({ src, href, title }: { src: string | null; href: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (!src) return null;
  return (
    <Link
      data-vital-region="article-thumbnail"
      href={href}
      tabIndex={-1}
      aria-label={`閱讀：${title}`}
      className="mt-0.5 block aspect-[16/11] w-16 flex-none overflow-hidden rounded bg-zinc-100 sm:w-20 dark:bg-zinc-800"
    >
      {!failed && (
        <SafeImage
          src={src}
          alt=""
          width={320}
          height={220}
          sizes="(max-width: 640px) 64px, 80px"
          className="aspect-[16/11] w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </Link>
  );
}
