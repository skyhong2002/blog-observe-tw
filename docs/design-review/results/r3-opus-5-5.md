# r3 blind review: opus-5-5

Round 3. Baseline = main at ebffbef (fixed set). New = commit 15c00e2 (round-2 fixes plus the phone relation-map rule). Reviewer: claude-proxy claude-opus-5-5, effort high, fresh context.

- Brief: `brief.md`, SHA-256 `8c002ebe6e72b6b5d322e5b350d797c3893501d769f40f68703ea872fbef5539`
- Mapping (revealed after the review): **A = baseline**, **B = reference**, **C = new**
- New set: `r3`

| Set | Mean of 12 scores |
|---|---:|
| baseline (A) | 6.54 |
| reference (B) | 6.21 |
| new (C) | 7.46 |

| 項目 | baseline | reference | new |
|---|---:|---:|---:|
| 資訊層級 | 7 | 7 | 7.5 |
| 字體排印 | 7 | 7 | 7.5 |
| 色彩 | 6.5 | 5.5 | 7.5 |
| 間距與版面 | 6.5 | 6.5 | 7.5 |
| 一致性 | 6.5 | 7.5 | 7.5 |
| 資訊密度 | 7 | 7 | 7.5 |
| 導覽 | 7 | 6.5 | 7.5 |
| 狀態與回饋 | 6 | 4 | 8 |
| 響應式 | 6 | 6.5 | 7.5 |
| 文案 | 6.5 | 7.5 | 7.5 |
| 無障礙 | 6.5 | 6.5 | 7 |
| 動畫與轉場 | 6 | 3 | 7 |

Raw reviewer output below, unedited.

---

## 組 A
一句話總評：資料完整、配色克制，可以用；但空資料與錯誤狀態只有一行灰字，手機版有溢出和截斷，命名也不一致，整體比 C 粗糙一截。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7 | ranking_desktop：先放全寬長條圖，下面是全寬表格，名次是細灰字，不夠醒目；relations_desktop：頁首有 7/30/90 天分頁與「全部連結／互相提及」篩選，主次清楚；home_desktop 首屏能看出網站在做什麼。 |
| 字體排印 | 7 | about_desktop：內文行長約 760px、行高寬鬆，讀起來舒服；ranking_mobile 表格的數字靠右對齊；relations_mobile 名單中「官大為的部落格｜W…」「NudoBlog - 小透明…」被截成刪節號。 |
| 色彩 | 6.5 | 綠色主色貫穿導覽高亮、連結與按鈕（login_desktop「使用 Google 登入」）；relations-error_desktop 與 login-error_desktop 的錯誤框是灰底灰框，沒有用語意色；深色模式（ranking-dark、about-dark）可以成立。 |
| 間距與版面 | 6.5 | ranking_desktop：表格撐滿 1120px 寬，標籤名與「部落格」欄之間空了約 500px；ranking-empty_desktop 只有一行字，下方大片空白；about_desktop 右側約 360px 留空。 |
| 一致性 | 6.5 | 頁首都是同一套 header＋footer；但分頁籤位置不一：ranking_desktop 放在標題下方，relations_desktop 放在標題上方；my-signed-in_desktop 的追蹤清單是無框列表，同頁 API 金鑰卻是有框卡片。 |
| 資訊密度 | 7 | ranking-dark_desktop 一屏約 20 列，可接受；relations_desktop 同時列出「最常被提及」20 筆與「互相提及」；my-signed-in_desktop 三個追蹤網站各佔一整列，右側只有分類小字。 |
| 導覽 | 7 | 桌面導覽列有綠底標示目前位置（ranking 的「標籤」、my 的「追蹤」）；menu-open_mobile 有完整選單；tags-selected_mobile 選了標籤後，第一屏看不到任何文章，得往下捲。 |
| 狀態與回饋 | 6 | ranking-empty_desktop/mobile 只有灰字「目前沒有可列出的標籤。」，沒有下一步；relations-error_desktop 是灰框加一個文字連結「重新載入」；login-error_desktop 只寫「登入未完成，請重新開始。」，沒有原因；not-found_desktop 只提供「前往部落格目錄」一個出口；relations-loading 用列表骨架代替圖形骨架。 |
| 響應式 | 6 | my-signed-in_mobile：curl 程式碼區塊橫向溢出，顯示到「'https」就被切掉；金鑰資訊截成「最後使用 2026/1…」；blogs_mobile 仍是被截斷的表格；relations-30_mobile 把 138 個節點塞進 390 寬，標籤互相重疊、無法辨讀。 |
| 文案 | 6.5 | 頁面標題「我的閱讀」對應的導覽卻叫「追蹤」（my-signed-out_desktop），about 頁連結又寫「管理我的閱讀」；relations 頁標題「部落格關係圖」，上層導覽卻叫「引用」；my-signed-in 寫成「3 個追蹤網站」，與其他頁的「部落格」叫法不一致。 |
| 無障礙 | 6.5 | my-signed-in_desktop 停用的「建立金鑰」是淡綠色，看起來像可以按，對比也低；ranking_desktop 名次是淺灰小字；按鈕與分頁籤在手機上的點擊範圍足夠（relations_mobile 的 7/30/90 分頁）。 |
| 動畫與轉場 | 6 | relations-loading_desktop/mobile 有「正在載入近 7 天的關係資料…」加灰條骨架，但骨架是列表形狀，和實際的圖形不符；靜態截圖沒有其他動態線索，保守給分。 |

