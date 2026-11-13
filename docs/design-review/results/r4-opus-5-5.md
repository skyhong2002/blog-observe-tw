# r4 blind review: opus-5-5

Round 4. Baseline = main at ebffbef (fixed set). New = commit 01a6e4d (round-3 fixes). Reviewer: claude-proxy claude-opus-5-5, effort high, fresh context.

- Brief: `brief.md`, SHA-256 `8c002ebe6e72b6b5d322e5b350d797c3893501d769f40f68703ea872fbef5539`
- Mapping (revealed after the review): **A = new**, **B = baseline**, **C = reference**
- New set: `r4`

| Set | Mean of 12 scores |
|---|---:|
| new (A) | 7.75 |
| baseline (B) | 6.92 |
| reference (C) | 6.08 |

| 項目 | new | baseline | reference |
|---|---:|---:|---:|
| 資訊層級 | 8 | 7.5 | 6.5 |
| 字體排印 | 7.5 | 7 | 7 |
| 色彩 | 8 | 7.5 | 5.5 |
| 間距與版面 | 7.5 | 7 | 6.5 |
| 一致性 | 8 | 7 | 7 |
| 資訊密度 | 7.5 | 7 | 6.5 |
| 導覽 | 8 | 7.5 | 6 |
| 狀態與回饋 | 8.5 | 6.5 | 4 |
| 響應式 | 8 | 6.5 | 6.5 |
| 文案 | 8 | 7 | 7 |
| 無障礙 | 7 | 6.5 | 6.5 |
| 動畫與轉場 | 7 | 6 | 4 |

Raw reviewer output below, unedited.

---

## 組 A
一句話總評：產品成熟度高，錯誤、404、讀取中等狀態都有完整設計，手機版的關係圖也有特別處理；剩下的問題集中在桌面關係圖太擁擠、未登入頁的技術說明太多，以及少數間距和小字。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 8 | my-signed-in_desktop：「追蹤中的部落格 3 個」卡片標頭和「訂閱個人 RSS／匯出 OPML」放在同一列，主要動作很清楚。not-found_desktop：大標題、說明和主要按鈕「回首頁」的主次分明。relations-30_desktop：138 個節點全部擠在一起，「AngeCl's GitHub Pages」「資工小廢物 - JN」的標籤和圖示互相疊住，看不出重點。 |
| 字體排印 | 7.5 | about_desktop：內文行長約 760px，行高寬鬆，中英混排（RSS、Atom、User-Agent）的間距自然。my-signed-in_mobile：curl 指令在程式碼區塊內換行，沒有溢出。relations_desktop 清單右側「13 個部落格提及 ・ 13 篇」和右上「60 個部落格・78 條連結」約 11–12px 的淺灰字，偏小。 |
| 色彩 | 8 | 全站用綠色當品牌色（導覽目前頁的底色、主要按鈕「使用 Google 登入」、篩選鈕「全部連結」）。relations-error_desktop 和 login-error_desktop 用淡紅底、紅框加警示三角形，語意色正確。topics-dark_desktop 深色背景配亮綠文字雲和表格連結，深色外觀成立。 |
| 間距與版面 | 7.5 | 1120px 內容欄配 1440 視窗，左右對齊一致。relations_desktop：右側「互相提及」只有 3 組，卻被拉到和左側 20 列清單一樣高，下方留下約 550px 空白。topics-dark_desktop：「部落格」「文章」「標題提到／只在內文」三欄分散在整個寬度，數字離話題名稱太遠。 |
| 一致性 | 8 | 分段控制（最近引用／關係圖、近 7／30／90 天、追蹤清單／個人 RSS／匯出 OPML）在 relations、my 各頁樣式一致。頁尾、「本頁的資料來源與計算方式」摺疊列每頁都有。不過 topics-dark_desktop 的期間切換放在右上角，relations_desktop 卻放在標題下方，位置不一致。 |
| 資訊密度 | 7.5 | relations_mobile 清單把名稱和「13 個部落格提及 ・ 13 篇」分成兩行，完整名稱不截斷，但每列較高，一屏約 11 筆。topics-dark_desktop 一屏約 60 列話題表，密度適中。my-signed-out_desktop：未登入也展開整段 API 金鑰說明，占掉半屏。 |
| 導覽 | 8 | 桌面頂部導覽有分組分隔線，目前頁「引用」「追蹤」以綠底標示。手機頁首有搜尋、深色切換、登入、選單四個圖示，點擊範圍足夠。not-found_mobile 提供「回首頁／部落格目錄／話題排行」三條全寬的出路。 |
| 狀態與回饋 | 8.5 | relations-loading_desktop／mobile：有「正在載入近 7 天的關係資料…」文字，加上圖形區的圓點骨架和清單骨架。relations-error：紅色警示加「重新載入」按鈕。login-error_desktop：標題「登入沒有完成」並說明可能原因（逾時或瀏覽器擋了 Cookie）。my-signed-out：用卡片引導登入。 |
| 響應式 | 8 | relations-30_mobile 自動切到「提及 3 篇以上」（20 個部落格、15 條連結），390 寬也看得懂。my-signed-in_mobile 的 API 金鑰資訊分三行，程式碼換行。not-found_mobile 的按鈕改成全寬堆疊。手機的頁尾連結改為兩欄。 |
| 文案 | 8 | 錯誤文案自然，例如「關係資料暫時無法載入，請稍後再試。」、「網址可能打錯了…可以從目錄或排行重新找到它」。my-signed-in_desktop 的提示「先輸入名稱，就能建立金鑰。」很好。my-signed-out 對一般讀者露出「SHA-256 雜湊」「每分鐘可呼叫 1000 次」等技術細節。 |
| 無障礙 | 7 | 手機版按鈕和分頁籤高度約 44px。錯誤狀態同時用圖示和文字，不只靠顏色。桌面版大量 11–12px 淺灰說明字（relations_desktop 的計數、頁尾版權列）對比偏低。截圖中看不到焦點樣式。 |
| 動畫與轉場 | 7 | 依據 relations-loading 的圖形骨架（灰色圓點，大致依節點分布排列）和清單骨架判斷，切換時版面應該不會大幅跳動。靜態截圖看不到實際過場，給保守分數。 |

