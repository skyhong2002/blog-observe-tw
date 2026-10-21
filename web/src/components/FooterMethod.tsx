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
      <p>沒有資料的區塊留白，資料暫時載入失敗時只寫「暫時無法載入」；留白或載入失敗都不表示沒有收錄、沒有符合的結果或數量為 0。</p>
      {pathname === '/' ? (
        <>
          <h3 className={heading}>首頁的部落格引用與話題</h3>
          <p>
            最近的部落格引用：近 90 天文章正文裡直接連到其他已收錄部落格的連結，依發文時間列出最近 8
            筆。只列文章用句子寫到對方的連結：連結以外至少 12 個字且成句；只有署名、來源標示或連結清單的，以及同一篇文章連到同一部落格超過 5
            次（多為轉載）的不列入首頁，但仍計入關係圖。同一篇文章對同一部落格只列一筆，同一篇文章連到幾個部落格就在同一張卡片列出幾筆，兩個方向是不同的文章、各自保留日期。側欄、Blogroll、留言、共同標籤與文字相似都不列入，也不代表雙方交流。每個被連到的部落格下方引出原文中含有連結的那一句（最多兩行），連結文字可點到原文實際引用的頁面，前後有省略時以「…」標示。
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
          <p>近期沒有可列出的正文引用或共同話題時，該區留白；留白不代表各站之間沒有連結或共同話題。</p>
        </>
      ) : null}
      {pathname === '/mentions/' ? (
        <>
          <h3 className={heading}>部落格引用</h3>
          <p>
            文章正文裡直接連到其他已收錄部落格的連結，依發文時間由新到舊列出，往下捲動會接著載入更早的文章（每次 12
            篇），不限期間。挑選方式與首頁相同：只列文章用句子寫到對方的連結：連結以外至少 12
            個字且成句；只有署名、來源標示或連結清單的，以及同一篇文章連到同一部落格超過 5
            次（多為轉載）的不列入，但仍計入關係圖。同一篇文章連到幾個部落格就在同一張卡片列出幾筆，兩個方向是不同的文章、各自保留日期。側欄、Blogroll、留言、共同標籤與文字相似都不列入，也不代表雙方交流。每個被連到的部落格下方引出原文中含有連結的那一句（最多兩行），前後有省略時以「…」標示。
          </p>
        </>
      ) : null}
      {pathname === '/blogs/' ? (
        <>
          <h3 className={heading}>部落格與文章數</h3>
          <p>收錄狀態是本站確認來源的方式（名單自動收錄、RSS 自動驗證、已核對網站）。</p>
          <p>
            類型是各部落格頁的「部落格類型」：一個部落格可以有好幾個，由 AI
            初判起頭，登入的讀者可以同意、不同意，或自己輸入新的類型。篩選與數字只算目前顯示的類型；「未分類」是還沒有任何顯示中類型的部落格。表格每列最多列出
            3 個。
          </p>
          <p>沒有近期文章不代表網站失效。robots 欄只公開顯示該站 robots.txt 對本站爬蟲寫了什麼，不影響抓取。</p>
          <p>
            作者欄是各站 RSS 與首頁署名的人數。RSS 只寫 email 或「Unknown」「admin」這類預設值時不算署名，也不公開 email；RSS
            沒寫作者時改看首頁的作者標記（JSON-LD、meta author、h-card），不拿網站名稱當作者。哪裡都沒有署名時顯示「—」，不代表沒有作者。
          </p>
          <p>
            經營者只依證據判定，不猜：首頁寫明編輯部、公司、商店等是「組織」；首頁以第一人稱介紹自己，或只署名一位作者是「個人」；署名三位以上是「多人」。只有兩個署名（常是同一人的兩種寫法）或沒有署名時是「未確認」。首頁每
            30 天重新讀一次。流量大小不列入判斷：很多高流量網站是一個人經營的。
          </p>
          <p>
            「匯出 OPML」把目前篩選出的部落格（不分頁，最多 1,000 個）的 RSS／Atom 整理成訂閱清單，可匯入 RSS
            閱讀器；沒有可用訂閱來源的部落格不會列入。
          </p>
          <p>
            登入的讀者可以在待查清單頁上方的「新增部落格」輸入網址，或用網址搜尋找不到時直接新增。新增後不經人工審核，由系統自動檢查首頁、RSS
            與個人網站特徵，通過就收錄；沒通過的會留在待查清單，之後重新檢查。
          </p>
        </>
      ) : null}
      {pathname === '/queue/' ? (
        <>
          <h3 className={heading}>待查清單</h3>
          <p>
            列出系統發現或讀者新增、等待收錄的網站：BlogBlog.Club、IndieWeb 與 IndiePing
            名單、已收錄文章裡連到的網站、部落格的友站連結，以及讀者在搜尋找不到時新增的網址。站主要求排除的網站與讀者私人匯入的 OPML
            不列出。
          </p>
          <p>
            每個網站都由系統自動檢查，不經人工審核：首頁要打得開、要有可讀的 RSS／Atom 或文章
            sitemap、網站名稱要和訂閱來源一致，並且要能確認是個人部落格（BlogBlog.Club 名單上的網站免這一項；IndieWeb 與 IndiePing
            名單上的網站，首頁是中文也免這一項）。個人部落格的判斷看首頁：簡介寫明是個人部落格，或首頁唯一的自我介紹區塊以第一人稱「我」介紹自己、沒有「我們」或公司團隊的字眼。讀者新增與名單上的網站優先檢查；每天的檢查量有上限，排到的才會檢查。
          </p>
          <p>
            本頁上方的「新增部落格」：輸入網址會先查是否已收錄或已在清單，沒有的話登入後就能新增，每人每天最多 20
            個。「未通過」寫的是最近一次檢查的原因；系統每週會重新檢查，網站改善後就可能通過。「未收錄」是管理員決定不收錄。「已收錄」連到本站的部落格頁。
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
            部落格類型：登入的讀者可以自由輸入新類型（最多 20
            字，用逗號或頓號可一次加好幾個），新增時同時投下一票同意，馬上顯示；不同意票追上同意票時隱藏。輸入時全形與半形、大小寫視為相同，「美食」「food」是同一個類型。AI
            初判在不同意票比同意票多 2 票以上時才隱藏。管理員覆寫優先，解除後恢復依票數判定。依同意人數排列；類型描述整個部落格，可能有誤。
          </p>
          <p>
            沒有資料的區塊與欄位不顯示。不顯示不代表沒有：沒有流量估計不代表沒有讀者，沒有辨識到技術不代表沒有使用，沒有列出引用不代表沒有交流。
          </p>
          <p>部落格資料：沒有近期文章不代表網站失效，抓取成功與發文時間分開記錄。</p>
          <p>內文來源：取得的內文只用於關鍵字、文章關係與站內搜尋；本站公開只顯示摘要與原文連結，全文請至原站閱讀。</p>
          <p>
            使用的技術：只重用收錄時已取得的公開回應被動辨識，不另外連線，是部分證據，不是完整的技術清單；只列出辨識到的項目，版本只在有明確證據時顯示。主機與
            CDN 只來自回應標頭等線索，代表網站可能經由哪裡提供，不代表用哪種 CMS
            寫成。最近一次觀測失敗或被來源阻擋時，列出的是上次成功觀測的結果，本站不會繞過限制。
          </p>
          <p>相關作者：署名依各站記錄，不憑相同筆名合併跨站作者。RSS 裡的 email 與「Unknown」這類預設值不算署名，也不公開。</p>
          <p>
            最近被這些部落格提到：近 365
            天、其他已收錄部落格的文章在正文的句子裡連到這個部落格，和首頁「最近的部落格引用」用同一套條件（只算正文連結；只放連結、署名或轉載不算），每篇文章列一次，最多
            10 篇。只看得到本站收錄的部落格，沒有列出不代表沒有人提到。
          </p>
          <p>
            最近常寫的話題：近 90 天文章標題或正文出現的共同關鍵字，是文章內容線索，不是作者身分分類；RSS
            自訂分類保留為原始資料，不另列話題。
          </p>
          <p>
            網站流量是 Similarweb 對整個網域的估算值，包含首頁與歷史內容，比例以造訪次數計，非精確 page
            views、不重複讀者，也不代表文章品質；低流量網站常沒有估計，不以零補值。
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
          <p>
            三種關係分開列出：只有正文直接引用計入「篇」（提及方提到對方的文章數）；非正文連結、共同標籤與文字相似都不是引用，也不加進篇數。核對清單的每筆是一條連結，同一篇文章連到多個網址會列成多筆，篇數以統計為準。沒有資料不代表沒有交流。
          </p>
          <p>共同標籤比的是發布者自己替文章加的原始標籤，不是本站的標籤詞庫；標籤相同不代表引用、交流或內容相似。</p>
          <p>
            文字相似只比對本站文章與它在正文裡直接連到的文章，看的是正規化正文前段的字面重疊，不是引用、語意相似、抄襲或交流；只從近期已觀測、且知道目標文章的正文直接連結裡選取配對，不是全面比對，沒有列出的文章不代表不相近。比對字數取正文前段，預覽取自公開摘要，比對用的正文不公開。
          </p>
          <p>共同標籤與文字相似在比對未開啟、尚未分析、暫時無法讀取或沒有結果時都不顯示；不顯示不代表沒有共同標籤或文字相近的文章。</p>
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
