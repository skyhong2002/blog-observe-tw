'use client';

import { useState } from 'react';
import SafeImage from '@/components/SafeImage';
import Wordmark from '@/components/Wordmark';
import styles from './home.module.css';

export default function NewsImage({ src, priority = false }: { src: string | null; priority?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={styles.picture} aria-hidden="true">
      <span className={styles.pictureFallback}>
        <Wordmark />
      </span>
      {src && !failed && (
        <SafeImage
          src={src}
          alt=""
          fill
          sizes={
            priority
              ? '(max-width: 640px) calc(100vw - 34px), (max-width: 1000px) calc(66vw - 36px), (max-width: 1152px) calc(52vw - 40px), 560px'
              : '(max-width: 640px) 26vw, (max-width: 1000px) 17vw, 150px'
          }
          fetchPriority={priority ? 'high' : undefined}
          loading={priority ? 'eager' : 'lazy'}
          className={styles.photo}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
