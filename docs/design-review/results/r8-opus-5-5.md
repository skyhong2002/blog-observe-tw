# r8 blind review: opus-5-5

Round 8 (skyhong-SM segment). Baseline = main at ebffbef and references, shot on skyhong-SM for r6 and reused. New = commit 854f6ec (round-7 fixes). Reviewer: claude-proxy claude-opus-5-5, effort high, fresh context (delegate_task).

- Brief: `brief.md`, SHA-256 `8c002ebe6e72b6b5d322e5b350d797c3893501d769f40f68703ea872fbef5539`
- Mapping (revealed after the review): **A = new**, **B = reference**, **C = baseline**
- New set: `r8`

| Set | Mean of 12 scores |
|---|---:|
| new (A) | 7.46 |
| reference (B) | 6.12 |
| baseline (C) | 6.0 |

| 項目 | new | reference | baseline |
|---|---:|---:|---:|
| 資訊層級 | 8 | 7 | 6.5 |
| 字體排印 | 7.5 | 6.5 | 7 |
| 色彩 | 7.5 | 7.5 | 6.5 |
| 間距與版面 | 7.5 | 6 | 6 |
| 一致性 | 7.5 | 7 | 6 |
| 資訊密度 | 7.5 | 6.5 | 6 |
| 導覽 | 8 | 6 | 6.5 |
| 狀態與回饋 | 8.5 | 4 | 5 |
| 響應式 | 7.5 | 7 | 5.5 |
| 文案 | 7 | 7 | 5.5 |
| 無障礙 | 6.5 | 6 | 6 |
| 動畫與轉場 | 6.5 | 3 | 5.5 |

Raw reviewer output below, unedited.

---

## 組 A
一句話總評：同一套綠色系、圓角 chip 和卡片元件在各頁都用得很完整，空資料、錯誤和不存在的狀態都有明確說明和下一步，關係圖與排行也照顧到可讀性；扣分主要在首頁空資料仍是一大片空白、文案夾帶內部術語、次要文字太小太淡。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 8 | home_desktop：標籤雲下方有一條「收錄 698 個臺灣與華文的個人部落格…」說明，並排三個 CTA（看最新文章／逛部落格目錄／大家在寫什麼），一進來就知道網站在做什麼。articles_desktop 標題下有一句用途說明。blogs_desktop 標題直接叫「部落格目錄」。但 home_desktop／home_mobile 的頁首左側沒有品牌字標，標籤雲裡還混著「Go gle／Google」這種破碎的字。 |
| 字體排印 | 7.5 | 品牌用襯線體，內文用黑體，中英混排的行高穩定（about_desktop 段落約 28px 行高）。但 blog_desktop、articles_desktop 的標籤與 meta 約 11–12px 灰字，topics_desktop 表格數字也很小；手機版 blog_mobile「收錄文章 1,044」有奇怪的縮排。 |
| 色彩 | 7.5 | 主色固定為綠色，語意色有系統：home-error_desktop、relations-error_desktop、login-error_desktop 是紅色警示卡；tags-empty、ranking-empty 是黃色提示卡。about-dark、topic-dark、home-dark 的深色外觀成立。整體偏單色，除了綠色之外品牌個性不多。 |
| 間距與版面 | 7.5 | home_desktop 三欄格線對齊；ranking_desktop 前 30 名分兩欄，有效利用 1440 寬。但 topics_desktop 表格的「部落格／文章」數字欄距離過遠；blog_desktop 話題雲上下各留約 80px 空白；blogs_desktop 表格最右欄被截掉，要靠 ▸ 橫向捲動。 |
| 一致性 | 7.5 | 空資料與不存在頁面一律用虛線卡＋圖示＋按鈕（not-found、blogs-no-results、topic-not-found），錯誤一律用紅卡，分頁籤都是分段按鈕。但期間切換在 topics_desktop 放右上，在 relations_desktop 放標題下；空資料卡有的黃色、有的虛線灰色，規則不一。 |
| 資訊密度 | 7.5 | blogs_desktop 一屏約 25 列，又有欄位排序；ranking_desktop 有圖表、摘要和前 30 名雙欄。relations-30 預設「提及 3 篇以上」，只顯示 20／138 個節點，圖面清楚。但 articles_desktop 被同一站（阿榮福利味）的軟體文洗版；首頁卡片的 meta 很擁擠。 |
| 導覽 | 8 | menu-open_mobile 分組說明清楚（看文章／看關係／看話題…），並標示目前所在的「部落格觀察」首頁；tags-selected 有「← 所有標籤」；blog_desktop 有麵包屑；blogs_desktop 有「第 1／14 頁・下一頁」。但手機首頁頁首沒有品牌字標可以回首頁。 |
| 狀態與回饋 | 8.5 | blogs-no-results 寫「沒有符合『zzqxv』的部落格」，附建議和「清除搜尋與篩選」；topic-not-found 寫話題專屬的說明，附回排行的連結；login-error 說明可能原因（逾時／Cookie）；relations-loading 有圖形加列表的骨架。弱點是 home-empty_desktop：除了「收錄 0 個…」之外，引用欄和話題欄都是空白，沒有說明。 |
| 響應式 | 7.5 | blogs_mobile 改成卡片，「篩選」收合成下拉；relations-30_mobile 用篩過的少量節點；not-found_mobile 按鈕改成整寬直排；my-signed-in_mobile 的 curl 換行顯示。但手機首頁、blog_mobile 的頁首資訊排序偏長，blogs_desktop 表格最右欄被截。 |
| 文案 | 7 | 用詞多半自然（「大家在寫什麼」「點標題就回到作者的網站閱讀」），「我的追蹤」和導覽「追蹤」一致。但 blog_desktop 頁首寫「BlogBlog.Club 名單自動收錄」，about_desktop 出現「新文易數」「上游宣布完整快照」「來源排除清單」等內部術語。 |
| 無障礙 | 6.5 | 主要按鈕的對比足夠，錯誤狀態同時有圖示和文字，不只靠顏色。但大量 11–12px 淺灰 meta（articles_desktop、blog_desktop 的標籤列），手機上 chip 高約 28px（blog_mobile 標籤），點擊範圍偏小；截圖看不到焦點樣式。 |
| 動畫與轉場 | 6.5 | relations-loading 有節點圓點骨架加列表骨架，並寫「正在載入近 7 天的關係資料…」；topics-loading、home-loading 也有骨架。靜態截圖看不到實際的轉場，保守給分。 |