要保留的優點：
- relations-loading_desktop／mobile：關係圖區域用灰色圓點骨架占位，加上「正在載入近 7 天的關係資料…」文字。
- relations-30_mobile：手機自動改用「提及 3 篇以上」，把 138 個節點減到 20 個，讓小螢幕也看得懂。
- not-found（兩種尺寸）：虛線卡片、圖示加三條出路，手機改成全寬堆疊按鈕。
- login-error：清楚的標題和原因說明（逾時或 Cookie），重試按鈕就在下面。
- my-signed-in：卡片標頭集中 RSS／OPML 動作；建立金鑰按鈕停用時有提示文字。
- ranking-dark_mobile：摘要卡（列出的標籤 98、最多部落格在用「台中美食」），並說明已略過「未分類、Uncategorized」等平台預設分類。

最重要的五個問題（由嚴重到輕微）：
1. [資訊層級] [relations-30_desktop] [desktop] 近 30 天在桌面預設顯示「全部連結」，138 個節點和 260 條線糾成一團，「AngeCl's GitHub Pages」「官大為的部落格 | Wiwi.Blog」的標籤和圖示互相重疊 —— 這是這一頁的主視覺，現在幾乎無法解讀，而手機已經有更好的預設 —— 建議桌面在節點多時也預設「提及 3 篇以上」，或只標示前 N 名的名稱，其餘滑過才顯示。
2. [文案] [my-signed-out] [兩者] 未登入的讀者就看到完整的 API 金鑰說明（SHA-256 雜湊、每分鐘 1000 次、每帳號 3 把） —— 主要使用者是讀者，這些開發者資訊干擾「登入以保存閱讀清單」這個主要動作 —— 建議未登入時把 API 段落收成一行「開發者：API 文件 →」。
3. [間距與版面] [relations_desktop] [desktop] 「互相提及」卡片只有 3 組，卻被拉到和左側清單同高，留下約 550px 空白（另見 relations-30_desktop 右欄下半部） —— 雙欄看起來失衡，像內容沒載完 —— 建議卡片高度跟內容走，或在桌面把「互相提及」放到清單上方，改成橫向排列。
4. [無障礙] [relations_desktop] [desktop] 計數「60 個部落格・78 條連結」、清單的「13 個部落格提及 ・ 13 篇」、topics-dark_desktop 的表頭都是約 11–12px 的淺灰字 —— 數字是這些頁面的重點資訊，字小又對比低，閱讀吃力 —— 建議提高到 13–14px，加深灰階對比。
5. [一致性] [topics-dark_desktop] [desktop] 話題頁的期間切換放在右上角，relations_desktop 卻放在標題下方。同一頁的標題也叫法不一：導覽是「引用」、子分頁是「關係圖」、頁標題是「引用關係圖」 —— 同一種控制換位置，使用者要重新找 —— 建議期間切換統一放在標題下方，命名統一成同一組詞。

