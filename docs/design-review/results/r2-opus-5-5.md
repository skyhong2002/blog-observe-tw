# r2 blind review: opus-5-5

Round 2. Baseline = main at ebffbef re-shot in pure replay mode with clipped full-page capture (fixes the r1 artifacts: 100vh blow-up, empty follows fixture, a desktop shot taken while recording). New = commit 84ac142 (round-1 fixes). Reviewer: claude-proxy claude-opus-5-5, effort high, fresh context.

- Brief: `brief.md`, SHA-256 `8c002ebe6e72b6b5d322e5b350d797c3893501d769f40f68703ea872fbef5539`
- Mapping (revealed after the review): **A = new**, **B = baseline**, **C = reference**
- New set: `r2`

| Set | Mean of 12 scores |
|---|---:|
| new (A) | 7.42 |
| baseline (B) | 6.83 |
| reference (C) | 6.5 |

| 項目 | new | baseline | reference |
|---|---:|---:|---:|
| 資訊層級 | 7.5 | 7.5 | 7 |
| 字體排印 | 7.5 | 7.5 | 7 |
| 色彩 | 7 | 6.5 | 6 |
| 間距與版面 | 7.5 | 7.5 | 7 |
| 一致性 | 7.5 | 6.5 | 7 |
| 資訊密度 | 7 | 7 | 7 |
| 導覽 | 7.5 | 7 | 6.5 |
| 狀態與回饋 | 8.5 | 6 | 5 |
| 響應式 | 7.5 | 7 | 6.5 |
| 文案 | 8 | 7 | 7.5 |
| 無障礙 | 7 | 6.5 | 6.5 |
| 動畫與轉場 | 6.5 | 6 | 5 |

Raw reviewer output below, unedited.

---

## 組 A
一句話總評：版面與元件已經成熟，空資料、錯誤、不存在這幾種狀態處理得最完整，文案也最一致。剩下的問題集中在關係圖的可讀性和少數細節。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7.5 | ranking-dark_desktop：H1「標籤收錄排行」→ 更新時間 → 前十名長條圖 → 完整表格，主次清楚。relations_desktop：圖表下方左右兩欄「最常被提及」「互相提及」，數字靠右對齊。不過 ranking 表格的名次數字很小、偏灰，不顯眼。 |
| 字體排印 | 7.5 | about_desktop：內文行長約 760px，行高寬鬆，中英混排（User-Agent、robots.txt）不擠。不同頁面的 H1 字級一致。relations-30_mobile 圖上的節點標籤（「AngeCl' s GitHub Pages」「官大為的部落格｜Wiwi.Blog」）疊在節點上，無法閱讀。 |
| 色彩 | 7 | 全站用綠色當品牌色：導覽的作用中項目、主要按鈕、長條圖。語意色有系統：relations-error 用紅底、警示圖示和紅框按鈕；ranking-empty 用黃底和時鐘圖示。ranking-dark_desktop 深色外觀成立，但長條是高飽和亮綠，面積大，刺眼。 |
| 間距與版面 | 7.5 | 1120px 內容欄，左右對齊一致。my-signed-in_desktop 的追蹤清單卡片和 API 區塊節奏穩定。ranking_desktop／ranking-dark_desktop 的表格拉滿全寬，「部落格」欄落在中段，離標籤名稱很遠，中間是大片空白。 |
| 一致性 | 7.5 | 分段控制（最近引用／關係圖、近 7／30／90 天、追蹤清單／個人 RSS／匯出 OPML）在各頁樣式相同。空資料、錯誤、404 的卡片都是「圖示 + 標題 + 說明 + 按鈕」同一套（ranking-empty、relations-error、login-error、not-found）。 |
| 資訊密度 | 7 | relations_desktop 的前 20 名列表加「顯示全部 41 筆」適中。ranking_mobile 每列約 44px，一屏大約 28 列。ranking-dark_desktop 表格單欄太寬，資訊密度偏低。 |
| 導覽 | 7.5 | 桌面頂部導覽 8 項加分隔線，目前所在項目用綠底標示。手機頁首有搜尋、主題、登入、選單四個入口。ranking-dark_desktop 頂部導覽亮的是「標籤」，子分頁卻是「最新文章／文章標籤／標籤收錄排行」，「最新文章」放在標籤底下，歸屬不清。 |
| 狀態與回饋 | 8.5 | ranking-empty_desktop：「排行還沒有資料」加原因說明，再給「看最新文章」按鈕。login-error_desktop：「登入沒有完成」，並說明「可能是逾時或瀏覽器擋了 Cookie」。not-found_desktop 提供回首頁、部落格目錄、話題排行三個出口。relations-loading 有文字「正在載入近 7 天的關係資料…」和骨架。 |
| 響應式 | 7.5 | my-signed-in_mobile：「訂閱個人 RSS／匯出 OPML」改成卡片內的按鈕列，curl 範例會自動換行。not-found_mobile 三顆按鈕斷成兩列，「話題排行」單獨落在第二列。relations-30_mobile 的圖在 390 寬時糊成一團。my-signed-in_mobile 金鑰列「最後使用 2026/1…」被截斷。 |
| 文案 | 8 | 導覽「追蹤」、頁面標題「我的追蹤」、about 頁的「管理我的追蹤 →」三處叫法一致。導覽「引用」對應頁面標題「引用關係圖」。錯誤訊息用口語寫出原因和下一步（login-error），沒有系統字串外露。 |
| 無障礙 | 7 | 錯誤狀態同時用圖示、顏色和文字表達（relations-error 的 ⚠）。ranking 表的名次數字和 footer 版權列是小字淺灰，對比偏低。my-signed-in_desktop 停用的「建立金鑰」是灰色按鈕，沒有說明為什麼不能按。截圖看不出焦點樣式。 |
| 動畫與轉場 | 6.5 | relations-loading_desktop／mobile 有骨架加讀取文字，但骨架是列表形狀，和關係圖、排行的實際版面對不上。靜態截圖看不到其他轉場，保守給分。 |

