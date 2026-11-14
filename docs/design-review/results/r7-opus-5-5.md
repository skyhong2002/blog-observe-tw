# r7 blind review: opus-5-5

Round 7 (skyhong-SM segment). Baseline = main at ebffbef and references, both shot on skyhong-SM for r6 and reused. New = commit 7474777 (round-6 fixes). Reviewer: claude-proxy claude-opus-5-5, effort high, fresh context (delegate_task).

- Brief: `brief.md`, SHA-256 `8c002ebe6e72b6b5d322e5b350d797c3893501d769f40f68703ea872fbef5539`
- Mapping (revealed after the review): **A = new**, **B = baseline**, **C = reference**
- New set: `r7`

| Set | Mean of 12 scores |
|---|---:|
| new (A) | 7.67 |
| baseline (B) | 6.33 |
| reference (C) | 6.5 |

| 項目 | new | baseline | reference |
|---|---:|---:|---:|
| 資訊層級 | 8 | 6.5 | 7 |
| 字體排印 | 7.5 | 7 | 7 |
| 色彩 | 7.5 | 7 | 8 |
| 間距與版面 | 7.5 | 6.5 | 6.5 |
| 一致性 | 7.5 | 6 | 7 |
| 資訊密度 | 8 | 7 | 6.5 |
| 導覽 | 8 | 7 | 6.5 |
| 狀態與回饋 | 8.5 | 5.5 | 4.5 |
| 響應式 | 8 | 5.5 | 7 |
| 文案 | 7.5 | 6 | 7.5 |
| 無障礙 | 7 | 6 | 6.5 |
| 動畫與轉場 | 7 | 6 | 4 |

Raw reviewer output below, unedited.

---

## 組 A
一句話總評：資訊架構和狀態頁是三組中最完整的，首頁、目錄、我的追蹤與錯誤頁都有清楚的說明和下一步；剩下的問題集中在標籤資料不一致、少數長名稱溢出，以及大片留白。（說明：本輪有一部分截圖讀取失敗，沒能看到。評分只根據實際看到的頁面：home、home-error、menu-open、blogs、blogs-empty、blog、articles、topics、topic、tags、ranking、relations、relations-loading、relations-error、my-signed-in、my-signed-out、login、login-error、about、not-found。）

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 8 | home_desktop：文字雲下方有介紹卡「收錄 698 個臺灣與華文的個人部落格…」，並有「看最新文章／逛部落格目錄／大家在寫什麼」三個入口，主次分明；ranking_desktop：上方是前十名長條圖，右側是摘要（列出的標籤 98、最多部落格在用：台中美食）。但 home_desktop 的 hero 灰底區下半部是空的。 |
| 字體排印 | 7.5 | 繁中內文行高舒適（about_desktop 段落約 28px 行距）；tags_desktop 熱門標籤字級較大，依熱度分出層次。但 topic_desktop 左欄「Ted https://adersaytech.com/」這類長名稱換行後，把註記「(標題提到 1、只在內文 0)」擠出卡片右緣；「Luke Smith&#39;s」的 HTML 實體直接顯示出來。 |
| 色彩 | 7.5 | 全站以單一綠色作為品牌與連結色，錯誤狀態用紅底紅框（home-error_desktop、relations-error_desktop、login-error_desktop），空資料用黃底（blogs-empty_desktop），語意色有系統；about-dark 成立。整體仍偏素，中性灰占比高。 |
| 間距與版面 | 7.5 | ranking_desktop 前 30 名分成兩欄、第 31–98 名收進折疊，善用寬螢幕；my-signed-in_desktop 的卡片節奏一致。但 relations_desktop 右欄在「怎麼讀這張圖」之後約有 400px 空白；home_mobile 的 hero 約在 y≈300–500 是一大段空白。 |
| 一致性 | 7.5 | 頁首、分頁籤（膠囊式 segmented）、圓角卡片、表格樣式在 blogs／ranking／relations 各頁統一；錯誤卡（圖示＋標題＋按鈕組）在 home-error、relations-error、login-error、not-found 用的是同一個模式。不過時間篩選的位置不一：topics_desktop 放右上，topic_desktop 放在標題下。 |
| 資訊密度 | 8 | blogs_desktop 一屏可見約 50 列，表格欄位齊全；blog_desktop 與 articles_desktop 的來源只顯示主機名稱（wiwi.blog、azofreeware.com），列表緊湊易掃讀；blogs_mobile 改成卡片，每張只放篇數、最新日期與兩個標籤。 |
| 導覽 | 8 | menu-open_mobile 按「看文章／看關係／看話題／看部落格／我的」分組，項目名稱具描述性（最新文章、部落格引用、大家正在寫什麼），也有「首頁」列；blog_desktop 有麵包屑；topic_desktop 有「← 話題排行」返回連結；頁名「我的追蹤」與導覽列的「追蹤」一致。 |
| 狀態與回饋 | 8.5 | home-error_desktop：紅卡有說明（「通常是伺服器正忙」）和「重新載入／回首頁／服務狀態」三個按鈕；blogs-empty_desktop：黃卡「目錄還沒有部落格」並提供「推薦部落格」CTA；login-error 說明原因（逾時或 Cookie 被擋）；relations-loading 同時有關係圖泡泡骨架和列表骨架；not-found 有三個去處。 |
| 響應式 | 8 | blogs_mobile 把表格改成卡片，篩選收進「篩選 ▾」；not-found_mobile 的三個按鈕改成全寬直排；my-signed-in_mobile 的 curl 指令分行顯示，不會橫向溢出。 |
| 文案 | 7.5 | 用詞自然且有情境（「登入以保存你的閱讀清單」「Google 沒有把登入結果交回來，可能是逾時或瀏覽器擋了 Cookie」）。但 tags_desktop 列出 #未分類 與 #Uncategorized，ranking_desktop 卻寫著「已略過部落格平台的預設分類（未分類、Uncategorized）」，兩頁自相矛盾。 |
| 無障礙 | 7 | 錯誤狀態同時用圖示和文字，不只靠顏色；手機按鈕夠大（not-found_mobile 全寬按鈕約 64px 高）。但 articles_desktop 每列的 #標籤 與 topics_desktop 表頭約 11px、淺灰色，對比偏低；topics_desktop 時間切換的選中態只有白底，辨識度弱。 |
| 動畫與轉場 | 7 | 靜態截圖只能看到：relations-loading 有「正在載入近 7 天的關係資料…」文字，加上圖與列表兩種骨架；menu-open_mobile 選單下緣有陰影，蓋在內容之上。看不到轉場本身，所以保守評分。 |