## 組 B
一句話總評：骨架和 A 相同，但多處狀態頁退化成灰框加文字連結，手機上程式碼溢出、名稱截斷，關係圖在小螢幕太擁擠，整體完成度明顯比 A 低一截。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7.5 | my-signed-in_desktop：清單只有灰色小字「3 個追蹤網站」當標頭，RSS／OPML 是右側小連結，主要動作不明顯。not-found_desktop：只有標題、一行說明、一個文字連結，下方大片空白。relations-30_desktop 同樣是 138 個節點互相重疊。 |
| 字體排印 | 7 | about_desktop 內文的行長和行高良好。my-signed-in_mobile：金鑰資訊擠成一行，被截成「最後使用 2026/1…」。relations_mobile 清單名稱被截成「官大為的部落格 | W…」「NudoBlog - 小透明…」。topic-dark_desktop 部落格清單的「（標題 68／僅正文 0）」極小字。 |
| 色彩 | 7.5 | 品牌綠和深色模式（topics-dark_desktop、ranking-dark_desktop）都成立。但 relations-error、login-error 都用灰框黑字，沒有任何警示色。my-signed-in 的「建立金鑰」是淡綠色，看不出是停用還是可以按。 |
| 間距與版面 | 7 | relations_desktop 右欄「互相提及」同樣有大片空白。topics-trending_desktop 的「升溫倍率／部落格／文章／標題／僅正文」欄位分散，數字離話題名稱很遠。not-found_desktop 內容只占左上一小塊。 |
| 一致性 | 7 | 頁標題「我的閱讀」對上導覽「追蹤」和 about 的「管理我的閱讀」，命名分歧。錯誤樣式不一致：relations-error 是灰框加綠字連結，其他頁面的主要動作卻是實心綠按鈕。ranking-dark_desktop 的子分頁「收錄排行／探索標籤」和 ranking-dark_mobile 的「文章標籤／標籤收錄排行」又是另一套叫法。 |
| 資訊密度 | 7 | relations_mobile 名稱和數字排在同一列，一屏約 16 筆，但名稱被截斷。ranking-dark_desktop 前十名長條圖含「未分類」，表格第 51 名是「Uncategorized」，占用有限的版面。 |
| 導覽 | 7.5 | 頂部導覽、目前頁的綠底標示和 A 相同。not-found 只提供「前往部落格目錄 →」一條出路。手機頁首四個圖示的配置良好。 |
| 狀態與回饋 | 6.5 | relations-loading_desktop／mobile：只有清單骨架，沒有圖形區占位，頁尾在約 700px 處就露出來。relations-error：灰框加綠色文字「重新載入」，不像錯誤。login-error：「登入未完成，請重新開始。」沒有說明原因。 |
| 響應式 | 6.5 | my-signed-in_mobile：curl 程式碼區塊橫向溢出，在 'https 處被切掉。relations-30_mobile：390 寬仍顯示 138 個節點，「AngeCl's GitHub Pages」和其他標籤重疊。relations_mobile 清單名稱被截斷。 |
| 文案 | 7 | topic-dark_desktop 部落格清單出現未解碼的 HTML 實體「Luke Smith&#39;s Webpage」。my-signed-in 用「3 個追蹤網站」，全站其他地方都說「部落格」。404 的「網址可能已變更，請回到目錄繼續探索。」可以接受，但較空泛。 |
| 無障礙 | 6.5 | 錯誤狀態只靠文字位置判斷，沒有圖示也沒有顏色。「重新載入」只是一段文字連結，點擊區域小。淡綠的「建立金鑰」按鈕在白底上對比低。桌面 11–12px 灰字和 A 一樣多。 |
| 動畫與轉場 | 6 | relations-loading 沒有圖形骨架，資料到了之後版面會從約 500px 撐開到約 1500px，可以預期有明顯跳動。其他過場在靜態截圖中看不出來，給保守分數。 |

要保留的優點：
- topics-dark_desktop：深色文字雲裡用臺灣、日本剪影代表地名話題，很有個性。
- ranking-dark_desktop：前十名水平長條圖配完整表格，數字靠右對齊、使用千分位。
- my-signed-out：未登入時用卡片說明 Google 登入的用途（「不會代替你在原站閱讀」）。
- 全站頁尾：大字號 serif 品牌字、「已收錄 698 個部落格」的狀態點、RSS／GitHub／Web App 按鈕。
- relations_desktop：「最常被提及」和「互相提及」雙欄，用 ⇄ 加「→1 篇・←1 篇」表達雙向關係，很簡潔。

