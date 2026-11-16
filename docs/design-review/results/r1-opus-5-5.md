# r1 blind review: opus-5-5

Calibration round: the new set is a byte-identical copy of the baseline (main at ebffbef), so it measures nothing about a change; it gives the first issue list. The reviewer noticed the two sets are identical. Reviewer: claude-proxy claude-opus-5-5, effort high, fresh context.

- Brief: `brief.md`, SHA-256 `8c002ebe6e72b6b5d322e5b350d797c3893501d769f40f68703ea872fbef5539`
- Mapping (revealed after the review): **A = new**, **B = baseline**, **C = reference**
- New set: `r1-new`

| Set | Mean of 12 scores |
|---|---:|
| new (A) | 6.08 |
| baseline (B) | 6.08 |
| reference (C) | 6.5 |

| 項目 | new | baseline | reference |
|---|---:|---:|---:|
| 資訊層級 | 6.5 | 6.5 | 7.5 |
| 字體排印 | 6.5 | 6.5 | 7 |
| 色彩 | 6.5 | 6.5 | 8 |
| 間距與版面 | 6 | 6 | 6.5 |
| 一致性 | 6 | 6 | 6.5 |
| 資訊密度 | 7 | 7 | 6.5 |
| 導覽 | 6 | 6 | 6.5 |
| 狀態與回饋 | 6 | 6 | 4 |
| 響應式 | 6 | 6 | 7 |
| 文案 | 5.5 | 5.5 | 8 |
| 無障礙 | 5.5 | 5.5 | 6.5 |
| 動畫與轉場 | 5.5 | 5.5 | 4 |

Raw reviewer output below, unedited.

---

