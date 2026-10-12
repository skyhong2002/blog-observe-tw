import MediaTabs from '@/components/MediaTabs';
export default function TrafficPage() {
  return (
    <div className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">部落格流量與排名</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">流量估計有來源與取樣限制，不能直接代表文章品質或真實讀者人數。</p>
      </header>
      <MediaTabs current="traffic" />
      <section className="rounded-xl border border-zinc-300 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">目前尚未提供流量估計</h2>
        <p className="mt-3 text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          來源資料核對完成後才會顯示。尚未核對的月份與單位，不會被換算成排行。
        </p>
        <p className="mt-3 text-sm leading-7 text-zinc-600 dark:text-zinc-400">目前以部落格原站、公開訂閱來源與文章索引作為探索入口。</p>
      </section>
    </div>
  );
}