要保留的優點：
- ranking-empty、relations-error、login-error、not-found 這套「圖示 + 標題 + 原因 + 行動按鈕」的狀態卡，語意色清楚。
- 「追蹤」「我的追蹤」「管理我的追蹤」與「引用」「引用關係圖」的命名一致。
- my-signed-in_desktop 把追蹤清單收進卡片，標題列直接放「訂閱個人 RSS／匯出 OPML」，主要動作就在旁邊。
- relations_desktop 的「全部連結／互相提及／提及 3 篇以上」篩選，加上右上角「60 個部落格・78 條連結」摘要。
- 每頁底部都有「本頁的資料來源與計算方式」可展開，資料透明度高。

最重要的五個問題（由嚴重到輕微）：
1. [響應式／字體排印] [relations-30_mobile] [mobile] 138 個節點擠在 390 寬的圖上，「AngeCl' s GitHub Pages」「官大為的部落格｜Wiwi.Blog」等標籤和節點互相重疊（另見 relations_mobile）。—— 關係圖是這頁的主角，手機上完全讀不出來。—— 手機預設改用「提及 3 篇以上」或只顯示前 N 名，標籤只留給前幾名，其餘點擊才顯示。
2. [資訊層級／間距] [ranking-dark_desktop] [desktop] 表格撐滿 1120px，「部落格」數字欄離標籤名稱約 550px，名次是極小的灰字（另見 ranking_desktop）。—— 一列資料得橫向掃很遠，容易對錯行。—— 限制表格寬度或把數字欄靠近名稱，名次字級和對比調高。
3. [導覽] [ranking-dark_desktop] [desktop] 頂部導覽亮「標籤」，子分頁卻包含「最新文章」。—— 使用者搞不清楚現在在哪一區，「最新文章」的歸屬也混亂。—— 子分頁只留和標籤相關的項目，「最新文章」回到「文章」區。
4. [動畫與轉場] [relations-loading_desktop] [兩者] 關係圖讀取中顯示的是 6 列列表骨架，和實際的「圖 + 雙欄列表」版面不同。—— 載入完成時版面會大幅跳動，骨架也沒有傳達接下來會出現什麼。—— 骨架改成一個圖表區佔位，加上兩欄列表的骨架。
5. [響應式／無障礙] [my-signed-in_mobile] [mobile] 金鑰列「最後使用 2026/1…」被截斷；desktop 上停用的「建立金鑰」灰按鈕沒有說明原因。—— 金鑰最後使用時間是安全相關資訊，不該被截掉；按鈕停用的條件不明。—— 時間換行顯示；在輸入框加提示，例如「輸入名稱後即可建立」。