最重要的五個問題（由嚴重到輕微）：
1. [響應式] [my-signed-in_mobile] [mobile] curl 程式碼區塊橫向溢出，在 'https 處被切掉；金鑰資訊截成「最後使用 2026/1…」 —— 使用者看不到完整指令，也看不到最後使用時間 —— 建議程式碼允許換行或加上複製按鈕，金鑰的中繼資訊改成多行。
2. [狀態與回饋] [relations-error_desktop] [兩者] 錯誤只是一個灰框加綠色文字連結「重新載入」，沒有圖示和警示色（另見 login-error 的「登入未完成，請重新開始。」沒有說明原因、not-found 只有一條出路） —— 使用者分不出這是錯誤還是一般提示，也不知道下一步 —— 建議統一使用警示樣式（圖示加語意色加按鈕），並寫出原因和多個出路。
3. [響應式] [relations-30_mobile] [mobile] 390 寬仍然顯示 138 個節點和 260 條連結，標籤互相覆蓋；relations_mobile 清單名稱被截成「官大為的部落格 | W…」 —— 手機上關係圖和清單都難以辨識 —— 建議手機預設篩選成較少節點，清單名稱可以換行顯示。
4. [文案] [topic-dark_desktop] [desktop] 部落格名稱出現未解碼的「Luke Smith&#39;s Webpage」；ranking-dark_desktop 的前十名長條圖和表格保留「未分類」「Uncategorized」平台預設分類 —— 系統的字面值外露，排行被雜訊占位 —— 建議解碼 HTML 實體，並排除平台預設分類。
5. [動畫與轉場] [relations-loading_desktop] [兩者] 讀取中只有清單骨架，沒有關係圖占位，頁尾直接出現在第一屏 —— 資料到了之後版面大幅下推，使用者會誤以為這頁沒有圖 —— 建議加上和最終圖形同尺寸的骨架。

## 組 C
一句話總評：參考組是以文字列表為主的傳統部落格名錄或探索網站，排版樸素、可讀，但品牌色和狀態設計很少，截圖也只有 4 頁（各含 desktop 和 mobile），能評估的範圍有限。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 6.5 | ooh-directory-home_desktop：首頁以分類目錄和說明文字為主，網站用途清楚。ooh-directory-recent_desktop：最近更新列表的部落格名稱、摘要、時間都有，但視覺權重差不多，掃讀時沒有明顯焦點。 |
| 字體排印 | 7 | ooh-directory（兩頁、兩種尺寸）以文字閱讀為中心，字級和行高舒適。blogroll-org_desktop：條目以標題加描述文字堆疊，行長偏長。 |
| 色彩 | 5.5 | 四組截圖都偏向淺色背景配預設感的連結色，品牌識別薄弱，也沒有任何深色外觀截圖可以評估。 |
| 間距與版面 | 6.5 | blogroll-org_desktop、ooh-directory-recent_desktop 在 1440 寬下以單欄或窄欄為主，兩側留白多，大螢幕空間沒有善用。手機版沒有看到溢出。 |
| 一致性 | 7 | 同一站內（ooh-directory-home 和 recent）的列表樣式、標題層級一致。頁面少，元件種類也少，不容易出現不一致。 |
| 資訊密度 | 6.5 | blogroll-org_mobile 和 ooh-directory-recent_mobile 頁面很長，每筆條目占的高度大，一屏只看得到幾筆。桌面版密度中等。 |
| 導覽 | 6 | 頂部只有簡單的文字導覽，看不出目前位置的明顯標示。手機沒有看到收合式選單或分頁籤之類的效率設計。 |
| 狀態與回饋 | 4 | 提供的 8 張截圖都是有資料的正常頁面，沒有讀取中、空資料、錯誤、404、登入前後等狀態可以評估，給保守分數。 |
| 響應式 | 6.5 | blogblog-club_mobile、blogroll-org_mobile 都改成單欄，沒有橫向溢出，但大致是桌面的直接縮排，沒有針對手機重新安排資訊。 |
| 文案 | 7 | 各站的說明文字直接、沒有系統訊息外露。ooh-directory 首頁對收錄範圍有清楚說明。 |
| 無障礙 | 6.5 | 文字多為深色配淺底，對比尚可。連結大多是行內文字，手機上的點擊範圍偏小。截圖中看不到焦點樣式。 |
| 動畫與轉場 | 4 | 沒有任何讀取中、選單展開或切換狀態的截圖，缺乏線索，給保守分數。 |