要保留的優點：
- home_desktop 標籤雲下方的網站說明條，加上三個 CTA（看最新文章／逛部落格目錄／大家在寫什麼）。
- 狀態卡片有一套固定做法：blogs-no-results／not-found／topic-not-found 的虛線卡＋圖示＋具體下一步，home-error／relations-error／login-error 的紅色警示卡。
- relations-30 預設「提及 3 篇以上」，只畫 20／138 個節點，搭配「怎麼讀這張圖」與連結明細。
- ranking_desktop 前十名圖表、右側摘要、前 30 名雙欄，加上「顯示第 31–98 名」。
- blogs 目錄：桌機標籤 chip＋「更多篩選」收合；手機改成卡片和篩選下拉。
- menu-open_mobile 的分組導覽，每項都有描述性名稱，並標示目前位置。

最重要的五個問題（由嚴重到輕微）：
1. [狀態與回饋] [home-empty] [兩者] 「最近的部落格引用」「最近共同話題」兩欄完全空白，只有右欄寫一行「部落格更新資料整理中」，灰底大框裡空了一大片 —— 第一次部署或資料清空時，首頁看起來像壞掉 —— 每一欄都放和 tags-empty 同款的說明卡，或整頁改成單一的「資料準備中」卡片，並附 RSS／關於連結。
2. [文案] [blog／about] [兩者] 頁首寫「BlogBlog.Club 名單自動收錄」，關於頁出現「新文易數」「上游快照」「來源排除清單」 —— 讀者看不懂，像是系統資訊外露 —— 改寫成讀者語言（例如「由 BlogBlog.Club 名單收錄」「話題計算方式」），內部名詞移到說明區塊的細節裡。
3. [無障礙] [articles／blog／topics] [兩者] meta、標籤、表格數字大多是 11–12px 淺灰字，手機 chip 高約 28px —— 對比和點擊範圍都不足，長時間閱讀很吃力 —— meta 至少 13px，加深灰階，手機 chip 和點擊目標至少 40px。
4. [間距與版面] [blogs_desktop、topics_desktop] [desktop] 目錄表格最右欄被截掉、要橫向捲動；話題表格的數字欄距離過遠 —— 1440 寬下仍需捲動，數字也難以對照 —— 把 robots.txt 欄移進展開列，或縮成圖示欄；數字欄靠右對齊並收緊欄寬。
5. [資訊層級] [home] [兩者] 首頁頁首沒有品牌字標，標籤雲裡出現「Go gle／Google」這種破碎的字 —— 降低品牌辨識度和第一印象 —— 頁首固定放字標；標籤雲過濾掉含 logo 文字或斷字的關鍵字。