要保留的優點：
- 全站 header 與 footer 一致，footer 有「已收錄 698 個部落格」的綠點狀態和資料透明度連結（about_desktop）。
- ranking 頁「長條圖＋完整表格」的組合，數字靠右對齊，好比較（ranking_mobile）。
- relations 頁的 7/30/90 天分頁、連結篩選，加上「最常被提及／互相提及」雙欄（relations_desktop）。
- 載入時先寫明在載入哪個時段（「正在載入近 7 天的關係資料…」，relations-loading）。
- about 頁的段落層次與行長適合閱讀，深色版也成立（about-dark_desktop）。

最重要的五個問題（由嚴重到輕微）：
1. [響應式] [my-signed-in_mobile] [mobile] curl 程式碼區塊橫向溢出，網址被切掉，金鑰資訊也被截斷 —— 使用者看不到、也複製不到完整指令 —— 程式碼改成可換行或可橫向捲動，並加複製按鈕；金鑰中繼資料分兩行顯示。
2. [狀態與回饋] [ranking-empty_desktop] [兩者] 空資料只有一行灰字，沒有原因也沒有下一步（另見 relations-error_desktop、login-error_desktop、not-found_desktop）—— 首次或異常造訪時，使用者會以為網站壞了 —— 統一做成狀態卡：圖示、標題、原因、主要動作；錯誤要用紅色語意色。
3. [響應式] [relations-30_mobile] [mobile] 138 個節點的完整圖塞進 390 寬，標籤重疊、無法辨讀 —— 關係圖是主打功能，手機上等於不能用 —— 在手機上自動套用「提及 3 篇以上」等篩選，降低節點數。
4. [文案] [my-signed-out_desktop] [兩者] 同一個功能有三種叫法：頁名「我的閱讀」、導覽「追蹤」、about 頁「管理我的閱讀」；relations 頁也是「部落格關係圖」對上導覽「引用」 —— 使用者會搞不清楚自己在哪 —— 統一名稱。
5. [間距與版面] [ranking_desktop] [desktop] 全寬表格的標籤名與數字之間空了約 500px，長條圖也拉得過寬 —— 視線來回距離太長，浪費 1440 寬的空間 —— 改成圖與表左右並排，或限制表格寬度。

