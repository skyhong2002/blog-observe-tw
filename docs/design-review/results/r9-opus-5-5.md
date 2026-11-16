# r9 blind review: opus-5-5

Round 9 (skyhong-SM segment). Baseline = main at ebffbef and references, shot on skyhong-SM for r6 and reused. New = commit 2f73e51 (round-8 fixes; 91 shots from 56a371b, whose pages are identical, and the two home-empty shots from 2f73e51). Reviewer: claude-proxy claude-opus-5-5, effort high, fresh context (delegate_task).

- Brief: `brief.md`, SHA-256 `8c002ebe6e72b6b5d322e5b350d797c3893501d769f40f68703ea872fbef5539`
- Mapping (revealed after the review): **A = baseline**, **B = new**, **C = reference**
- New set: `r9`

| Set | Mean of 12 scores |
|---|---:|
| baseline (A) | 6.04 |
| new (B) | 7.62 |
| reference (C) | 6.12 |

| 項目 | baseline | new | reference |
|---|---:|---:|---:|
| 資訊層級 | 6.5 | 8 | 6.5 |
| 字體排印 | 7 | 7.5 | 7 |
| 色彩 | 6.5 | 8 | 6 |
| 間距與版面 | 6 | 8 | 6.5 |
| 一致性 | 6 | 7.5 | 7 |
| 資訊密度 | 6 | 7.5 | 7 |
| 導覽 | 6.5 | 7.5 | 6 |
| 狀態與回饋 | 5 | 8.5 | 4 |
| 響應式 | 6 | 7.5 | 6.5 |
| 文案 | 6 | 8 | 7 |
| 無障礙 | 6 | 7 | 6 |
| 動畫與轉場 | 5 | 6.5 | 4 |

Raw reviewer output below, unedited.

---

## 組 A
一句話總評：基本版面乾淨、品牌綠色一致，但空資料、錯誤、不存在等狀態大多只有一行灰字。標籤頁、關係圖和「我的閱讀」在 1440 寬與手機上都有明顯的密度和截斷問題。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 6.5 | tags-selected_desktop：標題是「部落格 · 標籤」，下方整片標籤雲又完整重列一次，沒有任何標籤顯示為已選，相關文章被推到 y≈760 以下；ranking_desktop：98 列全部攤開，前段名次沒有特別強調。 |
| 字體排印 | 7 | about_desktop：內文字級與行高舒適，H2 層次清楚；tags_desktop：方框標籤裡的「4348 篇 · 39 站」與名稱同一行，數字字級小，掃讀時容易混成一團。 |
| 色彩 | 6.5 | ranking-dark_desktop：深色下綠色長條與綠色連結成立；但 relations-error_desktop、login-error_desktop 的錯誤只用灰框黑字，沒有語意色。 |
| 間距與版面 | 6 | ranking_desktop：表格撐滿 1120 px，標籤名稱和「部落格」欄相距約 550 px，很難橫向對讀；relations_desktop：右欄「互相提及」只有 3 筆，下面從 y≈920 到 1500 整塊空白。 |
| 一致性 | 6 | tags_desktop 的分頁籤是「最新文章｜標籤與主題」，ranking_desktop 卻是「收錄排行｜探索標籤」，同一組頁面叫法不同；標籤用方角框，其他按鈕用圓角，兩套並存。 |
| 資訊密度 | 6 | relations-30_desktop／mobile：138 個節點擠成一團，「AngeCl's GitHub Pages」等標籤互相重疊；tags-selected_mobile：1688 px 高的截圖全是標籤雲，一篇文章都看不到。 |
| 導覽 | 6.5 | tags-selected_desktop：沒有「回所有標籤」，也看不出選了哪個標籤；relations_desktop：期間分頁籤與子分頁籤各占一列，位置清楚；頂部導覽有目前頁的綠底提示。 |
| 狀態與回饋 | 5 | tags-empty_desktop 只有「標籤資料整理中。」，ranking-empty_desktop 只有「目前沒有可列出的標籤。」，都沒有下一步；topic-not-found_desktop 用通用的「找不到這個頁面」，只連到部落格目錄；login-error_desktop 是白框「登入未完成，請重新開始。」，沒有原因。 |
| 響應式 | 6 | my-signed-in_mobile：curl 指令是單行，在右側被切成「'https」；金鑰資訊被截成「最後使用 2026/1…」；relations_mobile 的「最常被提及」名稱被截成「官大為的部落格｜W…」。 |
| 文案 | 6 | my-signed-out_desktop：頁標題「我的閱讀」與導覽「追蹤」不一致；about_desktop 有「在上游宣布完整快照之前…觀測窗口」等內部用語；tags_desktop 與 ranking 把「未分類」「Uncategorized」當成熱門標籤。 |
| 無障礙 | 6 | my-signed-in_desktop：停用的「建立金鑰」是淡綠底白字，對比低，看起來像可以按；relations-error_desktop 的「重新載入」只是一段綠字，點擊範圍小。 |
| 動畫與轉場 | 5 | relations-loading_desktop／mobile：只有列表骨架，沒有圖表占位，載入完成後版面會大幅跳動；有「正在載入近 7 天的關係資料…」提示。靜態截圖看不到轉場，保守給分。 |