## 組 B
一句話總評：三個參考網站各有鮮明的品牌色和個性（ooh.directory 的橘紫圖示分類、blogroll 的綠色側標），內容讀起來自然；但版面在 1440 寬下大多只用一條窄欄，截圖裡也完全看不到載入、空資料或錯誤狀態。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 7 | ooh-directory-home_desktop 第一屏就是附數量的分類（Arts and media 932…），用途清楚；blogroll-org_desktop 左上一句說明「humanly curated list of 1308…」。blogblog-club_desktop 是一大張插圖加條列說明，比較像說明文件。 |
| 字體排印 | 6.5 | ooh-directory 的標題字重、大小層級分明；blogblog-club 在中文內文裡混用 code 樣式的「/about」「/party」；blogroll-org 的描述字小又淡（綠底深綠字）。 |
| 色彩 | 7.5 | ooh.directory 的橘色標題配紫色連結，辨識度高；blogroll 綠底配黃色 SUPPORTER 標記；blogblog 粉紅強調色配深藍頁尾。各自都有品牌感，沒有深色外觀可評。 |
| 間距與版面 | 6 | blogroll-org_desktop 只用中間約 650px，右側大片空白；ooh-directory 內容欄約 760px；blogblog-club_desktop 內文窄欄、左側留白。 |
| 一致性 | 7 | ooh-directory-home 和 ooh-directory-recent 的卡片、側欄、標題樣式一致；blogroll 單頁內一致；三個網站彼此不同，屬於正常現象。 |
| 資訊密度 | 6.5 | ooh-directory-recent 每則摘要長達 8–10 行，一屏只放得下約 4 則；blogroll 只有名稱和描述，沒有日期或更新資訊。 |
| 導覽 | 6 | ooh-directory-recent 有麵包屑 Home / Recently updated blogs，手機版導覽換行、沒有收合；blogroll 只有主題篩選，沒有主導覽；blogblog-club_mobile 有漢堡選單和搜尋。 |
| 狀態與回饋 | 4 | 截圖裡沒有任何載入、空資料、錯誤或無結果的畫面，只能看到 ooh 的「Updated 5 days ago」這類新鮮度提示，保守給分。 |
| 響應式 | 7 | 三個網站在手機上都正常堆疊：ooh-directory-home_mobile 分類變單欄，blogroll-org_mobile 篩選移到清單上方，blogblog-club_mobile 標題換行正常，沒有橫向溢出。 |
| 文案 | 7 | ooh 的「First post in over a year!」很有溫度；blogblog-club 的口語介紹親切；blogroll 的「No algorithms ever!」立場鮮明。 |
| 無障礙 | 6 | blogroll 的綠底淺綠框 chip 和小字對比偏低；ooh 的 select＋Filter 按鈕點擊範圍足夠；blogblog-club 的頁尾連結對比足夠。 |
| 動畫與轉場 | 3 | 截圖裡沒有骨架、讀取提示或選單展開狀態，線索不足，給保守分數。 |

要保留的優點：
- ooh-directory-home 附圖示與數量的分類格，第一屏就能掌握範圍。
- ooh-directory 的「First post in over a year!」這類有故事性的發現區塊。
- blogroll-org 的 INTERVIEW／SUPPORTER 側標，用顏色加文字雙重標記。
- ooh-directory-recent 每則的「x minutes ago」和字數資訊，新鮮度一目了然。
- blogblog-club 簡短友善的區域導覽說明。

最重要的五個問題（由嚴重到輕微）：
1. [狀態與回饋] [全部頁面] [兩者] 截圖裡看不到任何載入、空資料、錯誤或無結果狀態 —— 無法判斷遇到問題時使用者能不能得到回饋 —— 參考價值僅限於有資料時的狀態。
2. [間距與版面] [blogroll-org_desktop] [desktop] 內容只佔中間約 650px，右側近半空白 —— 1440 寬螢幕浪費空間 —— 改成多欄卡片，或在右欄放篩選與說明。
3. [資訊密度] [ooh-directory-recent] [兩者] 摘要長達 8–10 行，一屏只能看到約 4 則 —— 很難快速掃描 —— 摘要截成 2–3 行，或加上展開按鈕。
4. [無障礙] [blogroll-org] [兩者] 綠底上的淺綠框 chip 和小號描述字對比偏低 —— 低視力使用者難以辨識 —— 加深文字色和邊框。
5. [導覽] [ooh-directory-home_mobile] [mobile] 導覽與搜尋在手機上換行，佔掉頂部約 180px，沒有收合 —— 第一屏的內容被擠掉 —— 收進選單，或把搜尋改成圖示。