## 組 A
一句話總評：功能完整、資料豐富，綠色單一主色加上襯線字標，品牌輪廓清楚。不過狀態呈現有好幾處互相矛盾，內部術語外露，篩選結果被大量晶片蓋過，手機表格被截斷，整體停在「好用但粗糙」。（A 與 B 的 94 張截圖逐檔比對完全相同，所以兩組分數與問題相同。）

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 6.5 | home_desktop：頁首沒有字標，導覽列直接從「文章」開始。字標放在文字雲中央，旁邊是「教學／軟體／菜單／中文」等大號綠字，只有一行「每一種生活，各自怎麼寫」，沒有說明這是什麼網站、能做什麼。下方三欄（統計、引用、最新文章）的主次清楚。blog_desktop：部落格名、追蹤按鈕、收錄 1,044 篇的層級正確。ranking_desktop：前十名長條圖放在表格前，重點突出。 |
| 字體排印 | 6.5 | 襯線字標配無襯線內文，有辨識度。blogs_desktop 與 topic_desktop 的表格內文約 12–13px，日期、網址等次要資訊約 11px 淺灰，讀起來吃力。articles_desktop 每則都附完整網址，長網址讓版面變碎。手機版字級合理（topic_mobile 標題約 17px，行高舒適）。中英混排沒有看到斷行錯誤。 |
| 色彩 | 6.5 | 全站單一綠色，用在連結、使用中分頁、CTA 與長條圖，有系統但偏單調。語意色很少：login-error 的「登入未完成」與 relations-error 的錯誤都是灰框黑字，沒有警示色；只有 blog_desktop 的「部分取得」用了橘色。深色模式（topics-dark、ranking-dark、about-dark）用純黑底配亮綠，可以成立，但綠色字在黑底上大面積出現時有點刺眼。 |
| 間距與版面 | 6 | home_desktop 的灰色底板在內容結束後還往下延伸約 700px 空白（截圖 1500–2187px）。topics_desktop 與 topics-loading_desktop 的標題上下各有約 150px 空白。blogs_desktop 有三層篩選晶片，占了約 300px 高。about_desktop 內文只用到左側約 760px，右側大片空白。blog_desktop 的雙欄與側欄卡片對齊良好。 |
| 一致性 | 6 | 期間切換有兩種樣式：topics_desktop 是綠色實心膠囊「近 30 天」，topic_desktop 與 relations_desktop 卻是灰色分段控制。relations_desktop 的分頁籤放在標題上方，其他頁都是標題在上、分頁籤在下。卡片、圓角、灰色分段控制大致統一。每一頁（包括 not-found、login）都有「本頁的資料來源與計算方式」折疊區。 |
| 資訊密度 | 7 | blogs_desktop 一屏約 50 列，有 9 個欄位，資訊量大。articles_desktop 每則有標題、標籤、來源、時間、網址與縮圖，密度高但雜訊多。topic_desktop 左右雙欄同時放部落格與文章，用得很好。tags_mobile 光標籤晶片就占滿整個 1688px 截圖。 |
| 導覽 | 6 | 桌面導覽列用分隔線分組（文章 標籤｜引用｜話題｜部落格 流量｜追蹤 API），目前位置用淺綠底標示，清楚。menu-open_mobile 用「看文章／看關係／看話題／看部落格／我的」分組，但沒有標出目前所在頁。tags-selected_desktop 的標題變成「部落格 ・ 標籤」，選中的標籤在晶片中看不出來，也沒有清除方式。blog_desktop 有麵包屑，topic_desktop 有「← 話題排行」返回連結，這兩點好。 |
| 狀態與回饋 | 6 | 做得好的：home-error_desktop 有「這一頁暫時無法載入」加上「重新載入／回首頁／服務狀態」三個出路；topics-loading 有骨架和「正在載入近 30 天的話題…」。有問題的：topics-trending_desktop 顯示錯誤框「話題資料暫時無法載入」，同一狀態的 mobile 卻有完整資料；my-signed-in 兩種尺寸都顯示「0 個追蹤網站／還沒有追蹤的網站」，與「追蹤三個部落格」的狀態矛盾；blog-sparse_desktop 只有一行「尚未收錄文章。」，沒有下一步；topic-not-found 用的是通用 404 文案「請回到目錄」，沒有連回話題排行。 |
| 響應式 | 6 | blogs_mobile 的表格把名稱截成「小兔 bunnya…」「b…」，網址欄只剩一個字，右側還要橫向捲動。topics-trending_mobile 表格右緣有「›」，欄位被截。my-signed-in_mobile 的 curl 範例橫向溢出，被截在「'https」。blogs_mobile 的篩選晶片占了約 800 CSS px 才出現搜尋框。home_mobile 的頁首把字標換成搜尋框，排序有調整，不是單純縮放，這點合理。 |
| 文案 | 5.5 | 內部術語外露：blogs_desktop 的狀態晶片有「BlogBlog.Club 名單自動收錄 208」「IndiePing 名錄收錄 122」「已核對部落格入口 1」「網站管理者驗證收錄 4」；topics 表頭「標題／僅正文」配「610 / —」；topics-empty「共同關鍵字尚未完成同步。」；blog_desktop 的內文來源寫「RSS 全文 尚未取得內文・完整 2 篇」。同一功能叫法不一：導覽寫「引用」，頁名是「部落格關係圖」；導覽寫「追蹤」，頁名是「我的閱讀」；標籤頁名叫「標籤與主題」，在 ranking 的分頁籤上卻叫「探索標籤」。 |
| 無障礙 | 5.5 | 大量 11–12px 淺灰次要文字（blogs_desktop 的網址與時間、articles_desktop 的來源列）對比偏低。my-signed-in_desktop 的「建立金鑰」是白字配淡綠底，對比不足，看起來像停用。表格的排序圖示「⇕」極小。relations 圖譜下方有「圖中連結明細（78 條）」文字替代，這是加分。截圖中看不到焦點樣式。 |
| 動畫與轉場 | 5.5 | 依可見線索判斷：topics-loading 有骨架列，是好的。home-loading_desktop 畫面仍停在上一頁（資料來源頁），只在頁首下方有一條細綠進度線，字標淺綠反白。relations-loading_desktop 同樣停在資料來源頁，卻看不到任何讀取指示。menu-open_mobile 的選單有陰影，但沒有遮罩。動態本身無法驗證，給保守分數。 |

要保留的優點：
- topics_desktop／topics_mobile：文字雲裡的地名配臺灣與日本地圖剪影，很有個性，又切合「各地生活」的主題。
- topic_desktop：左欄「哪些部落格在寫」加右欄「相關文章」的雙欄結構，加上 topic_mobile 的「看哪些部落格在寫（44 個）↓」錨點，手機與桌機各自都安排得當。
- ranking_desktop／ranking_mobile：前十名水平長條圖加完整表格，數字靠右對齊並有千分位。
- home-error_desktop：錯誤頁同時給「重新載入、回首頁、服務狀態」三個出路。
- relations_desktop：力導向圖旁邊有「最常被提及」「互相提及」清單，加上可展開的連結明細，讓圖不是唯一的資訊來源。
- menu-open_mobile：手機選單依任務分組（看文章／看關係／看話題／看部落格／我的），比平鋪的清單好掃讀。

