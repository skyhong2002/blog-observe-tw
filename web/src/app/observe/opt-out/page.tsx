// Adapted from tag.observe.tw web/src/app/(site)/observe/opt-out/page.tsx, MIT, Copyright (c) 2026 Sky Hong.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE_NAME } from '@/lib/seo';
import OptOutToggle from './OptOutToggle';

// A static shell: the choice lives only in this browser and is read after hydration.
export const dynamic = 'force-static';
export const metadata: Metadata = {
  title: { absolute: `不計入統計 · ${SITE_NAME}` },
  description: '讓這個瀏覽器的造訪不送到 Google Analytics；可隨時恢復。',
  robots: { index: false, follow: true },
};

export default function OptOutPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">不計入統計</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          給測試或自己使用的瀏覽器：關閉後，這個瀏覽器在本站的瀏覽與點擊都不會送到 Google Analytics。統計方式見
          <Link href="/about/" className="text-brand-700 hover:underline dark:text-brand-400">
            資料來源與收錄方式
          </Link>
          。
        </p>
      </header>
      <OptOutToggle />
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
        <li>設定只存在這個瀏覽器的本站資料中。換瀏覽器、使用無痕視窗，或清除網站資料後，需要再設定一次。</li>
        <li>Safari 可能在 7 天沒有造訪本站後清除網站資料；測試用的 Safari 請定期確認狀態。</li>
        <li>
          自動化測試工具（Playwright、Puppeteer、Selenium、Lighthouse 等）與送出 Do Not Track／Global Privacy Control
          的瀏覽器預設不送統計，不需設定。
        </li>
        <li>登入、我的追蹤、管理與本頁等非公開頁面，以及帶查詢參數的網址，本來就不送統計。</li>
        <li>此設定不會回溯排除已送出的紀錄。</li>
      </ul>
    </div>
  );
}