## 組 B
一句話總評：主要頁面的版面和 A 幾乎相同，品質也相近，但空資料和錯誤狀態退化成一行灰字或文字連結，命名不一致，手機上還有程式碼區塊溢出。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7.5 | ranking-dark_mobile：H1 → 更新時間 → 分頁 → 圖表 → 表格。B 把分頁放在標題下方（「收錄排行／探索標籤」），層級較合理。relations_desktop 和 A 相同。 |
| 字體排印 | 7.5 | about_desktop／about-dark_mobile 內文排版和 A 相同，行高舒適。relations-30_mobile 的節點標籤同樣重疊（「AngeCl' s GitHub Pages」疊在 A 節點上）。 |
| 色彩 | 6.5 | 綠色品牌色和深色外觀成立（about-dark_desktop、ranking-dark_mobile）。錯誤狀態沒有語意色：relations-error_desktop 是灰框、黑字加綠色文字連結，看起來和一般提示一樣。my-signed-in_desktop 的「建立金鑰」是淡綠色，看不出是停用還是可按。 |
| 間距與版面 | 7.5 | 網格和 A 相同。my-signed-in_desktop 的追蹤清單沒有卡片外框，只用分隔線，「3 個追蹤網站」和右側連結之間空很多。not-found_desktop 內容只佔左上一小塊，下面大片空白。 |
| 一致性 | 6.5 | 各頁狀態樣式不一：ranking-empty 只有灰字「目前沒有可列出的標籤。」；login-error 是白框黑字；relations-error 是灰框加文字連結；not-found 是標題加連結。my-signed-in_desktop 的部落格名稱是綠色連結，和其他頁的列表樣式不同。 |
| 資訊密度 | 7 | 主要列表頁和 A 相同。my-signed-in_desktop 每列只有名稱和極小的灰色分類字（「旅遊」），右側留白多。 |
| 導覽 | 7 | ranking-dark_mobile 的「收錄排行／探索標籤」分頁範圍合理。not-found_desktop／mobile 只有「前往部落格目錄 →」一個出口，沒有回首頁。 |
| 狀態與回饋 | 6 | ranking-empty_desktop 只有一行灰字，沒有原因也沒有下一步。login-error_mobile「登入未完成，請重新開始。」沒說原因。relations-error_desktop 的重試只是文字連結。讀取中（relations-loading）和 A 相同，有文字和骨架。 |
| 響應式 | 7 | my-signed-in_mobile 的 curl 程式碼區塊橫向溢出，文字在「'https」處被切掉，沒有換行也看不出能捲動。其他頁面的手機排版和 A 相同。 |
| 文案 | 7 | 導覽是「追蹤」，頁面標題卻是「我的閱讀」（my-signed-out_desktop），about 頁連結寫「管理我的閱讀 →」。導覽是「引用」，頁面標題卻是「部落格關係圖」（relations_desktop）。「3 個追蹤網站」又用了「網站」這個說法，三種叫法混在一起。 |
| 無障礙 | 6.5 | 錯誤訊息只靠文字，沒有圖示和顏色輔助，比較不醒目（relations-error_mobile）。my-signed-in_desktop 淡綠色的「建立金鑰」上白字對比不足。分類字小而淺。 |
| 動畫與轉場 | 6 | relations-loading 和 A 相同（列表骨架加文字），一樣和實際版面對不上。沒有其他可見線索，保守給分。 |