## 組 C
一句話總評：基本架構與 A 相近，但狀態處理大多退化成一行灰字或通用的 404，目錄篩選把內部收錄狀態整片攤開，手機上有多處截斷與溢出，命名也前後不一致。

| 項目 | 分數 | 證據（頁面／狀態 ID、尺寸、看到的事實） |
|---|---|---|
| 資訊層級 | 6.5 | home_desktop／home_mobile 只有標籤雲，沒有網站說明和 CTA；blogs_desktop 標題叫「部落格與文章數」；tags-selected_mobile 選了標籤後，整片標籤雲仍佔滿首屏，看不出選了哪個；ranking_desktop 是 98 列單欄長表。 |
| 字體排印 | 7 | 字體系統和 A 相同；但 articles_desktop 每列 meta 都顯示完整長網址（例如 https://www.soft4fun.net/tech/news/nvidia-announces-…），一行拉得很長；home_mobile 的「550975 篇」沒有千分位。 |
| 色彩 | 6.5 | 綠色主調和 A 相同，深色外觀成立（about-dark、topic-dark）；但錯誤沒有語意色：home-error、relations-error 是灰框配綠字，login-error 是白框中性文字；my-signed-in 的「建立金鑰」淡綠色，看不出是停用還是可以按。 |
| 間距與版面 | 6 | relations_desktop 右欄「互相提及」只有 3 組，下方大片空白；relations-30_desktop 把 138 個節點全部畫出來，標籤互相重疊；blogs_mobile 的 chip 牆約佔一整屏。 |
| 一致性 | 6 | 導覽寫「追蹤」，頁面標題卻是「我的閱讀」（my-signed-out／my-signed-in），about 頁寫「管理我的閱讀」；同一頁一下叫「部落格關係圖」，一下叫「關係圖」；狀態處理有時是按鈕組（home-error），有時只有一行字（ranking-empty、tags-empty）。 |
| 資訊密度 | 6 | blogs_desktop 一次攤開三組 chip（約 60 個）；ranking_desktop 有 98 列；tags_desktop 的 chip 附「篇・站」兩個數字，相當擁擠；但 blogs 桌機表格本身的密度合理。 |
| 導覽 | 6.5 | menu-open_mobile 只有單字（文章／標籤／引用…），沒有首頁項目，也沒有標示目前位置；tags-selected 沒有「回所有標籤」；topic-not-found、blog-not-found 都只給「前往部落格目錄」。 |
| 狀態與回饋 | 5 | blogs-no-results_desktop 是空表頭加一行灰字，沒有「清除篩選」；topic-not-found 和 blog-not-found 都用跟一般 404 一樣的通用文案；tags-empty、ranking-empty 只有一行字；login-error 只寫「登入未完成，請重新開始。」，沒有原因；relations-loading 只有列表骨架。 |
| 響應式 | 5.5 | blogs_mobile 表格名稱被截成「Synthto…」「硬是…」，網址只剩「b…」；my-signed-in_mobile 的 curl 指令橫向溢出（截在 'https），金鑰資訊也被截成「2026/1…」；relations-30_mobile 名稱被「…」截斷。 |
| 文案 | 5.5 | blogs 篩選直接露出「BlogBlog.Club 名單自動收錄 208」「已核對部落格入口 1」「網站管理者驗證收錄」等內部狀態；tags 和 ranking 出現「未分類／Uncategorized」；my-signed-out 列出 SHA-256 的技術說明。 |
| 無障礙 | 6 | 淡綠的停用按鈕（my-signed-in「建立金鑰」）對比不足；錯誤只靠綠色文字連結當按鈕（relations-error「重新載入」），點擊範圍小；小號灰字的問題和 A 相同。 |
| 動畫與轉場 | 5.5 | topics-loading、relations-loading 只有列表骨架，看不出關係圖的形狀；home-loading 和 A 相同，有骨架。 |

