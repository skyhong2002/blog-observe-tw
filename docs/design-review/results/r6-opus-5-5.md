# r6 blind review: opus-5-5

Round 6, first round on skyhong-SM: baseline (main at ebffbef), new (commit ad93ae5, round-5 fixes) and references all re-shot on this host, so raw scores start a new segment and are not comparable with r1–r5. Reviewer: claude-proxy claude-opus-5-5, effort high, fresh context (delegate_task).

- Brief: `brief.md`, SHA-256 `8c002ebe6e72b6b5d322e5b350d797c3893501d769f40f68703ea872fbef5539`
- Mapping (revealed after the review): **A = baseline**, **B = reference**, **C = new**
- New set: `r6`

| Set | Mean of 12 scores |
|---|---:|
| baseline (A) | 6.58 |
| reference (B) | 6.08 |
| new (C) | 7.42 |

| 項目 | baseline | reference | new |
|---|---:|---:|---:|
| 資訊層級 | 7 | 6.5 | 7.5 |
| 字體排印 | 7 | 6.5 | 7.5 |
| 色彩 | 7 | 6 | 7.5 |
| 間距與版面 | 6.5 | 6 | 7.5 |
| 一致性 | 6.5 | 7 | 7.5 |
| 資訊密度 | 6.5 | 7.5 | 7.5 |
| 導覽 | 7 | 6 | 7.5 |
| 狀態與回饋 | 6 | 4 | 8 |
| 響應式 | 6.5 | 6.5 | 7.5 |
| 文案 | 6.5 | 7 | 7.5 |
| 無障礙 | 6.5 | 6 | 7 |
| 動畫與轉場 | 6 | 4 | 6.5 |

Raw reviewer output below, unedited.

---

## 組 A
一句話總評：品牌、深色模式和主要資料頁都做得到位，但空資料、錯誤和不存在這幾種狀態太陽春，各頁名稱不一致，手機版「我的閱讀」還有溢出問題，整體可用，但細節處理不如 C。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7 | ranking_desktop：標題、更新時間、前十名長條圖、表格，由上到下主次清楚。tags-selected_mobile：選了「部落格」之後，頁首寫「部落格 • 標籤」，接著是一整片標籤 chips（台中美食 4348 篇…），看不出目前選的是哪個標籤，所選標籤的文章被擠到首屏以下。 |
| 字體排印 | 7 | about_desktop：中文內文行長約 760px，行高寬鬆，標題用粗黑體，logo 用明體，層次清楚。ranking_desktop：名次數字是極小的淺灰字，「名次・標籤」表頭字級偏小。 |
| 色彩 | 7 | 全站統一用綠色當品牌色（導覽目前位置、主按鈕、連結）。ranking-dark_desktop 和 about-dark_desktop 的深色版都成立，綠色長條在深色底上很清楚。缺點是 relations-error_desktop 的錯誤框是灰底配綠字連結，看不出是錯誤；login-error_desktop 是白框黑字，同樣沒有警示色。 |
| 間距與版面 | 6.5 | ranking_desktop：98 列塞在一個 1110px 寬的單欄表格，標籤名在最左、數字在最右，中間大片空白，眼睛很難橫向對到同一列。relations_desktop：關係圖和兩欄清單對齊得不錯。 |
| 一致性 | 6.5 | tags_mobile 的分頁籤是「最新文章／標籤與主題」，ranking_mobile 卻是「收錄排行／探索標籤」，兩組名稱對不上。導覽列寫「引用」，頁內分頁寫「關係圖」，標題又是「部落格關係圖」。導覽列寫「追蹤」，my-signed-in_desktop 的標題卻是「我的閱讀」。 |
| 資訊密度 | 6.5 | relations-30_desktop／mobile 一次畫出 138 個節點、260 條連線，標籤互相重疊（「AngeCl's GitHub Pages」壓在其他節點上）。ranking_mobile 把 98 列全部攤開。my-signed-out_desktop 在未登入時就顯示兩段 API 金鑰技術說明，還多一個重複的「登入」按鈕。 |
| 導覽 | 7 | 桌機導覽列有目前位置的綠色底。手機版頂列有搜尋、深色切換、登入和選單四個入口（menu-open_mobile）。relations_desktop 的期間 segmented control 放在標題下方，好找。缺點是 tags-selected 沒有「← 所有標籤」返回鈕。 |
| 狀態與回饋 | 6 | tags-empty_desktop 只有一行灰字「標籤資料整理中。」；ranking-empty 只有「目前沒有可列出的標籤。」，兩者都沒有下一步。not-found_desktop 只有一個「前往部落格目錄」連結。topic-not-found 用的是通用 404。relations-loading_desktop 只有清單骨架，沒有關係圖的佔位。 |
| 響應式 | 6.5 | my-signed-in_mobile：curl 指令的黑色區塊橫向溢出，被裁在「'https」；金鑰卡上的「最後使用 2026/1…」被截斷。relations_mobile 清單裡的名稱被截成「官大為的部落格 \| W…」「NudoBlog - 小透明…」。about_mobile 的文字重排沒問題。 |
| 文案 | 6.5 | 頁面語氣自然，例如「Google 登入只用來管理追蹤與訂閱，不會代替你在原站閱讀」。login-error 的「登入未完成，請重新開始。」沒說原因。ranking 的前十名包含「未分類」，第 51 名是「Uncategorized」，把平台預設分類當成有意義的標籤。 |
| 無障礙 | 6.5 | my-signed-in_mobile 的「建立金鑰」在欄位空白時仍是綠色，看起來可以按，使用者分不出它其實停用。ranking_desktop 的名次是極小的淺灰字，對比偏低。手機上的 chips 和按鈕高度足夠，好點。 |
| 動畫與轉場 | 6 | relations-loading 有清單骨架和「正在載入近 7 天的關係資料…」文字。menu-open_mobile 看得出選單展開。靜態截圖無法判斷轉場，關係圖載入時也沒有圖的佔位，所以給保守分數。 |

