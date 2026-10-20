'use client';
import { useRouter } from 'next/navigation';
import { startTransition, useState } from 'react';
import Link from '@/components/NoPrefetchLink';
import TopicMethodFallback from '@/components/TopicMethodFallback';

// reset() alone only re-renders on the client; a server read that failed must be read again (router.refresh) first.
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  return (
    <>
      <section className="space-y-4 py-12">
        <h1 className="text-2xl font-semibold">這一頁暫時無法載入</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">資料暫時無法載入，請稍後再試。</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              startTransition(() => {
                router.refresh();
                reset();
                setRetrying(false);
              });
            }}
            className="rounded-full bg-brand-700 px-4 py-2 text-sm text-white hover:bg-brand-800 disabled:opacity-60"
          >
            {retrying ? '重新載入中…' : '重新載入'}
          </button>
          <Link href="/" className="rounded-full border border-zinc-300 px-4 py-2 text-sm hover:border-brand-700 dark:border-zinc-700">
            回首頁
          </Link>
          <Link href="/api/status/" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
            服務狀態
          </Link>
        </div>
      </section>
      <TopicMethodFallback />
    </>
  );
}