最重要的五個問題（由嚴重到輕微）：
1. [狀態與回饋] [topics-trending_desktop] [desktop] 同一狀態下，桌機顯示「話題資料暫時無法載入」錯誤框，手機（topics-trending_mobile）卻有完整排行 —— 使用者在桌機會以為功能壞了，也代表狀態處理可能不穩 —— 請維護者先確認 1:1 原圖；如果確實如此，要檢查升溫話題在桌機的載入流程，並讓錯誤框帶出期間與重試結果。
2. [狀態與回饋] [my-signed-in] [兩者] 狀態設定是已追蹤三個部落格，畫面卻顯示「0 個追蹤網站」和空狀態「還沒有追蹤的網站」 —— 追蹤清單是登入後的核心價值，顯示錯誤會讓人以為資料遺失 —— 確認追蹤清單的讀取；空狀態只在真正為 0 時出現。另外「建立金鑰」按鈕不應長得像停用狀態。
3. [導覽] [tags-selected] [兩者] 選了標籤之後，頁面仍先列出約 100 個標籤晶片，被選中的標籤沒有醒目標示，標題只寫「部落格 ・ 標籤」；desktop 的結果從約 1000px 才開始，mobile 在 1688px 內完全看不到結果 —— 使用者點了標籤卻看不到任何回饋 —— 選中後把晶片收合成「已選：#部落格 ×」，結果移到首屏，並在標題寫出標籤名稱。
4. [文案] [blogs_desktop] [兩者] 狀態篩選晶片外露資料管線術語（「BlogBlog.Club 名單自動收錄」「IndiePing 名錄收錄」「已核對部落格入口」），另見 topics 的「標題／僅正文 610 / —」、topics-empty 的「共同關鍵字尚未完成同步」、blog_desktop 內文來源的「尚未取得內文・完整」 —— 讀者看不懂，還會擠掉真正有用的分類篩選 —— 把收錄來源篩選移到進階或站務頁，欄位與空狀態改用讀者語言，例如「標題提到／只在內文提到」「這段期間還沒有共同話題」。
5. [響應式] [blogs_mobile] [mobile] 表格名稱被截成「小兔 bunnya…」，網址欄只剩一個字，需要橫向捲動；而且要先捲過約 800 CSS px 的篩選晶片才看得到列表。另見 topics-trending_mobile 表格欄位被截、my-signed-in_mobile 的 curl 範例溢出 —— 手機是主要使用情境之一，目錄是核心頁 —— 手機版改成卡片列表（名稱、網址、標籤、最新文章日期），篩選收進一個「篩選」按鈕打開的面板，程式碼區塊改成可換行或附複製按鈕。

