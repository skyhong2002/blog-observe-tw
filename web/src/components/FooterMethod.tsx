'use client';

import { usePathname } from 'next/navigation';
import { shareExplanation } from '@/lib/relations';
import { METHOD_HREF } from '@/lib/site-nav';
import Link from './NoPrefetchLink';

const inlineLink = 'text-brand-700 underline underline-offset-2 dark:text-brand-400';
const heading = 'font-medium text-zinc-900 dark:text-zinc-100';

// Pages that show relations: one blog's profile (BlogRelations links here) and the
// site-wide map. Not the /blogs/ directory, nor anything under a profile.
export const RELATIONS_METHOD = /^\/(blogs\/[^/]+|relations)\/?$/;

// Which method blocks explain which pages; anything unlisted gets 資料來源.
function sectionsFor(pathname: string) {
  return (
    <>
      <h3 className={heading}>資料來源</h3>
      <p>
        從部落格公開的 RSS、Atom 與 sitemap 收錄文章標題、摘要及原文連結，保留來源與發現路徑。部落格更新頻率不同，不以最近發文日期判定失效。
      </p>
      <p>標籤保留原站、社群與人工整理的來源；同名作者不會自動跨站合併。候選站經確認後才納入追蹤。</p>
      {pathname === '/' ? (
        <>
          <h3 className={heading}>首頁的正文引用與話題</h3>
          <p>
            最近的正文引用：近 90 天文章正文裡直接連到其他已收錄部落格的連結，依發文時間列出最近 8
            筆。只列文章用句子寫到對方的連結：連結以外至少 12 個字且成句；只有署名、來源標示或連結清單的，以及同一篇文章連到同一部落格超過 5
            次（多為轉載）的不列入首頁，但仍計入關係圖。同一篇文章對同一部落格只列一筆，同一篇文章連到幾個部落格就在同一張卡片列出幾筆，兩個方向是不同的文章、各自保留日期。側欄、Blogroll、留言、共同標籤與文字相似都不列入，也不代表雙方交流。每個被連到的部落格下方引出原文中含有連結的那一句（最多兩行），前後有省略時以「…」標示。
          </p>
          <p>
            最近共同話題（前 8 名）與首頁文字雲（同一份排行，最多 30 個）只取近 30 天共同關鍵字詞庫的排行，不使用各站原始 RSS
            分類，且至少兩個部落格參與。
          </p>
          <p>
            排行看熱度與參與的部落格數，不看篇數多寡：熱度＝近 30 天提到這個詞的文章數，除以依它過去一年的平常比例推算的預期篇數（兩邊各加 5
            篇平滑，避免只有幾篇就衝到最前）；再乘上 log₂(1＋參與部落格數)。平常就寫很多的詞熱度約
            1，會排在最近明顯變多、而且很多站都在寫的詞後面。同站對同一詞的貢獻逐篇遞減，大量發文的站不會獨占。
          </p>
          <p>
            文字雲只畫文章的主題：近 30
            天提到某個詞的文章裡，標題有寫到它的不到三分之一，表示多半只是在正文順帶提到，這個詞仍留在排行，但不畫進文字雲。
          </p>
          <p>
            排行另略過背景詞：在長期基準期間大多只出現在正文、標題少有提及，又沒有任何部落格在自己文章的標籤或分類寫明的詞。長期基準與近 30
            天分開計算；這些詞只是不列入排行與文字雲，仍保留在詞庫、話題頁與歷史文章，也沒有另設詞彙清單。門檻數字見話題排行頁的計算方式。
          </p>
        </>
      ) : null}
      {RELATIONS_METHOD.test(pathname) ? (
        <>
          <h3 className={heading}>引用與交流</h3>
          <p>
            正文直接引用：同一篇對同一站重複連結只算 1 篇；兩個方向的提及各自保留文章日期，相隔多久都只表示雙方都曾提及，不代表同時互動。
          </p>
          <p>{shareExplanation}</p>
          <p>非正文連結來自 Blogroll、側欄與留言，與正文分開保存，不進入篇數、排行或全站關係圖。</p>
          <p>共同標籤比的是發布者自己替文章加的原始標籤，不是本站的標籤詞庫；標籤相同不代表引用、交流或內容相似。</p>
          <p>文字相似目前沒有計算，因此不顯示任何百分比或相似文章。</p>
        </>
      ) : null}
    </>
  );
}

// Topic pages and /tech/ render this block themselves, after their content, with the
// payload's notes (components/public/TopicMethod.tsx, TechStats.tsx); the layout's
// footer leaves it out there so a page never has two. When that page never
// mounts (app/error.tsx, app/not-found.tsx), TopicMethodFallback renders it instead.
export const OWN_METHOD = /^\/(topics|tech)(\/|$)/;

// The footer's collapsible 資料來源與計算方式: the blocks for this page, the page's
// own notes, then a link to the full write-up. Hidden on that page itself.
// `page` marks the copy a page renders itself (see OWN_METHOD).
export default function FooterMethod({ notes, page = false }: { notes?: React.ReactNode; page?: boolean }) {
  const pathname = usePathname();
  if (pathname === METHOD_HREF || `${pathname}/` === METHOD_HREF) return null;
  if (!page && OWN_METHOD.test(pathname)) return null;
  return (
    <details className="group border-t border-zinc-200 dark:border-zinc-800">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium text-zinc-900 dark:text-zinc-100 hover:text-brand-700 dark:hover:text-brand-400 [&::-webkit-details-marker]:hidden">
        <span>
          本頁的資料來源與計算方式
          <span className="ml-1 text-xs font-normal text-brand-700 dark:text-brand-400" aria-hidden="true">
            ⓘ
          </span>
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
          className="shrink-0 transition-transform group-open:rotate-180"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      {/* The anchor sits inside <details> so /#method opens it (browsers reveal fragment targets). */}
      <div id="method" className="max-w-3xl scroll-mt-32 space-y-2.5 pb-5 text-[13px] leading-[1.9]">
        {sectionsFor(pathname)}
        {notes}
        <p>
          <Link href={METHOD_HREF} className={inlineLink}>
            完整的資料來源與計算方式 →
          </Link>
        </p>
      </div>
    </details>
  );
}