要保留的優點：
- ooh-directory-home：首頁用分類目錄直接說明能做什麼，探索的入口清楚。
- ooh-directory-recent：最近更新列表把部落格名稱、摘要和時間放在一起，適合掃讀。
- blogroll-org：單一長列表加描述，結構極簡、容易理解。
- 各站手機版都沒有橫向溢出，文字閱讀舒適。

最重要的五個問題（由嚴重到輕微）：
1. [狀態與回饋] [全部截圖] [兩者] 沒有任何讀取中、空資料、錯誤、無結果、404 的呈現可以評估 —— 無法確認例外情況下的體驗 —— 建議作為參考時補上狀態頁的截圖。
2. [色彩] [ooh-directory-home_desktop] [兩者] 配色接近瀏覽器預設，品牌色和語意色都不明顯（另見 blogroll-org_desktop） —— 缺乏識別，也缺乏狀態的視覺語言 —— 建議建立主色和語意色系統，並提供深色外觀。
3. [間距與版面] [blogroll-org_desktop] [desktop] 1440 寬只用到中間的窄欄，兩側大片空白（另見 ooh-directory-recent_desktop） —— 大螢幕一次能看的條目少 —— 建議用雙欄或側欄放分類和篩選。
4. [資訊密度] [blogroll-org_mobile] [mobile] 每筆條目垂直空間大，需要大量捲動（另見 ooh-directory-recent_mobile） —— 手機瀏覽效率低 —— 建議縮減描述行數或採用精簡的列表樣式。
5. [導覽] [blogblog-club_mobile] [mobile] 手機上沒有看到清楚的目前位置標示或篩選、分頁控制 —— 不容易在分類或時間範圍之間移動 —— 建議加入分頁籤或篩選列，並標示目前所在的頁面。

```json
{"A": {"scores": [8, 7.5, 8, 7.5, 8, 7.5, 8, 8.5, 8, 8, 7, 7], "issues": ["[資訊層級] relations-30_desktop desktop：桌面預設全部連結，138 個節點、260 條線重疊成一團，標籤互相覆蓋；手機已改預設『提及 3 篇以上』，桌面應比照或只標前 N 名", "[文案] my-signed-out 兩者：未登入就展開整段 API 金鑰技術說明（SHA-256、每分鐘 1000 次），干擾登入主要動作，建議收成一行開發者連結", "[間距與版面] relations_desktop desktop：『互相提及』只有 3 組卻拉到和左欄同高，留下約 550px 空白（另見 relations-30_desktop）", "[無障礙] relations_desktop desktop：『60 個部落格・78 條連結』、清單計數、topics-dark 表頭等 11–12px 淺灰字對比偏低", "[一致性] topics-dark_desktop desktop：期間切換放在右上，relations 放在標題下方；『引用／關係圖／引用關係圖』命名不一"]}, "B": {"scores": [7.5, 7, 7.5, 7, 7, 7, 7.5, 6.5, 6.5, 7, 6.5, 6], "issues": ["[響應式] my-signed-in_mobile mobile：curl 程式碼區塊橫向溢出，在 'https 處被切斷；金鑰資訊截成『最後使用 2026/1…』", "[狀態與回饋] relations-error_desktop 兩者：錯誤只是灰框加綠色文字連結，沒有警示色和圖示；login-error 沒有說明原因；not-found 只有一條出路", "[響應式] relations-30_mobile mobile：390 寬仍顯示 138 個節點，標籤重疊；relations_mobile 清單名稱被截成『官大為的部落格 | W…』", "[文案] topic-dark_desktop desktop：『Luke Smith&#39;s Webpage』HTML 實體外露；ranking-dark_desktop 前十名含『未分類』，表格有『Uncategorized』", "[動畫與轉場] relations-loading_desktop 兩者：只有清單骨架，沒有圖形占位，資料到了之後版面大幅跳動"]}, "C": {"scores": [6.5, 7, 5.5, 6.5, 7, 6.5, 6, 4, 6.5, 7, 6.5, 4], "issues": ["[狀態與回饋] 全部截圖 兩者：沒有讀取中、空資料、錯誤、404 等狀態可以評估", "[色彩] ooh-directory-home_desktop 兩者：配色接近預設，品牌色和語意色薄弱，沒有深色外觀", "[間距與版面] blogroll-org_desktop desktop：1440 寬只用到窄欄，兩側大片空白", "[資訊密度] blogroll-org_mobile mobile：每筆條目垂直空間大，需要大量捲動", "[導覽] blogblog-club_mobile mobile：手機缺乏目前位置標示和篩選、分頁控制"]}}
```
