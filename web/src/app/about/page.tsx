import Link from '@/components/NoPrefetchLink';
import { staticPageMetadata } from '@/lib/seo';

export const metadata = staticPageMetadata('/about/');
export default function AboutPage() {
  return (
    <article className="max-w-3xl space-y-6 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">資料來源與收錄方式</h1>
        <p className="mt-2 text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          每一種生活，各自怎麼寫。部落格觀察整理公開部落格與訂閱資訊，讓閱讀回到作者自己的網站。
        </p>
      </header>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">我們收錄什麼</h2>
        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          來源包括種子名單、RSS、Atom、網站地圖與公開部落卷。候選站保留發現頁面與來源證據，經核對後才加入目錄；短文與圖片文也能被收錄。
        </p>
        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          文章內文依序從 RSS 全文、Atom 內容、平台 API 或文章頁 HTML
          取得，只用於關鍵字、文章關係與站內搜尋；本站公開只顯示摘要、搜尋片段與原文連結。各部落格頁的「內文來源」會說明取得方式與狀態。
        </p>
        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          爬蟲以可識別的 User-Agent（blog.observe.tw）抓取，會讀取各站的 robots.txt 並在部落格目錄公開其內容，但不依它停止抓取。站主若希望停止抓取或移除，請透過下方 GitHub 或 b@blog.observe.tw 聯絡。
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">更新與排行</h2>
        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          部落格有不同的更新步調。我們分開顯示最後發文與抓取成功時間，歷史文章也可匯入。標籤排行先依參與部落格數，再依已收錄文章數排列，不是升溫、品質或人氣評分。
        </p>
        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          話題排行只使用新文易數的共同關鍵字，比對文章標題與清理後的正文：標題出現的權重高於只在正文出現，同一篇只算一次，同站多篇逐篇遞減。單一字元、純數字或日期、雜訊與沿用來源排除清單的詞不參與比對；在上游宣布完整快照之前，共同關鍵字只涵蓋部分文章觀測窗口，不代表完整詞庫。
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">作者與標籤</h2>
        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          同名不等於同一作者；作者與站主分開建檔。人工、社群與來源提供的標籤分開記錄，爬蟲不覆寫人工判斷。
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">隱私與訂閱</h2>
        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          Google 登入用於建立帳號與管理追蹤。你可以透過個人 RSS 閱讀追蹤內容，或匯出 OPML 到自己的閱讀器。完整文章仍由原站提供。
        </p>
        <Link href="/my/" className="inline-block text-sm text-brand-700 hover:underline dark:text-brand-400">
          管理我的閱讀 →
        </Link>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">開放原始碼與更正</h2>
        <p className="text-sm leading-7 text-zinc-600 dark:text-zinc-400">
          本專案採 MIT License，前端基底移植自新文易數，保留原作者版權聲明。來源更正、移除與問題回報可於 GitHub 提出。
        </p>
        <a
          className="text-sm text-brand-700 hover:underline dark:text-brand-400"
          href="https://github.com/skyhong2002/blog-observe-tw/issues"
        >
          GitHub 問題回報 ↗
        </a>
      </section>
    </article>
  );
}