要保留的優點：
- 統一的綠色品牌色和明體 logo，搭配導覽列目前位置的綠底標示（全站桌機）。
- ranking 系列頁的前十名橫向長條圖，加上「部落格／收錄文章」兩欄數字，深色版也清楚。
- 關係圖的三種篩選 chips（全部連結／互相提及／提及 3 篇以上），加上「重設縮放」按鈕（relations_desktop）。
- 每頁底部可收合的「本頁的資料來源與計算方式」，把說明小字集中在一處。
- about 頁的段落層級和行長，深淺兩種外觀都好讀。

最重要的五個問題（由嚴重到輕微）：
1. [響應式] [my-signed-in_mobile] [mobile] curl 指令區塊橫向溢出被裁掉，金鑰的最後使用時間被截成「2026/1…」，空白欄位時「建立金鑰」仍是可按的綠色 —— 手機上看不到完整指令、也複製不了，按鈕狀態還會誤導 —— 指令改用多行顯示並加「複製指令」按鈕，金鑰資訊改成兩行，停用的按鈕要改成灰色並附提示。
2. [狀態與回饋] [tags-empty_desktop] [兩者] 空資料、錯誤和不存在幾乎都是一行灰字，最多一個文字連結，沒有圖示、沒有原因說明、也沒有主要動作（另見 ranking-empty、relations-error、login-error、not-found、topic-not-found、blogs-no-results）—— 使用者不知道發生了什麼、接下來能做什麼 —— 統一做一個狀態卡元件：圖示＋標題＋原因＋主按鈕；錯誤要用警示色。
3. [一致性／文案] [tags_mobile vs ranking_mobile] [兩者] 同一區的分頁籤名稱互相矛盾（「最新文章／標籤與主題」對上「收錄排行／探索標籤」），導覽列「引用」對上頁面「部落格關係圖」，導覽列「追蹤」對上「我的閱讀」—— 同一件事有好幾種叫法，使用者會懷疑自己是不是走錯頁 —— 頁面標題和分頁籤一律沿用導覽列的用詞。
4. [資訊層級] [tags-selected_mobile] [mobile] 選了標籤之後，首屏仍是整片標籤 chips，頁首也不是「#部落格」，所選標籤沒有突出，文章被推到下方 —— 使用者的操作看不到結果 —— 選標籤後改成「← 所有標籤」加上「#標籤」標題，直接列出文章。
5. [資訊密度] [relations-30_desktop] [兩者] 30 天的關係圖一次畫出 138 個節點，標籤重疊、連線糊成一團；ranking_desktop 用一個 98 列的超寬單欄表格，還把「未分類／Uncategorized」排進前段（另見 relations-30_mobile）—— 重點看不出來，也很難掃讀 —— 長期間預設套用「提及 3 篇以上」篩選；排行表格先顯示前 30 名、其餘收合，並排除平台預設分類。