## 組 B
一句話總評：參考組。內容導向、樣式簡樸，文字清楚、資訊密度高；但品牌色與狀態設計幾乎沒有，截圖裡也看不到任何載入、空資料或錯誤狀態。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7 | ooh-directory-home_desktop：一進來就是分類目錄與簡介，用途一目了然；ooh-directory-recent_desktop 以部落格名稱與文章標題為主，日期次之；blogroll-org_desktop 是名單式排列。 |
| 字體排印 | 7 | ooh-directory 系列的英文字級與行高舒適、層次清楚；blogblog-club_mobile 中文列表行距適中；整體偏預設字體，個性不足。 |
| 色彩 | 5.5 | 四組截圖大多是白底黑字加藍色連結，幾乎沒有品牌色；沒有語意色的示範；沒有看到深色模式。 |
| 間距與版面 | 6.5 | ooh-directory-home_desktop 主欄較窄，1440 寬下兩側大片留白；blogroll-org_desktop 單欄列表節奏穩定但偏長。 |
| 一致性 | 7.5 | 同一產品內（ooh-directory-home／recent）的連結樣式、列表格式一致；元件種類少，所以也少出錯。 |
| 資訊密度 | 7 | ooh-directory-recent_desktop 一屏能看到很多條目；blogroll-org_mobile 每筆附較長的描述，頁面很長。 |
| 導覽 | 6.5 | ooh-directory 有分類連結可以逐層進入；手機版（ooh-directory-home_mobile）沒有明顯的導覽選單或目前位置標示。 |
| 狀態與回饋 | 4 | 截圖只有有資料的頁面，看不到載入、空資料、錯誤或登入狀態，只能保守給分。 |
| 響應式 | 6.5 | ooh-directory-home_mobile、blogroll-org_mobile 都是單欄重排，沒有橫向溢出；但手機版大致只是把桌面版縮窄，沒有針對手機調整。 |
| 文案 | 7.5 | ooh-directory 的介紹文字口吻自然、具體；blogblog-club 的中文標籤簡潔。 |
| 無障礙 | 6.5 | 正文文字對比良好；但連結多半是密集的行內文字，手機上點擊範圍偏小（ooh-directory-recent_mobile）。 |
| 動畫與轉場 | 3 | 沒有任何載入、轉場或選單展開的線索，資料不足，只能保守給分。 |

要保留的優點：
- ooh.directory 首頁「分類＋簡介」的入口方式，讓人一眼看懂網站在做什麼（ooh-directory-home_desktop）。
- 最新文章列表以部落格名稱＋文章標題為主，資訊密度高（ooh-directory-recent_desktop）。
- blogroll.org 為每個部落格寫一段人味的介紹，有助於發現新部落格（blogroll-org_desktop）。
- 版面與元件很少，所以各頁一致性高。

最重要的五個問題（由嚴重到輕微）：
1. [狀態與回饋] [全部截圖] [兩者] 截圖裡沒有任何載入、空資料或錯誤狀態 —— 無法確認狀態設計 —— 補上各種狀態的設計。
2. [色彩] [ooh-directory-home_desktop] [兩者] 幾乎是瀏覽器預設的配色，沒有品牌識別 —— 難以建立記憶點 —— 建立主色與語意色。
3. [間距與版面] [ooh-directory-home_desktop] [desktop] 窄主欄在 1440 寬下兩側大片留白（另見 blogroll-org_desktop）—— 沒有善用寬螢幕 —— 加側欄或改多欄。
4. [無障礙] [ooh-directory-recent_mobile] [mobile] 行內小連結密集，點擊範圍偏小 —— 手機上容易點錯 —— 加大行高與點擊區。
5. [導覽] [ooh-directory-home_mobile] [mobile] 看不到目前位置，也沒有便捷的全站導覽 —— 深入分類後不好返回 —— 加麵包屑或固定導覽。