要保留的優點：
- ranking-dark_mobile 把分頁放在 H1 下方，只放「收錄排行／探索標籤」，範圍清楚。
- relations 和 ranking 的圖表與列表結構完整，和 A 一樣有篩選和摘要數字。
- 深色外觀（about-dark、ranking-dark）背景和文字對比足夠，綠色連結在深色底上清楚。
- 讀取中狀態有文字「正在載入近 7 天的關係資料…」，不是空白畫面。

最重要的五個問題（由嚴重到輕微）：
1. [狀態與回饋] [ranking-empty_desktop] [兩者] 空資料只有一行灰字「目前沒有可列出的標籤。」，沒有原因也沒有行動按鈕（另見 login-error「登入未完成，請重新開始。」、not-found 只有一個連結）。—— 使用者不知道是暫時沒資料還是壞了，也不知道下一步去哪。—— 統一成「圖示 + 標題 + 原因 + 主要按鈕」的狀態卡。
2. [響應式] [my-signed-in_mobile] [mobile] curl 範例程式碼區塊橫向溢出，在「'https」處被切掉。—— 使用者看不到完整網址，也無法照抄。—— 允許換行（break-all），或加上明顯的橫向捲動提示和複製按鈕。
3. [文案] [my-signed-out_desktop] [兩者] 導覽是「追蹤」、頁面標題是「我的閱讀」、清單寫「追蹤網站」；導覽是「引用」、頁面標題是「部落格關係圖」（relations_desktop）。—— 同一個功能有三種叫法，使用者會懷疑點錯了頁。—— 導覽、標題、連結統一用同一個名詞。
4. [色彩／無障礙] [relations-error_desktop] [兩者] 錯誤狀態是灰框黑字，重試只是綠色文字連結，沒有警示圖示和語意色。—— 錯誤不夠醒目，重試的點擊範圍也小。—— 加入警示色、圖示和按鈕型的「重新載入」。
5. [響應式／字體排印] [relations-30_mobile] [mobile] 關係圖的節點和標籤嚴重重疊（另見 relations_mobile）。—— 手機上這張圖無法使用。—— 手機改用篩選後的子圖，或以列表為主、圖為輔。

## 組 C
一句話總評：幾個參考站以清楚的文字列表為主，克制、好讀，但視覺個性和狀態回饋少，截圖只有首頁和最新頁，能評的範圍有限。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7 | ooh-directory-home_desktop 用分類目錄當主要入口；ooh-directory-recent_desktop 依時間列出最近更新的部落格和文章。部落格名稱、標題是主要層級，網站用途很快就看得懂。 |
| 字體排印 | 7 | 四組截圖都是以內文字為主的排版，英文行長和行高合理。blogblog-club 是中文介面，排版可讀，但字級層次比較少。 |
| 色彩 | 6 | 大多是白底、黑字加連結色，品牌色的使用很節制。語意色和深色外觀在截圖中看不到。 |
| 間距與版面 | 7 | ooh-directory 和 blogroll-org 桌面版是單欄或雙欄的穩定網格。1440 寬時兩側留白多，空間利用偏保守。 |
| 一致性 | 7 | 同一站內的列表樣式和連結樣式一致（ooh-directory-home 和 recent 對照可見）。 |
| 資訊密度 | 7 | 文字列表的密度高，一屏內容多（ooh-directory-recent_desktop）。手機版列表較長。 |
| 導覽 | 6.5 | 有分類和最近更新等入口。手機版（ooh-directory-home_mobile、blogroll-org_mobile）主要靠捲動，目前位置的標示比較弱。 |
| 狀態與回饋 | 5 | 截圖只涵蓋有資料的頁面，看不到載入、空資料、錯誤的處理，保守給分。 |
| 響應式 | 6.5 | mobile 截圖沒有橫向溢出，但大多是桌面版的單欄化，沒有針對手機重新設計。 |
| 文案 | 7.5 | 用詞直白、少術語，各站清楚說明自己收錄什麼。 |
| 無障礙 | 6.5 | 文字對比大致足夠，但連結多為純文字，點擊範圍小，手機上尤其明顯。 |
| 動畫與轉場 | 5 | 截圖中沒有骨架、讀取提示或選單展開等線索，保守給分。 |