要保留的優點：
- 首頁介紹卡與三個主要 CTA（home_desktop、home_mobile），新訪客一眼看懂網站在做什麼。
- 錯誤、空資料、404 統一用「圖示＋標題＋原因＋多個下一步」卡片（home-error、blogs-empty、not-found、login-error）。
- 標籤收錄排行：前 30 名兩欄、其餘折疊，右側附摘要與方法說明（ranking_desktop）。
- 手機部落格目錄改用卡片，篩選可折疊（blogs_mobile）。
- 手機選單依任務分組，項目名稱具描述性（menu-open_mobile）。
- 關係圖旁的「怎麼讀這張圖」說明卡和兩種載入骨架（relations_desktop、relations-loading）。

最重要的五個問題（由嚴重到輕微）：
1. [文案] [tags_desktop] [desktop] 標籤雲第一排出現「#未分類 32 站」，第七排出現「#Uncategorized 22 站」，但 ranking_desktop 宣稱已略過這兩個 —— 同一份資料兩頁說法不一，會傷害資料可信度 —— 文章標籤頁套用和排行頁相同的排除清單。
2. [字體排印] [topic_desktop] [desktop] 左欄長部落格名稱（「Ted https://adersaytech.com/」「Luke Smith&#39;s Webpage…」）換行後，把篇數和「(標題提到 1、只在內文 0)」推出卡片右緣，而且 HTML 實體沒有解碼 —— 看起來像壞掉 —— 名稱限制成兩行並加省略號，註記移到下一行，並解碼實體。
3. [間距與版面] [home_desktop] [兩者] hero 灰底區的文字雲只占上半部，下半部空白；home_mobile 在 y≈300–500 也是空的。文字雲裡的「Go gle」看起來像缺字 —— 首屏最寶貴的空間被浪費 —— 收緊 hero 高度，並檢查 Google 字樣的呈現。
4. [資訊密度] [relations_desktop] [desktop] 右欄在「怎麼讀這張圖」之後留下約 400px 空白；圖中「資工小廢物 - JN」「官大為的部落格」等標籤彼此重疊 —— 長列表旁的空洞讓版面失衡 —— 右欄可放「圖中連結明細」，節點標籤做避讓處理。
5. [無障礙] [articles_desktop] [desktop] 每列的 #標籤、作者與主機名稱字小且灰，另見 topics_desktop 表頭與時間切換的選中態 —— 低視力與陽光下的手機難以閱讀 —— 次要文字的對比提高到 4.5:1，選中態加上底色或粗體。

