'use client';
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="space-y-4 py-12">
      <h1 className="text-2xl font-semibold">資料暫時無法載入</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">請稍後再試。這不表示目前沒有收錄資料。</p>
      <button type="button" onClick={reset} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">
        重新載入
      </button>
    </section>
  );
}