## 組 B
一句話總評：與組 A 逐檔完全相同（94 張截圖的位元組都一樣），所以評分、證據與問題都和 A 一致。功能完整、品牌有輪廓，但狀態矛盾、術語外露、手機表格截斷等問題拉低了完成度。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 6.5 | home_desktop：頁首沒有字標，文字雲中央的字標旁只有「每一種生活，各自怎麼寫」，沒有說明網站的用途。下方三欄（698 個部落格、最近的部落格引用、最新更新的部落格）主次分明。ranking_desktop 長條圖在前、表格在後。 |
| 字體排印 | 6.5 | 襯線字標配無襯線內文。blogs_desktop 與 topic_desktop 的次要文字約 11px 淺灰；articles_desktop 每則附完整網址，雜訊多。手機字級與行高舒適（about_mobile、topic_mobile）。 |
| 色彩 | 6.5 | 全站單一綠色，有系統但偏單調。錯誤狀態（login-error、relations-error）都是灰框，沒有警示色。深色模式（topics-dark、ranking-dark）用純黑底加亮綠，可以成立。 |
| 間距與版面 | 6 | home_desktop 的灰色底板在內容後還有約 700px 空白。topics_desktop 標題上下約 150px 空白。blogs_desktop 的三層篩選晶片占約 300px。about_desktop 右側大片空白。 |
| 一致性 | 6 | 期間切換在 topics_desktop 是綠色實心膠囊，在 topic_desktop 與 relations_desktop 是灰色分段控制。relations_desktop 的分頁籤放在標題上方，其他頁相反。 |
| 資訊密度 | 7 | blogs_desktop 一屏約 50 列、9 欄。topic_desktop 雙欄利用寬螢幕。tags_mobile 的標籤晶片占滿整張截圖。 |
| 導覽 | 6 | 桌面導覽分組清楚，目前位置用淺綠底標示。menu-open_mobile 分組好，但沒有標出目前頁。tags-selected_desktop 看不出選了哪個標籤。blog_desktop 有麵包屑。 |
| 狀態與回饋 | 6 | home-error_desktop 有三個出路，topics-loading 有骨架。但 topics-trending_desktop 顯示錯誤、mobile 卻有資料；my-signed-in 顯示「0 個追蹤網站」，與已追蹤三個的狀態矛盾；blog-sparse_desktop 只有「尚未收錄文章。」。 |
| 響應式 | 6 | blogs_mobile 名稱被截成「小兔 bunnya…」並需要橫向捲動；topics-trending_mobile 欄位被截；my-signed-in_mobile 的 curl 範例溢出。home_mobile 的頁首有為手機重新排序。 |
| 文案 | 5.5 | blogs_desktop 有「IndiePing 名錄收錄」「已核對部落格入口」；topics-empty 有「共同關鍵字尚未完成同步。」；「引用」對上「部落格關係圖」、「追蹤」對上「我的閱讀」，命名不一。 |
| 無障礙 | 5.5 | 11–12px 淺灰次要文字對比低。my-signed-in_desktop 的「建立金鑰」白字配淡綠底。排序圖示極小。relations 有連結明細作為文字替代。 |
| 動畫與轉場 | 5.5 | topics-loading 有骨架。home-loading_desktop 只有頁首下的細綠進度線。relations-loading_desktop 停在上一頁，看不到讀取指示。動態無法驗證，給保守分數。 |

要保留的優點：
- topics_desktop：地名文字雲配地圖剪影，個性鮮明。
- topic_desktop／topic_mobile：雙欄結構，手機版有「看哪些部落格在寫（44 個）↓」錨點。
- ranking_desktop：前十名長條圖加千分位數字表格。
- home-error_desktop：「重新載入／回首頁／服務狀態」三個出路。
- relations_desktop：圖譜旁有「最常被提及」「互相提及」清單與連結明細。

最重要的五個問題（由嚴重到輕微）：
1. [狀態與回饋] [topics-trending_desktop] [desktop] 桌機顯示「話題資料暫時無法載入」，手機同一狀態卻有完整資料 —— 桌機使用者會以為功能壞掉 —— 先確認 1:1 原圖，再修桌機的升溫話題載入流程。
2. [狀態與回饋] [my-signed-in] [兩者] 已追蹤三個部落格，卻顯示「0 個追蹤網站」和空狀態 —— 登入後的核心價值顯示錯誤 —— 修正追蹤清單讀取，空狀態只在真正為 0 時出現。
3. [導覽] [tags-selected] [兩者] 選中的標籤不醒目，結果被約 100 個晶片推到下方，mobile 在 1688px 內看不到結果 —— 點了沒有回饋 —— 選中後收合晶片，顯示「已選：#標籤 ×」，結果放到首屏。
4. [文案] [blogs_desktop] [兩者] 篩選晶片與欄位外露內部術語（「IndiePing 名錄收錄」「標題／僅正文」「共同關鍵字尚未完成同步」），另見 topics_desktop、topics-empty、blog_desktop —— 讀者看不懂 —— 改用讀者語言，把來源篩選移到進階區。
5. [響應式] [blogs_mobile] [mobile] 表格名稱截斷並需要橫向捲動，篩選晶片占約 800 CSS px；另見 topics-trending_mobile、my-signed-in_mobile —— 核心目錄在手機上不好用 —— 改成卡片列表，篩選收進面板。