## 組 B
一句話總評：資料和主要頁面骨架與 A 相近，但首頁少了說明、手機目錄被篩選晶片淹沒、錯誤與空資料偏陽春，頁面命名在各處互相衝突，整體摩擦明顯較多。（說明：本輪有一部分截圖讀取失敗，評分只根據實際看到、與 A 同樣範圍的頁面。）

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 6.5 | home_desktop、home_mobile：文字雲之後直接進入「最近的部落格引用」，沒有網站用途說明，也沒有主要 CTA；home_mobile 的「部落格觀察」統計被推到第二屏之後。blogs_desktop 的標題是「部落格與文章數」，看不出這頁是目錄。 |
| 字體排印 | 7 | 字級、行高與 A 相同，about-dark 閱讀舒適。但 articles_desktop 每列印出完整網址（例如 soft4fun.net/tech/news/nvidia-announces-…chair.htm），長串英數讓中文標題的辨識被稀釋；topic_desktop 同樣有「Luke Smith&#39;s」實體外露。 |
| 色彩 | 7 | 綠色系統一致，topics_desktop 的時間切換選中態用實心綠，清楚。但錯誤態全用中性灰框（home-error_desktop、relations-error_desktop、login-error_desktop），語意色缺席；about-dark 成立。 |
| 間距與版面 | 6.5 | relations_desktop 的「互相提及」卡只有三筆，卻拉長到和左側 41 筆列表等高，留下約 600px 空白卡片；ranking_desktop 是單欄長表，1440 寬下右半部大多是空白數字欄。 |
| 一致性 | 6 | 導覽列寫「追蹤」，頁標卻是「我的閱讀」（my-signed-in_desktop）；導覽列寫「引用」，分頁籤是「關係圖」、標題是「部落格關係圖」（relations_desktop）；導覽列選「標籤」時，分頁籤卻是「最新文章／標籤與主題」（tags_desktop）；錯誤態有時是灰框加文字連結，有時是按鈕。 |
| 資訊密度 | 7 | blogs_desktop 的表格一樣密，但上方先疊了三組共約 70 個篩選晶片（狀態、標籤、經營者），表格被推到約 y≈650 才開始；ranking_desktop 一次列出 55 名以上，沒有分段。 |
| 導覽 | 7 | 有麵包屑與「← 話題排行」返回；但 menu-open_mobile 的項目只有單字（文章、標籤、引用、話題、流量、追蹤、API），沒有「首頁」，各項用途不易理解；分頁籤橫跨不同主選單，目前位置模糊。 |
| 狀態與回饋 | 5.5 | blogs-empty_desktop：空目錄顯示一排空表頭，加上「沒有符合條件的部落格。」，語意錯誤（誤導成篩選無結果），也沒有下一步；login-error 只寫「登入未完成，請重新開始。」；not-found 只有一個「前往部落格目錄 →」；relations-loading 只有列表骨架。 |
| 響應式 | 5.5 | blogs_mobile：篩選晶片從約 y≈500 一路占到 y≈1340（顯示尺寸），之後的表格在 390 寬下截斷名稱成「Synthto…」「硬是…」「樂活…」；my-signed-in_mobile：curl 單行溢出，被截在「'https」，金鑰資訊截成「最後使用 2026/1…」。 |
| 文案 | 6 | blogs_desktop 的狀態晶片外露內部術語（「IndiePing 名單自動收錄」「已核對部落格入口 1」「網站管理者驗證收錄 4」）；tags、ranking 把「未分類」「Uncategorized」當成真標籤上榜；my-signed-out 同時出現兩個登入按鈕。 |
| 無障礙 | 6 | my-signed-in_mobile 的「建立金鑰」停用時是淺綠底白字，看起來可按，而且對比不足；錯誤態只有灰框，沒有圖示；手機表格截斷後，點擊目標變窄。 |
| 動畫與轉場 | 6 | relations-loading 只有文字加列表骨架，沒有圖的佔位，載入完成時版面會大幅跳動；menu-open_mobile 下緣有陰影。可見線索比 A 少。 |

要保留的優點：
- topics_desktop 的時間切換用實心綠表示選中，比白底更醒目。
- blog_desktop 和 A 一樣是雙欄：左邊文章，右邊「部落格資料／內文來源／部落格標籤」側欄，資訊完整。
- about-dark：深色對比良好，綠色連結在暗底上清楚。
- articles_desktop 頂部的「最新文章／標籤與主題」切換，讓文章與標籤可以互通（但命名需要整理）。

