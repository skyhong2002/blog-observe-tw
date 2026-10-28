import { MySites } from '@/components/SiteParticipation';
import { privatePageMetadata } from '@/lib/seo';

export const metadata = privatePageMetadata('我的網站');
export default function MySitesPage() {
  return (
    <div className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">我的網站</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          驗證網站控制權，查看具名推薦與收錄進度。公開署名可使用筆名，登入 Email 不會公開。
        </p>
      </header>
      <MySites />
    </div>
  );
}