## 組 C
一句話總評：和 A 是同一套骨架，但手機版改了不少（目錄卡片、關係圖自動篩選、程式碼換行），空資料、錯誤與 404 都有完整的狀態卡，命名也統一了；剩下的多半是寬螢幕留白與密集圖形標籤的細節。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7.5 | ranking_desktop：左邊長條圖、右邊表格，名次改成粗體，排序一眼可見；my-signed-in_desktop：追蹤清單是有標題的卡片「追蹤中的部落格 3 個」，動作按鈕放在右上；not-found_desktop：標題、說明、三個出口層次清楚。 |
| 字體排印 | 7.5 | about_desktop 長文排版舒適；ranking_mobile 的粗體名次加細體數字，對比得宜；my-signed-in_mobile 的 curl 指令在程式碼區塊內換行；relations_mobile 的長名稱仍截成「官大為的部落格 |…」。 |
| 色彩 | 7.5 | 綠色主色加上語意色：ranking-empty_desktop 用黃色提示卡，relations-error_desktop 與 login-error_desktop 用紅底、紅框、警示圖示；ranking-dark_desktop 的深色模式下，綠色長條與連結依然清楚。 |
| 間距與版面 | 7.5 | ranking_desktop 雙欄善用 1440 寬，但左欄在長條圖結束後（約 y=450 起）整片空白，一路到截圖底；relations_desktop 的圖與兩張名單卡片格線對齊；not-found_desktop 置中卡片的比例恰當。 |
| 一致性 | 7.5 | 分頁籤統一放在頁標題上方（ranking、relations、my）；狀態卡的結構一致：圖示＋標題＋說明＋按鈕（ranking-empty、relations-error、login-error、not-found）；關係圖與 about 頁也沿用同一套元件。 |
| 資訊密度 | 7.5 | ranking_desktop 雙欄讓首屏多出約 10 列；relations-30_mobile 自動切到「提及 3 篇以上」，只剩 20 個部落格、15 條連結，看得清楚；my-signed-in_mobile 的金鑰資訊分兩行完整顯示。 |
| 導覽 | 7.5 | 導覽「追蹤」對應頁名「我的追蹤」，about 頁連結也改成「管理我的追蹤」；not-found 提供回首頁、部落格目錄、話題排行三個出口；ranking-empty 有「看最新文章」按鈕可以繼續瀏覽。 |
| 狀態與回饋 | 8 | ranking-empty_desktop：「排行還沒有資料」加原因說明與 CTA；login-error_desktop：「登入沒有完成」並說明可能是逾時或 Cookie 被擋；relations-error 有紅色警示與按鈕「重新載入」；my-signed-in_desktop 停用的「建立金鑰」是灰色，下方提示「先輸入名稱，就能建立金鑰。」 |
| 響應式 | 7.5 | 手機版：blogs_mobile 改成卡片；relations-30_mobile 自動篩選；my-signed-in_mobile 的程式碼可換行，RSS/OPML 按鈕改到第二列；not-found_mobile 的三個按鈕折成兩列，最後一顆「話題排行」單獨落在第二列。 |
| 文案 | 7.5 | 「引用關係圖」對應導覽「引用」；錯誤訊息具體可行（login-error「Google 沒有把登入結果交回來…」）；404 說明「部落格與話題的網址偶爾會改名」，貼近實際情境；名單裡的「AngeCl' s GitHub Pages」是資料本身的怪空格，不算介面問題。 |
| 無障礙 | 7 | 錯誤狀態同時用圖示、文字與顏色表達，不只靠顏色；停用按鈕用灰色加文字提示；relations-30_desktop 圖中心的節點標籤互相重疊（「AngeCl' s GitHub Pages」「廢文小天地」「資工小廢物 - JN」一帶）；ranking 名次的對比改善了。 |
| 動畫與轉場 | 7 | relations-loading_desktop/mobile 用大小不一的圓點模擬關係圖，下方再接名單骨架，形狀和實際內容相符；載入文字寫明時段；沒有其他動態線索。 |

要保留的優點：
- 統一的狀態卡（圖示＋標題＋原因＋動作），並依情境配黃、紅語意色（ranking-empty、relations-error、login-error、not-found）。
- 手機關係圖在節點過多時自動切到「提及 3 篇以上」，標籤清楚可讀（relations-30_mobile）。
- 標籤排行桌機版圖表並排，名次粗體（ranking_desktop）。
- 「我的追蹤」頁：卡片式清單、明確的「訂閱個人 RSS／匯出 OPML」按鈕、停用按鈕附提示、程式碼可換行（my-signed-in_desktop/mobile）。
- 關係圖的骨架畫面形狀和實際圖形一致（relations-loading_mobile）。
- 命名統一：追蹤、引用關係圖、管理我的追蹤（about_desktop）。