最重要的五個問題（由嚴重到輕微）：
1. [響應式] [blogs_mobile] [mobile] 三組篩選晶片全部展開，占掉一整屏多；之後的表格在 390 寬下把部落格名稱和網址截斷成「Synthto…」「b…」 —— 手機使用者要滑很久才看到內容，看到時又讀不全 —— 篩選收進折疊面板，手機改用卡片列表。
2. [狀態與回饋] [blogs-empty_desktop] [兩者] 空目錄只顯示空表頭和「沒有符合條件的部落格。」，另見 home-error_desktop、login-error_desktop、relations-error_desktop 的灰框純文字、not-found 只有一個連結 —— 用錯語意也沒有下一步，失敗時使用者不知道怎麼辦 —— 分清空資料與無結果，加上原因、圖示與多個去處。
3. [資訊層級] [home_desktop] [兩者] 首頁沒有任何一句說明網站用途，也沒有主要 CTA，home_mobile 文字雲之後直接是引用列表 —— 第一次來的人不知道這是什麼網站 —— 補上一句定位，以及「看最新文章／逛目錄／看話題」入口。
4. [一致性] [my-signed-in_desktop] [兩者] 導覽列「追蹤」對頁標「我的閱讀」，另見 relations_desktop（引用／關係圖／部落格關係圖）、tags_desktop（導覽列標籤 vs 分頁籤「標籤與主題」）、blogs_desktop（部落格與文章數） —— 同一件事三種叫法，使用者會迷路 —— 每個功能統一一個名稱，導覽、標題、分頁籤一致。
5. [響應式] [my-signed-in_mobile] [mobile] curl 指令單行溢出，被截在「'https」，沒有複製按鈕；金鑰最後使用時間被截斷；停用的「建立金鑰」淺綠看似可按 —— 開發者複製不到完整指令 —— 指令分行並加複製按鈕，停用態改成灰階，並加提示文字。

## 組 C
一句話總評：參考組的三個網站各有鮮明的品牌個性（ooh.directory 的橘紫插畫、blogroll 的柔綠），但版面窄、資訊密度低，狀態設計也缺乏可評估的線索。（說明：本輪只成功看到 blogblog-club_desktop、ooh-directory-home_desktop、blogroll-org_desktop、ooh-directory-recent_mobile。）

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7 | ooh-directory-home_desktop：頂部「A collection of 2,433 blogs about every topic」，接著是 14 個帶圖示的分類，用途一目了然；blogblog-club_desktop 則是大標題、插圖加條列連結，像說明文件，沒有可瀏覽的部落格內容。 |
| 字體排印 | 7 | ooh-directory-recent_mobile 標題約 34px 粗體橘字，層次強烈；blogroll-org_desktop 名稱與簡介字級相近，名稱只靠粗體區分，略弱。 |
| 色彩 | 8 | ooh.directory 的橘＋紫＋粉底系統，搭配插畫圖示，品牌記憶度高；blogroll 柔綠底配黃色 SUPPORTER、深綠 INTERVIEW 色帶，有個性；blogblog.club 的品紅連結配深灰頁尾，屬於預設文件站風格。 |
| 間距與版面 | 6.5 | ooh-directory-home_desktop 在 1440 寬下只用中間約 760px，兩側大片空白；blogroll-org_desktop 左欄在贊助卡之後全空。 |
| 一致性 | 7 | 各站內部自成一套：ooh 的區塊標題都是橘色加底線，blogroll 的列表列都同一個樣式。 |
| 資訊密度 | 6.5 | blogroll-org_desktop 每列只有名稱與一句簡介，沒有更新時間或文章；ooh-directory-recent_mobile 的摘要卡一則就超過半屏（「Bottle Rocket…」）。 |
| 導覽 | 6.5 | ooh 有 Suggest／Blog／About、麵包屑「Home / Recently updated blogs」與更新頻率下拉；blogroll 只有「Filter by topic」晶片；blogblog.club 頂部有六個入口，但沒有目前位置的標示。 |
| 狀態與回饋 | 4.5 | 看到的截圖都沒有載入、空資料、錯誤或無結果狀態可評估，只能依線索保守評分。 |
| 響應式 | 7 | ooh-directory-recent_mobile 改成單欄、大字、搜尋框全寬，沒有溢出；但上方標誌與導覽占掉約 1/5 屏。 |
| 文案 | 7.5 | ooh「First post in over a year!」「Or see recently added blogs」口語親切；blogroll「Because blogs are the soul of the web」「No algorithms ever!」定位明確。 |
| 無障礙 | 6.5 | ooh-directory-home_desktop 分類下方的子連結約 11px 紫字配粉底，對比與點擊範圍都偏小；blogroll 的 INTERVIEW／SUPPORTER 是直排小字。 |
| 動畫與轉場 | 4 | 截圖中看不到骨架、讀取提示或狀態切換的線索，只能保守評分。 |