要保留的優點：
- blog_desktop 側欄的部落格資料與內文來源資訊卡（和 A 相同）。
- topics_desktop 標籤雲加台灣地圖剪影的話題視覺（和 A 相同）。
- home-error_desktop 的三個下一步按鈕（重新載入／回首頁／服務狀態）。
- blogs_desktop 表格可排序，桌機版的欄位密度合理。
- 深色外觀完整（about-dark、topic-dark）。

最重要的五個問題（由嚴重到輕微）：
1. [響應式] [my-signed-in_mobile] [mobile] curl 指令橫向溢出、被截在 'https，金鑰的最後使用時間被截斷；另見 blogs_mobile 表格名稱被截成「Synthto…」 —— 關鍵內容看不到也不能複製 —— 程式碼區改成換行或加複製按鈕，手機目錄改用卡片。
2. [狀態與回饋] [blogs-no-results／topic-not-found／blog-not-found] [兩者] 無結果只有空表頭加一行灰字，不存在的頁面一律用通用 404 文案和單一連結 —— 使用者不知道下一步該做什麼 —— 加上清除篩選的按鈕，並依情境給話題排行、部落格搜尋等出口。
3. [文案] [blogs] [兩者] 篩選直接露出 BlogBlog.Club／IndiePing 名錄、已核對部落格入口等收錄狀態 chip，手機上一整屏都是 chip —— 內部術語外露，主要篩選也被淹沒 —— 收進「更多篩選」，改成讀者語言。
4. [一致性] [my-signed-out／my-signed-in／about] [兩者] 導覽寫「追蹤」，頁面標題卻是「我的閱讀」，about 頁連結寫「管理我的閱讀」；關係圖也有兩種名稱 —— 使用者會懷疑是不是同一個地方 —— 統一命名。
5. [色彩] [home-error／relations-error／login-error] [兩者] 錯誤狀態是灰框中性文字，沒有警示色，也沒有圖示 —— 錯誤和一般說明分不出來 —— 用語意色卡片＋圖示＋主要按鈕。

```json
{"A": {"scores": [8, 7.5, 7.5, 7.5, 7.5, 7.5, 8, 8.5, 7.5, 7, 6.5, 6.5], "issues": ["[狀態與回饋] home-empty 兩者：引用欄與話題欄完全空白、灰底大框空一大片，應改成說明卡或單一的資料準備中狀態", "[文案] blog／about 兩者：頁首「BlogBlog.Club 名單自動收錄」與關於頁的新文易數、上游快照等內部術語外露", "[無障礙] articles／blog／topics 兩者：大量 11–12px 淺灰 meta、手機 chip 高約 28px，對比與點擊範圍不足", "[間距與版面] blogs_desktop／topics_desktop：目錄表格最右欄被截、要橫向捲動，話題表數字欄距離過遠", "[資訊層級] home 兩者：頁首沒有品牌字標，標籤雲出現「Go gle／Google」破碎字"]}, "B": {"scores": [7, 6.5, 7.5, 6, 7, 6.5, 6, 4, 7, 7, 6, 3], "issues": ["[狀態與回饋] 全部頁面：截圖裡沒有任何載入、空資料、錯誤或無結果狀態", "[間距與版面] blogroll-org_desktop：內容只佔中間約 650px，右側近半空白", "[資訊密度] ooh-directory-recent：摘要長達 8–10 行，一屏只放得下約 4 則", "[無障礙] blogroll-org：綠底淺綠 chip 與小號描述字對比偏低", "[導覽] ooh-directory-home_mobile：導覽與搜尋換行，佔掉頂部約 180px，沒有收合"]}, "C": {"scores": [6.5, 7, 6.5, 6, 6, 6, 6.5, 5, 5.5, 5.5, 6, 5.5], "issues": ["[響應式] my-signed-in_mobile：curl 指令橫向溢出、金鑰資訊被截；blogs_mobile 表格名稱被截成「Synthto…」", "[狀態與回饋] blogs-no-results／topic-not-found／blog-not-found：只有一行灰字或通用 404，缺少清除篩選與情境化的下一步", "[文案] blogs：BlogBlog.Club／IndiePing 名錄等內部收錄狀態直接當篩選 chip 露出，手機上 chip 佔滿一屏", "[一致性] my-signed-out／my-signed-in／about：導覽寫「追蹤」，頁面卻叫「我的閱讀」，關係圖也有兩種名稱", "[色彩] home-error／relations-error／login-error：錯誤是灰框中性文字，沒有語意色與圖示"]}}
```
