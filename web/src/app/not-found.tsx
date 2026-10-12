import Link from 'next/link';
export default function NotFound() {
  return (
    <section className="space-y-4 py-12">
      <h1 className="text-2xl font-semibold">找不到這個頁面</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">網址可能已變更，請回到目錄繼續探索。</p>
      <Link href="/blogs/" className="text-sm text-brand-700 hover:underline dark:text-brand-400">
        前往部落格目錄 →
      </Link>
    </section>
  );
}