要保留的優點：
- ooh.directory 的分類清單附插畫圖示和數量（ooh-directory-home_desktop），入口清楚又有個性。
- ooh 的「First post in over a year!」這類情境化區塊標題，讓列表有故事性。
- blogroll 用色帶標示 INTERVIEW／SUPPORTER，用很低的成本做出區分（blogroll-org_desktop）。
- ooh-directory-recent_mobile 的單欄大字排版，在手機上可讀性高。

最重要的五個問題（由嚴重到輕微）：
1. [間距與版面] [ooh-directory-home_desktop] [desktop] 1440 寬只用中間約 760px —— 寬螢幕浪費一半空間，列表需要大量捲動 —— 放寬主欄，或在桌面改成雙欄列表。
2. [資訊層級] [blogblog-club_desktop] [desktop] 首頁是說明文字和條列連結，看不到任何部落格或文章 —— 名錄類產品首屏沒有內容 —— 首頁直接展示最新或隨機的部落格。
3. [資訊密度] [blogroll-org_desktop] [desktop] 每列只有名稱與一句簡介，沒有更新時間或最新文章，左欄下方全空 —— 無法判斷部落格是否還活躍 —— 補上最後更新日期，左欄改成固定定位。
4. [無障礙] [ooh-directory-home_desktop] [desktop] 分類子連結約 11px 紫字配粉底，另見 blogroll-org_desktop 的直排小字 —— 對比與點擊範圍不足 —— 加大字級與行高，色帶標籤改成橫排。
5. [狀態與回饋] [ooh-directory-recent_mobile] [mobile] 摘要卡全文超過半屏、沒有截斷，也看不到載入或空資料的設計 —— 手機上捲動成本高 —— 限制摘要行數並加上「繼續閱讀」。

```json
{"A": {"scores": [8, 7.5, 7.5, 7.5, 7.5, 8, 8, 8.5, 8, 7.5, 7, 7], "issues": ["[文案] tags_desktop 列出 #未分類／#Uncategorized，ranking_desktop 卻說已略過，兩頁矛盾", "[字體排印] topic_desktop 長部落格名稱把篇數與『(標題提到…)』註記推出卡片右緣，且 Luke Smith&#39;s 實體未解碼", "[間距與版面] home_desktop/home_mobile hero 文字雲下方大片空白，『Go gle』像缺字", "[資訊密度] relations_desktop 右欄在說明卡後約 400px 空白，圖中節點標籤互相重疊", "[無障礙] articles_desktop／topics_desktop 次要文字約 11px 淺灰對比不足，時間切換選中態辨識弱"]}, "B": {"scores": [6.5, 7, 7, 6.5, 6, 7, 7, 5.5, 5.5, 6, 6, 6], "issues": ["[響應式] blogs_mobile 三組篩選晶片占滿一屏多，之後表格把名稱截成『Synthto…』", "[狀態與回饋] blogs-empty_desktop 空目錄顯示空表頭與『沒有符合條件的部落格』；home-error、login-error、relations-error 灰框純文字、404 只有一個連結", "[資訊層級] home_desktop/home_mobile 沒有網站用途說明與主要 CTA", "[一致性] 追蹤／我的閱讀、引用／關係圖／部落格關係圖、標籤／標籤與主題、部落格與文章數等命名互相衝突", "[響應式] my-signed-in_mobile curl 單行溢出被截在 'https，無複製按鈕，停用的建立金鑰淺綠看似可按"]}, "C": {"scores": [7, 7, 8, 6.5, 7, 6.5, 6.5, 4.5, 7, 7.5, 6.5, 4], "issues": ["[間距與版面] ooh-directory-home_desktop 1440 寬只用中間約 760px", "[資訊層級] blogblog-club_desktop 首頁是說明文件，首屏沒有任何部落格內容", "[資訊密度] blogroll-org_desktop 每列只有名稱與簡介，沒有更新時間，左欄下方全空", "[無障礙] ooh-directory-home_desktop 分類子連結 11px 紫字配粉底，blogroll 直排小字標籤", "[狀態與回饋] 看不到載入、空資料、錯誤狀態；ooh-directory-recent_mobile 摘要卡過長"]}}
```