要保留的優點：
- 頂部導覽的目前頁淺綠底提示，以及搜尋框、深色切換、登入的固定位置（各頁 desktop 都一致）。
- 頁尾「本頁的資料來源與計算方式」摺疊區，把說明集中收在頁尾（各頁 desktop、mobile 都有）。
- ranking-dark_desktop 的深色配色：亮綠長條、深灰卡片，深色模式成立。
- about_desktop／mobile 的長文排版：行高舒適，H2 分段清楚。
- relations_desktop 的「全部連結／互相提及／提及 3 篇以上」篩選標籤設計。

最重要的五個問題（由嚴重到輕微）：
1. [狀態與回饋] [tags-empty、ranking-empty、topic-not-found、login-error、relations-error] [兩者] 空資料、錯誤、不存在大多只是一行灰字或灰框，沒有圖示、語意色和行動按鈕 —— 使用者分不出是壞掉還是正常，也不知道下一步 —— 改成統一的狀態卡：標題、原因、主要與次要按鈕，錯誤要用警示色。
2. [資訊層級] [tags-selected] [兩者] 選了標籤後整片標籤雲重列，選中的標籤沒有任何標示，手機一整屏只有標籤雲 —— 讀者點了以後看不到結果 —— 改為「← 所有標籤」加上標籤標題，直接列出文章與部落格。
3. [響應式] [my-signed-in_mobile] [mobile] curl 指令單行被切掉，金鑰資訊被截斷 —— 使用者無法完整看到或複製指令 —— 指令要能換行並加上「複製」按鈕，金鑰資訊分兩行。
4. [資訊密度] [relations-30] [兩者] 30 天的關係圖全部 138 個節點一起畫，標籤重疊成一團；relations_desktop 右欄下半部空白 —— 圖讀不出來，空間也浪費 —— 預設套用「提及 3 篇以上」，右欄補上圖例或連結明細。
5. [一致性／文案] [my-signed-out、tags、ranking] [兩者] 「我的閱讀」對「追蹤」、「標籤與主題」對「探索標籤」叫法不一，熱門標籤裡還混入平台預設的「未分類」「Uncategorized」 —— 增加理解成本，排行看起來不可信 —— 統一命名，並排除平台預設分類。