最重要的五個問題（由嚴重到輕微）：
1. [無障礙] [relations-30_desktop] [desktop] 近 30 天全部連結時，圖中心的節點標籤互相重疊、難以辨讀（另見 relations_desktop 中心區）—— 最重要的節點反而最難看清 —— 用碰撞偵測讓標籤避開，或只在 hover／放大時顯示次要標籤，桌面也提供預設篩選。
2. [間距與版面] [ranking_desktop] [desktop] 雙欄版面的左欄在長條圖之後整片空白，右欄表格卻一路很長 —— 版面失衡，看起來像漏了內容 —— 長條圖改成黏貼式（sticky），或在左欄補上說明／其他統計。
3. [字體排印] [relations_mobile] [mobile] 「最常被提及」名單裡的長名稱截成「官大為的部落格 |…」「NudoBlog - 小透明…」，右側的數字欄佔掉不少寬度 —— 讀者辨認不出是哪個部落格 —— 手機上讓名稱換行，數字移到第二行。
4. [響應式] [not-found_mobile] [mobile] 三個按鈕折行後，「話題排行」單獨落在第二列，視覺不整齊 —— 小細節，但 404 是常見入口 —— 手機改成直向全寬按鈕，或只留兩個出口。
5. [資訊層級] [ranking_desktop] [兩者] 前十名裡有「未分類」，第 51 名有「Uncategorized」這類系統預設分類 —— 排行看起來不夠可信 —— 排除預設分類，或標成灰色並註明。

```json
{"A": {"scores": [7, 7, 6.5, 6.5, 6.5, 7, 7, 6, 6, 6.5, 6.5, 6], "issues": ["[響應式] my-signed-in_mobile：curl 程式碼區塊橫向溢出、網址被切掉，金鑰資訊截成「最後使用 2026/1…」；應改為可換行並加複製按鈕", "[狀態與回饋] ranking-empty_desktop（另見 relations-error、login-error、not-found）：空資料與錯誤只有灰字一行，沒有原因與下一步，錯誤也不用語意色；應統一做成狀態卡", "[響應式] relations-30_mobile：138 個節點塞進 390 寬，標籤重疊無法辨讀；手機上應自動篩選、降低節點數", "[文案] my-signed-out_desktop：「我的閱讀」對上導覽「追蹤」、「部落格關係圖」對上導覽「引用」，命名不一致；應統一", "[間距與版面] ranking_desktop：全寬表格的名稱與數字之間空了約 500px，圖也過寬；應改成圖表並排或限制寬度"]}, "B": {"scores": [7, 7, 5.5, 6.5, 7.5, 7, 6.5, 4, 6.5, 7.5, 6.5, 3], "issues": ["[狀態與回饋] 全部截圖：看不到任何載入、空資料或錯誤狀態", "[色彩] ooh-directory-home_desktop：近乎預設配色，沒有品牌識別", "[間距與版面] ooh-directory-home_desktop：窄主欄在 1440 寬下兩側大片留白", "[無障礙] ooh-directory-recent_mobile：行內小連結密集，點擊範圍偏小", "[導覽] ooh-directory-home_mobile：看不到目前位置，也沒有便捷的全站導覽"]}, "C": {"scores": [7.5, 7.5, 7.5, 7.5, 7.5, 7.5, 7.5, 8, 7.5, 7.5, 7, 7], "issues": ["[無障礙] relations-30_desktop：圖中心的節點標籤互相重疊、難以辨讀；應讓標籤避開或預設篩選", "[間距與版面] ranking_desktop：雙欄左欄在長條圖之後整片空白、版面失衡；圖改成黏貼式或補內容", "[字體排印] relations_mobile：名單長名稱被截成刪節號，難以辨認；手機上讓名稱換行、數字移到第二行", "[響應式] not-found_mobile：三個按鈕折行後「話題排行」單獨一列；改成直向全寬按鈕", "[資訊層級] ranking_desktop：「未分類」「Uncategorized」等預設分類進入排行；應排除或標成灰色"]}}
```
