'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { shareExplanation } from '@/lib/relations';
import { METHOD_HREF } from '@/lib/site-nav';
import Link from './NoPrefetchLink';

const inlineLink = 'text-brand-700 underline underline-offset-2 dark:text-brand-400';
export const methodHeading = 'font-medium text-zinc-900 dark:text-zinc-100';
const heading = methodHeading;

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
      {pathname === '/blogs/' ? (
        <>
          <h3 className={heading}>部落格與文章數</h3>
          <p>
            收錄狀態是本站確認來源的方式（名單自動收錄、RSS
            自動驗證、已核對網站）；分類沿用收錄時的舊分類，讀者投票的部落格類型在各部落格頁。
          </p>
          <p>沒有近期文章不代表網站失效。robots 欄只公開顯示該站 robots.txt 對本站爬蟲寫了什麼，不影響抓取。</p>
          <p>
            用網址搜尋找不到時，登入的讀者可以新增這個部落格。新增後不經人工審核，由系統自動檢查首頁、RSS
            與個人網站特徵，通過就收錄；沒通過的會留在待查清單，之後重新檢查。
          </p>
        </>
      ) : null}
      {pathname === '/ranking/' ? (
        <>
          <h3 className={heading}>標籤收錄排行</h3>
          <p>先依參與部落格數，再依已收錄文章數排列。這是收錄概況，不是品質評分、閱讀人次或升溫趨勢。</p>
        </>
      ) : null}
      {pathname === '/tags/' ? (
        <>
          <h3 className={heading}>標籤與主題</h3>
          <p>從部落格與文章標籤探索不同作者的書寫。人工與社群標籤保留來源，與爬蟲標籤分開記錄。</p>
        </>
      ) : null}
      {/^\/blogs\/[^/]+\/?$/.test(pathname) ? (
        <>
          <h3 className={heading}>部落格頁</h3>
          <p>最新收錄依發文時間排列，本站只顯示標題與摘要，完整內容請至原站閱讀；頁內搜尋只查這個部落格最新收錄文章的標題與摘要。</p>
          <p>近期話題只列前 20 個。閱讀線索由 AI 依已收錄的網站資訊與文章整理，可能不完整，請以作者原文為準；人工覆寫時會標示。</p>
          <p>
            部落格類型：AI 初判在不同意票比同意票多 2 票以上時才隱藏；讀者提議須淨同意達 2
            票。管理員覆寫優先，解除後恢復依票數判定。類型描述整個部落格，可能有誤。
          </p>
          <p>網站流量是 Similarweb 對整個網域的估算值，比例以造訪次數計，非精確 page views，也不代表文章品質。</p>
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
          <p>
            三種關係分開列出：只有正文直接引用計入「篇」（提及方提到對方的文章數）；非正文連結、共同標籤與文字相似都不是引用，也不加進篇數。核對清單的每筆是一條連結，同一篇文章連到多個網址會列成多筆，篇數以統計為準。沒有資料不代表沒有交流。
          </p>
          <p>共同標籤比的是發布者自己替文章加的原始標籤，不是本站的標籤詞庫；標籤相同不代表引用、交流或內容相似。</p>
          <p>
            文字相似只比對本站文章與它在正文裡直接連到的文章，看的是正規化正文前段的字面重疊，不是引用、語意相似、抄襲或交流；尚未分析時不顯示任何百分比或相似文章。
          </p>
        </>
      ) : null}
    </>
  );
}

// Pages whose explanations depend on their data (topics, /tech/, /traffic/, /articles/, /relations/)
// render this block themselves, after their content, with those notes
// (TopicMethod.tsx, TechStats.tsx, SimilarwebTraffic.tsx, Articles.tsx); the layout's
// footer leaves it out there so a page never has two. When that page never
// mounts (app/error.tsx, app/not-found.tsx), TopicMethodFallback renders it instead.
// Every page keeps its explanatory small print here, not under the title.
export const OWN_METHOD = /^\/(topics|tech|traffic|articles|relations)(\/|$)/;

// The footer's collapsible 資料來源與計算方式: the blocks for this page, the page's
// own notes, then a link to the full write-up. Hidden on that page itself.
// `page` marks the copy a page renders itself (see OWN_METHOD).
export default function FooterMethod({ notes, page = false }: { notes?: React.ReactNode; page?: boolean }) {
  const pathname = usePathname();
  const block = useRef<HTMLDetailsElement>(null);
  // The headers' 資料來源與計算方式 ⓘ (MethodLink) jumps to #method: open the block it points into.
  useEffect(() => {
    const open = () => {
      if (window.location.hash === '#method' && block.current) block.current.open = true;
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);
  if (pathname === METHOD_HREF || `${pathname}/` === METHOD_HREF) return null;
  if (!page && OWN_METHOD.test(pathname)) return null;
  return (
    <details ref={block} className="group border-t border-zinc-200 dark:border-zinc-800">
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