## 組 B
一句話總評：和 A 是同一套視覺語言，但空資料、錯誤、不存在都做成完整的狀態卡，標籤與關係圖的資訊架構明顯更好。剩下的問題多半在細節：手機列表偏長、標籤小字對比偏低、分頁籤位置不一。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 8 | tags-selected_desktop：有「← 所有標籤」、綠色「#部落格」大標題，左欄是最近文章，右欄是寫過這個標籤的部落格；ranking_desktop：圖表旁的摘要寫出「列出的標籤 98」「最多部落格在用 台中美食」。 |
| 字體排印 | 7.5 | tags_desktop：前段標籤用粗體大字，後段（從「#台北下午茶」起）變成細體小字，層級清楚；ranking_desktop 的名次數字加粗；但標籤後的「39 站」是淺灰小字。 |
| 色彩 | 8 | relations-error_desktop 與 login-error_desktop 是紅色警示卡加三角形圖示；tags-empty_desktop 與 ranking-empty_desktop 是黃色提示卡；ranking-dark_desktop 深色成立。黃框用在正常的「還沒有資料」，略顯警示。 |
| 間距與版面 | 8 | ranking_desktop：前 30 名分兩欄，第 31–98 名收在「顯示第 31–98 名」裡；relations_desktop 右欄依序是互相提及、怎麼讀這張圖、圖中連結明細，沒有空洞。login_desktop 內容從 x≈432 起靠左排，既不對齊 160 的格線也沒置中。 |
| 一致性 | 7.5 | 狀態卡有共同結構（圖示、標題、說明、按鈕），見 topic-not-found、not-found、tags-empty、ranking-empty；但 tags／ranking 的分頁籤放在 H1 上方，my-signed-in 放在 H1 下方，relations_desktop 的期間分頁籤又在右上角。 |
| 資訊密度 | 7.5 | relations-30_desktop：預設「提及 3 篇以上」，顯示「圖上 20／138 個部落格 · 15／260 條連結」，圖讀得懂；但 tags-selected_mobile 每篇文章占 4 行（標題、標籤、部落格加日期、網域），一屏只有約 11 篇。 |
| 導覽 | 7.5 | not-found_desktop 有「回首頁／部落格目錄／話題排行」三個出口；tags-selected 有返回所有標籤的連結。my-signed-in_desktop 的「旅遊 →」箭頭讓人看不出點下去會到部落格還是分類。 |
| 狀態與回饋 | 8.5 | topic-not-found_desktop：「找不到這個話題」，說明話題會隨內容變動，並提供「回話題排行」「看升溫話題」；login-error_desktop 說明可能是逾時或 Cookie 被擋；my-signed-in_desktop 的停用按鈕下方有「先輸入名稱，就能建立金鑰。」 |
| 響應式 | 7.5 | my-signed-in_mobile：curl 分三行並有「複製指令」，金鑰資訊兩行完整；relations_mobile 名稱不截斷但每列兩行；ranking_mobile 前 30 名拆成兩張表，表頭重複。 |
| 文案 | 8 | my-signed-out_desktop：「我的追蹤」與導覽一致，API 金鑰縮成一行「開發者：登入後可以在這裡建立 API 金鑰。」；about_desktop 改成「這份關鍵字目前只來自部分文章，還不是完整的詞彙表」，好懂；relations_desktop 一句話說明箭頭方向。 |
| 無障礙 | 7 | 錯誤狀態同時用圖示與文字，不只靠顏色（relations-error）；但 tags_desktop 的計數淺灰小字、關係圖節點標籤約 10 px 灰字，對比偏低；not-found_mobile 的按鈕夠大（約 64 px 高）。 |
| 動畫與轉場 | 6.5 | relations-loading_desktop／mobile：圖表區有圓點骨架，下方有列表骨架，和完成後版面對應，切換時跳動較小。靜態截圖看不到實際轉場，給保守分。 |

要保留的優點：
- 統一的狀態卡系統：not-found 與 topic-not-found 用虛線卡，tags-empty 與 ranking-empty 用黃色提示卡，relations-error 與 login-error 用紅色警示卡，每張都有說明和下一步。
- tags-selected 的標籤頁結構：返回連結、#標籤標題、文章列表加部落格側欄，網域只顯示「shermanho.blog」。
- ranking 的圖表加摘要面板、兩欄前 30 名、其餘名次摺疊，並排除平台預設分類。
- relations 的「怎麼讀這張圖」說明、圖中連結明細（含引用占比），以及 30 天預設過濾後讀得懂的圖。
- my-signed-in 的追蹤卡片標頭（3 個，加上「訂閱個人 RSS」「匯出 OPML」）、可換行的 curl 和複製按鈕。

