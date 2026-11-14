'use client';
import Link from '@/components/NoPrefetchLink';
import StateNotice, { stateActionClass } from '@/components/StateNotice';
import TopicMethodFallback from '@/components/TopicMethodFallback';

// retry() re-fetches the segment's server data and re-renders it (reset() alone would redraw the same failure).
export default function ErrorPage({ retry }: { error: Error; retry: () => void }) {
  return (
    <>
      <div className="mx-auto max-w-2xl py-10">
        <StateNotice
          tone="error"
          headingLevel={1}
          title="這一頁暫時無法載入"
          extra={
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="button" onClick={() => retry()} className={stateActionClass(true)}>
                重新載入
              </button>
              <Link href="/" className={stateActionClass()}>
                回首頁
              </Link>
              <Link href="/api/status/" className={stateActionClass()}>
                服務狀態
              </Link>
            </div>
          }
        >
          資料暫時無法載入，請稍後再試。通常是伺服器正忙，等一下重新載入就會恢復。
        </StateNotice>
      </div>
      <TopicMethodFallback />
    </>
  );
}