## 組 B
一句話總評：參考組的部落格名錄類網站以文字密集、樸素的列表為主，效率高但個性和狀態設計都很少，截圖只有首頁和列表，很多狀態項目無法評估。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 6.5 | ooh-directory-home_desktop：分類目錄和新收錄的部落格平鋪在同一頁，主次不明顯。ooh-directory-recent_desktop：每一列由部落格名稱、文章標題和更新時間組成，可以掃讀，但標題沒有被突顯。 |
| 字體排印 | 6.5 | ooh-directory-recent_desktop／mobile：英文小字級、行距緊，長行很多，手機版字級偏小。blogroll-org_desktop 的標題層次比較明確。 |
| 色彩 | 6 | ooh-directory 系列幾乎都是單色文字加連結色，品牌識別很弱。blogroll-org_desktop 的色彩稍多，但沒有看到系統化的語意色。沒有深色版可以評估。 |
| 間距與版面 | 6 | ooh-directory-home_desktop 在 1440 寬下大部分是窄欄文字，左右留白很多。blogblog-club_desktop 只有 1184px 高，內容不多，版面鬆散。 |
| 一致性 | 7 | 同一個網站內（ooh-directory-home 和 ooh-directory-recent）的列表樣式、連結和字體是同一套。不同網站之間本來就不需要一致。 |
| 資訊密度 | 7.5 | ooh-directory-recent_desktop 一屏可以看到幾十筆更新，密度很高，但也顯得擁擠。blogroll-org_mobile 一屏的資訊量適中。 |
| 導覽 | 6 | ooh-directory-home 用分類連結導覽，看不出目前位置的標示。手機版（ooh-directory-home_mobile）沒有看到精簡的導覽，要往下捲很遠。 |
| 狀態與回饋 | 4 | 截圖裡只有正常有資料的頁面，沒有載入中、空資料、錯誤或不存在等狀態，無法驗證，給保守分數。 |
| 響應式 | 6.5 | ooh-directory-recent_mobile 和 blogroll-org_mobile 都改成單欄，沒有看到橫向溢出，但手機版基本上只是把桌機內容縮窄，沒有另外調整。 |
| 文案 | 7 | 列表文字精簡直接（例如分類名、更新時間），沒有看到內部術語外露。 |
| 無障礙 | 6 | ooh-directory-recent_mobile 的文字連結又小又密，點擊範圍不足。灰色輔助文字的對比偏低。 |
| 動畫與轉場 | 4 | 只有靜態的列表頁，沒有任何載入、展開或切換的線索，給保守分數。 |

要保留的優點：
- ooh-directory-recent 的「部落格名＋文章標題＋相對時間」單列格式，掃讀效率高。
- ooh-directory-home 的分類目錄一目了然，深度探索的入口很多。
- blogroll-org 的每個部落格都附簡短說明，有助於判斷要不要點進去。
- 頁面輕量，沒有多餘的裝飾。

最重要的五個問題（由嚴重到輕微）：
1. [狀態與回饋] [全部截圖] [兩者] 看不到任何空資料、錯誤、載入或不存在的設計 —— 無法確認失敗時使用者能不能得到幫助 —— 需要補上一套狀態元件。
2. [無障礙] [ooh-directory-recent_mobile] [mobile] 小字的文字連結密集排列，點擊範圍太小 —— 手機上容易點錯 —— 加大行高和點擊區。
3. [色彩] [ooh-directory-home_desktop] [desktop] 幾乎沒有品牌色和語意色，畫面一片單調 —— 辨識度低，重點不突出 —— 建立品牌色，連結和狀態也要有各自的語意色。
4. [間距與版面] [ooh-directory-home_desktop] [desktop] 1440 寬下內容集中在窄欄，左右空白太多 —— 大螢幕的空間浪費了 —— 改成兩欄，或加一條側欄。
5. [導覽] [ooh-directory-home_mobile] [mobile] 手機上沒有精簡的導覽，也看不出目前位置 —— 往下捲很遠才找得到分類 —— 加一個漢堡選單或分頁籤。