最重要的五個問題（由嚴重到輕微）：
1. [資訊密度] [tags-selected_mobile] [mobile] 每篇文章 4 行，網域獨占一行，一屏只看得到約 11 篇；relations_mobile 的「最常被提及」每列兩行，另見 ranking_mobile 拆表後表頭重複 —— 手機要捲很久 —— 網域併入日期那一行或在手機上省略，計數改放右側，前 30 名合成一張表。
2. [一致性／導覽] [tags、ranking、relations_desktop、my-signed-in] [desktop] 分頁籤有時在 H1 上方、有時在下方，期間分頁籤又跑到右上角，離圖表與標題都遠 —— 使用者每頁都得重新找控制項 —— 統一放在 H1 下方，篩選緊鄰它控制的內容。
3. [無障礙] [tags_desktop、relations_desktop] [兩者] 標籤計數「39 站」、後段細體標籤、關係圖節點標籤都是淺灰小字，對比與可讀性不足；部分節點標籤與圖示重疊（例如 Shuo-jen Blog 與 SJH 節點） —— 弱視或戶外閱讀有困難 —— 次要文字的對比提高到 4.5:1，圖上標籤加背景底色並避讓重疊。
4. [色彩] [tags-empty、ranking-empty] [兩者] 正常的「還沒有資料」用黃色或橘色框，視覺上接近警示 —— 和真正的錯誤狀態混淆 —— 空資料改用中性或品牌淡綠，黃色只留給需要注意的狀態。
5. [間距與版面] [login、login-error、my-signed-in] [desktop] 登入內容從 x≈432 起靠左，不在格線也沒置中；my-signed-in 的「旅遊 →」箭頭點下去會到哪裡不明確，部落格名稱是黑字，看不出是連結 —— 視覺不穩，點擊預期模糊 —— 登入區塊對齊主格線或置中成卡片，部落格名稱用連結樣式，分類改成標籤。

## 組 C
一句話總評：參考網站是傳統的名錄與列表型產品，內容直接、密度高，但沒有提供任何載入、空資料、錯誤狀態，視覺系統較樸素，手機版多半只是單欄堆疊。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 6.5 | ooh-directory-home_desktop：首頁以分類目錄為主，網站用途靠文字說明；ooh-directory-recent_desktop：最近更新的部落格列表，名稱與文章標題是主角，但缺少視覺上的重點區。 |
| 字體排印 | 7 | ooh-directory-home／recent_desktop：以內文字為主的排版，可讀性尚可；blogblog-club_desktop：中文列表字級偏小。 |
| 色彩 | 6 | 四個網站都以淺底文字列表為主，品牌色使用克制，語意色幾乎沒有出現（四組 desktop 截圖）。 |
| 間距與版面 | 6.5 | blogroll-org_desktop：單欄列表，1440 寬兩側留白很多；ooh-directory-home_desktop 的多欄分類運用了寬度。 |
| 一致性 | 7 | 各網站內部元件少，自然一致（ooh-directory 首頁與 recent 頁的列表樣式相同）。 |
| 資訊密度 | 7 | ooh-directory-recent_desktop：一屏可見多筆部落格與更新時間；blogblog-club_mobile：列表連續，資訊量高。 |
| 導覽 | 6 | ooh-directory-home_mobile：分類目錄在手機上變成長串單欄；blogroll-org_mobile：沒有看到篩選或分頁籤。 |
| 狀態與回饋 | 4 | 只有 8 張一般內容截圖，沒有載入、空資料、錯誤、無結果、登入等狀態可評，依規定給保守分。 |
| 響應式 | 6.5 | blogroll-org_mobile、ooh-directory-recent_mobile：沒有看到橫向溢出，但只是單欄縮排，手機上沒有專屬的導覽或密度調整。 |
| 文案 | 7 | ooh-directory-home_desktop：用語直白、以使用者為中心；blogblog-club_desktop：中文標示清楚。 |
| 無障礙 | 6 | 文字連結為主，點擊範圍偏小（ooh-directory-recent_mobile 的列表連結）；看不到焦點樣式線索。 |
| 動畫與轉場 | 4 | 截圖中沒有骨架、讀取提示或選單展開等線索，給保守分。 |

