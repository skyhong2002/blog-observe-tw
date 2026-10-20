'use client';
import Link from '@/components/NoPrefetchLink';
import TopicMethodFallback from '@/components/TopicMethodFallback';

// retry() re-fetches the segment's server data and re-renders it (reset() alone would redraw the same failure).
export default function ErrorPage({ retry }: { error: Error; retry: () => void }) {
  return (
    <>
      <section className="space-y-4 py-12">
        <h1 className="text-2xl font-semibold">這一頁暫時無法載入</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">資料暫時無法載入，請稍後再試。</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-full bg-brand-700 px-4 py-2 text-sm text-white hover:bg-brand-800"
          >
            重新載入
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