## 組 C
一句話總評：和 A 是同一套視覺語言，但狀態卡、命名一致性、手機版處理和長清單的節制都明顯比較成熟，剩下的主要是版面平衡和小字噪音。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7.5 | tags-selected_mobile 的頁首是「← 所有標籤」和大字「#部落格」，下方直接是「最近的文章」，選取的結果一眼可見。ranking_desktop 用粗體名次，前十名圖表下方有「列出的標籤 98／最多部落格在用 台中美食」兩個摘要數字。 |
| 字體排印 | 7.5 | about_mobile 的中文段落行高舒適。relations_mobile 清單的部落格名稱完整顯示，指標數字換到下一行，沒有截斷。tags-selected_mobile 的長網址會在字中斷行（「someday-my-prince-will-co／me」）。 |
| 色彩 | 7.5 | 語意色有系統：relations-error 用紅底加警示三角形，tags-empty 和 ranking-empty 用黃底加時鐘圖示，主要動作是綠色按鈕。ranking-dark_desktop 的深色版成立。 |
| 間距與版面 | 7.5 | ranking_desktop 改成左圖表、右表格的兩欄，但左欄卡片在約 y 790 以下一路空到 1410，和右欄不平衡。relations_desktop 的右欄塞進「怎麼讀這張圖」說明，兩欄較平衡。my-signed-in_desktop 用卡片裝追蹤清單，結構清楚。 |
| 一致性 | 7.5 | 「文章標籤／標籤收錄排行」這組分頁籤在 tags 和 ranking 兩頁都一樣。導覽「引用」對應頁面標題「引用關係圖」，導覽「追蹤」對應「我的追蹤」。各種狀態卡用同一種版型（圖示＋標題＋說明＋按鈕）。 |
| 資訊密度 | 7.5 | ranking 先顯示前 30 名，下方是「顯示第 31–98 名」的收合區。relations-30 預設套用「提及 3 篇以上」篩選，只顯示 20 個節點、15 條連線，看得懂。my-signed-out_desktop 把 API 說明縮成一行「開發者：登入後可以在這裡建立 API 金鑰」。 |
| 導覽 | 7.5 | relations_desktop 把期間切換放在右上角，和左邊的「最近引用／引用關係圖」同一列；手機版則放在下一列。tags-selected 有返回連結。not-found 提供「回首頁／部落格目錄／話題排行」三個出口。 |
| 狀態與回饋 | 8 | login-error_desktop 有「登入沒有完成」標題，並說明原因（「Google 沒有把登入結果交回來，可能是逾時或瀏覽器擋了 Cookie」）。tags-empty 和 ranking-empty 都有「看最新文章」按鈕。my-signed-in 的停用按鈕旁有「先輸入名稱，就能建立金鑰。」提示。relations-loading 有關係圖的圓點骨架和清單骨架。 |
| 響應式 | 7.5 | my-signed-in_mobile 的 curl 指令分三行顯示並附「複製指令」，金鑰資訊分兩行，沒有溢出。not-found_mobile 的三個按鈕改成滿版直排。手機版頁尾超過一屏高（tags-empty_mobile 的 logo 約 60px），在內容很短的頁面上顯得頭重腳輕。 |
| 文案 | 7.5 | 用詞準確，例如 ranking 說明「這是『多少人在寫』，不是熱度或品質評分。已略過部落格平台的預設分類」，relations 說明「箭頭指向被引用的一方」。7 天預設「全部連結」、30 天預設「提及 3 篇以上」，切換時預設不同卻沒有說明，「最常被提及」列出 93 筆，和圖上的 20 個節點數字對不起來。 |
| 無障礙 | 7 | 停用的按鈕改成灰色，加上文字提示，不只靠顏色傳達。tags-selected_desktop 每一列的 meta 是約 12px 的淺灰字，還附完整原文網址，對比和可讀性都偏弱。黃色狀態卡的金色邊框對比偏淡。 |
| 動畫與轉場 | 6.5 | relations-loading 的骨架模擬了關係圖的節點分布和兩欄清單，和最後的版面一致，切換時比較不會跳動。靜態截圖仍無法判斷轉場，給保守分數。 |

要保留的優點：
- 統一的狀態卡元件：tags-empty 和 ranking-empty 用黃色，relations-error 和 login-error 用紅色，都是圖示＋標題＋原因＋主要按鈕。
- not-found 的三個出口按鈕，手機版改成滿版直排。
- ranking 的「圖表＋摘要數字＋前 30 名＋收合其餘」結構，並排除未分類和 Uncategorized，還附上說明。
- relations 的長期間預設篩選、「怎麼讀這張圖」說明卡，以及手機清單不截斷名稱。
- my-signed-in 的多行 curl 指令、「複製指令」按鈕和停用狀態提示。
- 頁面標題、分頁籤和導覽列用詞一致（引用關係圖、我的追蹤、文章標籤）。