要保留的優點：
- ooh-directory-recent 以「最近更新」為核心的列表：部落格名稱、文章標題、時間緊湊排列，密度高。
- ooh-directory-home 的分類目錄：一眼看出收錄範圍。
- blogroll-org 的單欄名錄：每個部落格附簡介，容易判斷要不要點。
- blogblog-club 的中文名錄：直接列出部落格與文章，沒有多餘裝飾。

最重要的五個問題（由嚴重到輕微）：
1. [狀態與回饋] [全部參考頁] [兩者] 沒有可見的載入、空資料、錯誤或無結果設計可供比較 —— 無法證明異常情境好用 —— 補上狀態設計。
2. [響應式] [ooh-directory-home_mobile、blogroll-org_mobile] [mobile] 手機只是把桌面列表單欄堆疊，分類目錄變成很長的捲動 —— 手機上找東西效率低 —— 改用摺疊分類或篩選。
3. [色彩] [blogroll-org_desktop、ooh-directory-recent_desktop] [desktop] 配色樸素，語意色幾乎沒有 —— 狀態與重點難以區分 —— 建立品牌色與語意色系統。
4. [無障礙] [ooh-directory-recent_mobile] [mobile] 列表文字連結的點擊範圍小 —— 手機容易誤觸 —— 整列可點並加大行高。
5. [間距與版面] [blogroll-org_desktop] [desktop] 單欄列表在 1440 寬下兩側大量留白 —— 寬螢幕空間沒有善用 —— 加上側欄篩選或改成多欄卡片。

```json
{"A": {"scores": [6.5,7,6.5,6,6,6,6.5,5,6,6,6,5], "issues": ["[狀態與回饋] tags-empty/ranking-empty/topic-not-found/login-error/relations-error 兩者：只有一行灰字或灰框，沒有圖示、語意色與下一步按鈕", "[資訊層級] tags-selected 兩者：選了標籤後整片標籤雲重列，選中狀態沒有標示，手機一屏看不到任何文章", "[響應式] my-signed-in_mobile：curl 單行被切成「'https」，金鑰資訊截成「最後使用 2026/1…」", "[資訊密度] relations-30 兩者：138 個節點擠成一團、標籤重疊；relations_desktop 右欄下半部大片空白", "[一致性/文案] my-signed-out/tags/ranking：「我的閱讀」對導覽「追蹤」、分頁籤叫法不一，排行混入「未分類」「Uncategorized」"]}, "B": {"scores": [8,7.5,8,8,7.5,7.5,7.5,8.5,7.5,8,7,6.5], "issues": ["[資訊密度] tags-selected_mobile：每篇文章 4 行，網域獨占一行，一屏只有約 11 篇；另見 relations_mobile 每列兩行、ranking_mobile 拆成兩表表頭重複", "[一致性/導覽] tags/ranking/relations/my-signed-in desktop：分頁籤有時在 H1 上方、有時在下方，期間分頁籤跑到右上角，離圖表太遠", "[無障礙] tags_desktop/relations_desktop：計數、後段標籤、圖上節點標籤是淺灰小字，對比不足，部分標籤與節點重疊", "[色彩] tags-empty/ranking-empty：正常的「還沒有資料」用黃色或橘色框，像警示，容易和錯誤混淆", "[間距與版面] login/login-error desktop：內容從 x≈432 靠左，不在格線也沒置中；my-signed-in 的「旅遊 →」連結去向不明"]}, "C": {"scores": [6.5,7,6,6.5,7,7,6,4,6.5,7,6,4], "issues": ["[狀態與回饋] 全部參考頁：沒有載入、空資料、錯誤、無結果狀態可供評估", "[響應式] ooh-directory-home_mobile/blogroll-org_mobile：手機只是單欄堆疊，分類目錄很長", "[色彩] blogroll-org/ooh-directory desktop：配色樸素，缺少語意色系統", "[無障礙] ooh-directory-recent_mobile：文字連結點擊範圍小", "[間距與版面] blogroll-org_desktop：1440 寬下單欄列表，兩側留白很多"]}}
```
