import DiscoveryReview from '@/components/discovery-review';
export const dynamic = 'force-dynamic';
export default function DiscoveryReviewPage() {
  return (
    <section className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">部落格來源候選審核</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          候選來源保留發現頁面、RSS 偵測與部落卷證據；批次決定會留下稽核紀錄。
        </p>
      </header>
      <DiscoveryReview />
    </section>
  );
}