## 組 C
一句話總評：參考組的三個網站（ooh.directory、blogroll.org、BlogBlog.Club）各有鮮明個性與清楚的定位句，文案自然。但截圖完全沒有讀取、空資料、錯誤等狀態，彼此風格也不同，桌機寬度的利用偏保守。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7.5 | ooh-directory-home_desktop：頁首下方一行「A collection of 2,433 blogs about every topic」，接著是 14 個分類（含數量與子類），用途一眼就懂。blogroll-org_mobile：「You are viewing a humanly curated list of 1308 fine personal & independent blogs」加上兩顆 CTA。blogblog-club_desktop 用大標題和條列說明各區用途，但沒有任何內容預覽。 |
| 字體排印 | 7 | ooh-directory-recent_mobile 的內文約 17px，行高寬鬆，摘要好讀。ooh-directory-home_desktop 分類下的子類連結約 11px，偏小。blogroll-org_mobile 用圓體風格無襯線字，標題與描述的層級清楚。blogblog-club_desktop 是標準文件站字體。 |
| 色彩 | 8 | ooh.directory 用粉紅底配紫色連結與橘紅標題，加上線條圖示，個性非常強。blogroll.org 用淡綠底配黃色贊助區塊，語意區分明確。BlogBlog.Club 是白底配深色頁尾，偏預設。 |
| 間距與版面 | 6.5 | ooh-directory-home_desktop 在 1440 寬只用了中央約 860px，兩側大片粉色空白，主欄與側欄比例合理。blogblog-club_desktop 內容欄約 620px 寬，下方留白多。blogroll-org_mobile 卡片間距一致。 |
| 一致性 | 6.5 | 三個產品風格完全不同，無法跨站比較。單看 ooh.directory，home 與 recent 的標題底線、卡片底色、「more info」連結格式一致。blogroll.org 的晶片與卡片圓角一致。 |
| 資訊密度 | 6.5 | ooh-directory-home_desktop 首屏有分類總覽加第一則「First post in over a year!」摘要，資訊充足。ooh-directory-recent_mobile 每則摘要約 10 行，一屏只放得下一則半。blogblog-club_desktop 首頁只有條列連結，密度低。 |
| 導覽 | 6.5 | ooh.directory 有 Suggest／Blog／About 加搜尋，recent 頁有麵包屑「Home / Recently updated blogs」。blogroll-org_mobile 有「Filter by topic」晶片。ooh-directory-recent_mobile 的篩選要先選下拉選單再按「Filter」，多一步。BlogBlog.Club 導覽列有 6 項，加上 Ctrl+K 搜尋。 |
| 狀態與回饋 | 4 | 截圖只有一般資料狀態，沒有讀取中、空資料、錯誤、搜尋無結果或登入狀態，無法驗證。唯一的回饋線索是 ooh 的「2 minutes ago」等相對時間。依說明給保守分數。 |
| 響應式 | 7 | ooh-directory-recent_mobile 的頁首改成字標加三個連結加搜尋框直排，內容單欄，沒有溢出，但頁首約占 170 CSS px。blogroll-org_mobile 的卡片單欄合理，但「INTERVIEW」直書標籤貼在螢幕左緣卡片外，看起來被裁切。 |
| 文案 | 8 | 「First post in over a year!」「Because blogs are the soul of the web」「No algorithms ever!」語氣自然，有人味。BlogBlog.Club 的「推坑大家寫部落格」很口語，但條列中夾了「/about」「/party」等路徑碼，偏工程師語言。 |
| 無障礙 | 6.5 | ooh 的紫色小字（11px）放在粉底上，子類連結對比偏弱。ooh-directory-recent_mobile 的連結字大、點擊範圍充足。blogroll-org_mobile 的晶片高度約 26 CSS px，略小。截圖中看不到焦點樣式。 |
| 動畫與轉場 | 4 | 截圖沒有選單展開、骨架或狀態切換等任何線索，只有 BlogBlog.Club 的深色模式切換圖示。無法評估，給保守分數。 |

要保留的優點：
- ooh-directory-home_desktop：首屏一行定位句加上帶數量的分類總覽，用途與規模一眼可見。
- ooh-directory-home_desktop：「First post in over a year!」這類以事件為主的標題，把冷冰冰的更新列表變成故事。
- blogroll-org_mobile：「humanly curated」「No algorithms ever!」清楚傳達價值主張，主題篩選晶片集中在一個框內。
- ooh-directory-recent_mobile：手機上大字級、寬行高的摘要，加上「By 作者, 字數」，閱讀體驗好。
- blogblog-club_desktop：首頁條列說明每個區域的用途，對新手友善。