要保留的優點：
- ooh-directory 用分類目錄當主要入口，探索路徑直觀。
- 「最近更新」列表把時間放在主軸，容易追新文章。
- 克制的文字排版，讓部落格名稱和標題成為主角。
- blogblog-club 是中文環境下的直接參照，說明了中文列表的排版做法。

最重要的五個問題（由嚴重到輕微）：
1. [狀態與回饋] [全部截圖] [兩者] 看不到任何載入、空資料、錯誤狀態的設計。—— 無法驗證異常情況下的體驗。—— 參照時只取它們的列表與分類結構。
2. [色彩] [ooh-directory-home_desktop] [desktop] 配色接近預設樣式，品牌辨識度低。—— 很難留下印象。—— 品牌色可以用在分類和重點數字上。
3. [響應式] [blogroll-org_mobile] [mobile] 手機版基本上是桌面版改成單欄，入口要往下捲很久才到。—— 手機上找分類的效率低。—— 手機版把分類入口和搜尋放在前面。
4. [無障礙] [ooh-directory-recent_mobile] [mobile] 文字連結的點擊範圍小，靠得很近。—— 手機上容易點錯。—— 加大行距和點擊區域。
5. [間距與版面] [ooh-directory-home_desktop] [desktop] 1440 寬時內容窄、兩側大片留白。—— 寬螢幕的空間利用不足。—— 大螢幕可以考慮側欄放分類或最近更新。

```json
{"A": {"scores": [7.5,7.5,7,7.5,7.5,7,7.5,8.5,7.5,8,7,6.5], "issues": ["[響應式/字體排印] relations-30_mobile（另見 relations_mobile）關係圖節點與標籤嚴重重疊，手機上無法閱讀；建議手機預設用篩選子圖、只標前幾名", "[資訊層級/間距] ranking-dark_desktop（另見 ranking_desktop）表格撐滿全寬，部落格數欄離標籤名稱很遠，名次是小灰字；建議縮窄表格、名次加大加深", "[導覽] ranking-dark_desktop 導覽亮「標籤」但子分頁含「最新文章」，歸屬不清；建議子分頁只留標籤相關項目", "[動畫與轉場] relations-loading 兩種尺寸都用列表骨架，和實際的圖表加雙欄版面對不上，載入完會跳動；建議骨架反映圖表區與雙欄", "[響應式/無障礙] my-signed-in_mobile 金鑰「最後使用 2026/1…」被截斷；desktop 停用的「建立金鑰」灰按鈕沒說明原因"]}, "B": {"scores": [7.5,7.5,6.5,7.5,6.5,7,7,6,7,7,6.5,6], "issues": ["[狀態與回饋] ranking-empty 只有一行灰字，沒有原因或下一步（另見 login-error「登入未完成，請重新開始。」、not-found 只有單一連結）；建議統一成圖示+原因+按鈕的狀態卡", "[響應式] my-signed-in_mobile 的 curl 程式碼區塊橫向溢出，在 'https 處被切掉；建議允許換行或加複製按鈕", "[文案] 導覽「追蹤」對頁面標題「我的閱讀」、清單「追蹤網站」；導覽「引用」對標題「部落格關係圖」，叫法不一致", "[色彩/無障礙] relations-error 是灰框黑字，重試只是文字連結，沒有警示圖示和語意色；建議加警示色和按鈕", "[響應式/字體排印] relations-30_mobile（另見 relations_mobile）關係圖節點與標籤重疊，手機上無法使用"]}, "C": {"scores": [7,7,6,7,7,7,6.5,5,6.5,7.5,6.5,5], "issues": ["[狀態與回饋] 截圖只有有資料的頁面，看不到載入、空資料、錯誤狀態", "[色彩] ooh-directory-home_desktop 配色接近預設樣式，品牌辨識度低", "[響應式] blogroll-org_mobile 基本上是桌面版改單欄，分類入口要往下捲很久", "[無障礙] ooh-directory-recent_mobile 文字連結點擊範圍小、彼此太近", "[間距與版面] ooh-directory-home_desktop 在 1440 寬時內容窄、兩側大片留白"]}}
```