最重要的五個問題（由嚴重到輕微）：
1. [間距與版面] [ranking_desktop] [desktop] 左欄的圖表卡結束後，下方約 600px 空白，右欄表格卻一路延伸，兩欄失衡（另見 ranking-dark_desktop）—— 1440 寬的畫面浪費了，視覺重心偏右 —— 左欄改成 sticky，或把摘要和說明移到表格上方，讓兩欄等高。
2. [文案／一致性] [relations-30_desktop] [兩者] 30 天預設「提及 3 篇以上」，7 天預設「全部連結」，圖上只有 20 個節點，下方清單卻是 93 筆 —— 使用者會以為資料不一致 —— 在圖上標示「已套用：提及 3 篇以上（共 138 個部落格）」，或讓各期間的預設篩選一致。
3. [無障礙／字體排印] [tags-selected_desktop] [兩者] 每一列都附完整原文網址，加上約 12px 的淺灰 meta，資訊噪音多、對比低；手機版長網址還會在字中斷行（tags-selected_mobile「…will-co／me」）—— 文章標題和來源的主次被稀釋了 —— 網址只顯示網域，或收進外連圖示，並加深 meta 文字顏色。
4. [響應式] [tags-empty_mobile] [mobile] 內容很短的頁面之後，接著超過一屏高的頁尾（大號 logo、標語、三顆按鈕、兩欄連結），頁尾比內容還搶眼（另見 ranking-empty_mobile、not-found_mobile）—— 頁面看起來大部分是頁尾 —— 手機版頁尾的 logo 縮小，連結也收合。
5. [無障礙] [ranking-empty_desktop] [desktop] 黃色狀態卡的淡金色邊框和淺黃底對比不足，圖示圓底也偏淡 —— 在低品質螢幕上不容易辨識成一個區塊 —— 加深邊框，或加一條左側色條。

```json
{"A": {"scores": [7,7,7,6.5,6.5,6.5,7,6,6.5,6.5,6.5,6], "issues": ["[響應式] my-signed-in_mobile：curl 指令橫向溢出被裁切、最後使用時間被截斷、空欄位時建立金鑰仍是綠色可按", "[狀態與回饋] tags-empty/ranking-empty/relations-error/login-error/not-found/topic-not-found：一行灰字、沒有圖示、原因或主要動作，錯誤沒有警示色", "[一致性／文案] tags 與 ranking 分頁籤名稱互相矛盾；導覽「引用」對上「部落格關係圖」、導覽「追蹤」對上「我的閱讀」", "[資訊層級] tags-selected_mobile：選了標籤後首屏仍是整片標籤 chips，看不出所選標籤，文章被推到下方", "[資訊密度] relations-30 一次畫出 138 個節點、標籤重疊；ranking 用 98 列超寬單欄表格，且未分類／Uncategorized 進排行"]}, "B": {"scores": [6.5,6.5,6,6,7,7.5,6,4,6.5,7,6,4], "issues": ["[狀態與回饋] 全部截圖：沒有任何空資料、錯誤、載入或不存在狀態可驗證", "[無障礙] ooh-directory-recent_mobile：小字文字連結密集，點擊範圍不足", "[色彩] ooh-directory-home_desktop：幾乎沒有品牌色與語意色", "[間距與版面] ooh-directory-home_desktop：1440 寬下窄欄、留白過多", "[導覽] ooh-directory-home_mobile：手機沒有精簡導覽，也看不出目前位置"]}, "C": {"scores": [7.5,7.5,7.5,7.5,7.5,7.5,7.5,8,7.5,7.5,7,6.5], "issues": ["[間距與版面] ranking_desktop：左欄圖表卡下方約 600px 空白，與右欄表格失衡", "[文案／一致性] relations-30：30 天預設提及 3 篇以上、7 天預設全部連結，圖上 20 個節點對上清單 93 筆，沒有說明", "[無障礙／字體排印] tags-selected：每列附完整網址加淺灰小字 meta，噪音多、對比低，手機長網址在字中斷行", "[響應式] tags-empty_mobile 等短頁：頁尾超過一屏高，比內容還搶眼", "[無障礙] ranking-empty_desktop：黃色狀態卡邊框與底色對比不足"]}}
```