最重要的五個問題（由嚴重到輕微）：
1. [狀態與回饋] [全部截圖] [兩者] 沒有任何讀取、空資料、錯誤、無結果或登入狀態可以評估 —— 無法確認這些產品在異常情況下是否給出說明與下一步 —— 參考組應補擷取搜尋無結果、404 等狀態。
2. [間距與版面] [ooh-directory-home_desktop] [desktop] 1440 寬只用了中央約 860px，兩側大片粉色空白，分類子連結只有 11px —— 寬螢幕的空間浪費，小字不易點擊 —— 放寬主欄或改成三欄，子類字級至少 13px。
3. [響應式] [blogroll-org_mobile] [mobile] 「INTERVIEW」直書標籤貼在螢幕左緣卡片外，看起來被裁切 —— 這是唯一的特殊標記，卻像是版面壞掉 —— 把標籤移進卡片內，改成橫向小徽章。
4. [資訊密度] [blogblog-club_desktop] [desktop] 首頁只有大圖加條列連結，沒有最新文章或部落格預覽，條列中還夾著「/about」等路徑碼 —— 首次造訪的人看不到內容，就沒有動機往下探索 —— 加入最新投稿或隨機部落格預覽，拿掉路徑碼。
5. [導覽] [ooh-directory-recent_mobile] [mobile] 頁首直排約占 170 CSS px；篩選要先選下拉選單再按「Filter」 —— 手機首屏被導覽吃掉，篩選多一步 —— 頁首收成漢堡選單或單列，下拉選單選完就直接套用。

```json
{"A": {"scores": [6.5, 6.5, 6.5, 6, 6, 7, 6, 6, 6, 5.5, 5.5, 5.5], "issues": ["[狀態與回饋] topics-trending_desktop：桌機顯示「話題資料暫時無法載入」，同狀態 mobile 卻有完整資料", "[狀態與回饋] my-signed-in（兩者）：應已追蹤 3 個部落格，卻顯示「0 個追蹤網站／還沒有追蹤的網站」", "[導覽] tags-selected（兩者）：選中標籤不醒目，結果被約 100 個晶片推到下方，mobile 1688px 內看不到結果", "[文案] blogs_desktop 等：外露內部術語（IndiePing 名錄收錄、已核對部落格入口、標題／僅正文、共同關鍵字尚未完成同步）", "[響應式] blogs_mobile：表格名稱截斷且需橫向捲動，篩選晶片占約 800 CSS px；另見 topics-trending_mobile、my-signed-in_mobile 的 curl 溢出"]}, "B": {"scores": [6.5, 6.5, 6.5, 6, 6, 7, 6, 6, 6, 5.5, 5.5, 5.5], "issues": ["[狀態與回饋] topics-trending_desktop：桌機顯示「話題資料暫時無法載入」，同狀態 mobile 卻有完整資料", "[狀態與回饋] my-signed-in（兩者）：應已追蹤 3 個部落格，卻顯示「0 個追蹤網站／還沒有追蹤的網站」", "[導覽] tags-selected（兩者）：選中標籤不醒目，結果被約 100 個晶片推到下方，mobile 1688px 內看不到結果", "[文案] blogs_desktop 等：外露內部術語（IndiePing 名錄收錄、已核對部落格入口、標題／僅正文、共同關鍵字尚未完成同步）", "[響應式] blogs_mobile：表格名稱截斷且需橫向捲動，篩選晶片占約 800 CSS px；另見 topics-trending_mobile、my-signed-in_mobile 的 curl 溢出"]}, "C": {"scores": [7.5, 7, 8, 6.5, 6.5, 6.5, 6.5, 4, 7, 8, 6.5, 4], "issues": ["[狀態與回饋] 全部截圖：沒有讀取、空資料、錯誤、無結果等狀態可評估", "[間距與版面] ooh-directory-home_desktop：1440 寬只用中央約 860px，分類子連結僅 11px", "[響應式] blogroll-org_mobile：INTERVIEW 直書標籤貼在左緣卡片外，看似被裁切", "[資訊密度] blogblog-club_desktop：首頁只有大圖與條列連結，無內容預覽，夾雜 /about 等路徑碼", "[導覽] ooh-directory-recent_mobile：頁首直排約占 170 CSS px，篩選要下拉後再按 Filter"]}}
```
