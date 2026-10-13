# gen5 技術零辨識與效能差異診斷

本輪正式 runtime 是 green/gen5 `4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8`，BUILD_ID `2ZIfs00KopZi_HHl8ahLU`。原始碼基底是 fetch 後的 `origin/main` `dd289be357eb321386e24365eb8edefe64b0ef4d`；後續 source 由 `work/blog-mint-queue` 整合。**F4與全scope仍pending，不以診斷報告當作完成。**

## 零辨識的已確認原因

UTC06:49只讀正式DB：260筆`unknown`全部來自`body-fragment`，53站未觀測；最新觀測仍在collector最後交接之前。精確三站的既有片段都沒有generator、script、stylesheet，回放`inspectedNodes=0`；aggregate本身不能證明另外257站都為0節點。

|真實來源|既有文章／來源|觀測時間UTC|輸入大小|實測線索與結果|
|---|---|---|---:|---|
|Alina／ID44|post41515，https://alinalife.tw/katsuo/；article-html經正文抽取|2026-10-13 03:34:12|39,718 bytes|generator/script/link皆0，回放unknown；雖內文adapter為wordpress-public，不把adapter名稱當CMS證據或推測版本。|
|Carol／ID64|post1011，https://caroleasylife.blogspot.com/feeds/posts/default?alt=rss；RSS摘要|2026-10-13 03:07:30|1,838 bytes|三類節點皆0，回放unknown；不能把平台URL或原本blogger-public adapter代替公開HTML證據。|
|timdream／ID189|post4772，https://blog.timdream.org/feed/；RSS內容|2026-10-13 03:19:44|2,461 bytes|三類節點皆0，回放unknown；現有資料沒有meta generator，不能寫成WordPress7.1.3。|

使用相同偵測器離線回放先前favicon診斷保存的7份完整首頁HTML，7份皆detected。其中三個實例：

|已保存的真實HTML|離線命中|證據類型|
|---|---|---|
|https://nash.tw/|WordPress、Jetpack、GA/GTM|既有HTML中的script/link資產路徑與分析工具標記|
|https://yiwutrip.tw/|WordPress、Astra、WP Rocket、GA|既有HTML資產／主題／外掛路徑|
|https://cmeyy.tw/|WordPress、GA|既有HTML資產路徑與分析工具標記|

完整7份檔案及hash、每項規則／confidence／版本均在原始診斷。沒有新增對外HTTP。**這7份不寫正式觀測庫**：原始home200診斷存在，但精確抓取時間未保存；不能拿現在的離線分析時間或file mtime假裝當時的HTTP觀測時間。它們用來證明既有真實HTML可命中，不能證明現在站點技術、全規則無缺陷或正式排行已補齊。

## 資料流程的缺口

source檢查：目前observer接在content的article-html，以及relation article/home；一般feed crawl、history與favicon的既有回應尚未接。已啟用collector不等於每個原有抓取入口都有觀測。

UTC06:51的UTC日預算：`relations:pages=300/300`、`relations:homes=10/10`，`relations:http=435/900`。因此部分已接流程當日無剩餘頁面／首頁配額；不提高或重設預算來硬補F4。worker交接後有既有job完成，來源記錄`article-html`也可能是history entry重匯入，不可把58筆content attempts直接說成58次新HTTP。

獨立source查核結論是**來源覆蓋與observer接線缺口**；目前沒有證據把此零辨識判定為規則完全失效。下一批先把已在抓的首頁回應接上，文章回應則須有同blog有效且公開的post ID，或等公開文章commit後才掛證據；源站／文章撤下後下一個匿名讀取仍必須排除。全部沿既有robots／SSRF／速率／大小／預算；不增加HTTP、不加tech掃站排程。

原始檔（均不入Git）：

- `/home/deck/.t3/projects/blog-observe-tw/.reviews/f4-gen5-audit/result-1791874195879.json`：只讀三站、7份cached HTML離線回放、hash與規則。
- 同目錄`budgets.json`、`content-paths.json`：預算與content來源紀錄，非外網HTTP計數。
- `/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/f4-passive-coverage-gap-review.json`：非實作者GPT-6.1 Sol source review與4cc source hash。

## 候選1.605秒與正式公開路徑的差異

UTC06:52:27–06:52:48，本輪正式gateway loopback完整HTML五次為2.569／2.166／1.527／1.546／1.391秒，中位**1.546秒**，皆200/no-store、194,437bytes。與先前private candidate的1.605秒接近，說明本機正式gateway沒有必然固定3.56秒成本。

但這不是同時、同資料快照的等價測量，差異不能全部算成CF/network：

- 候選使用private pool2且先預暖兩條read-only connection；正式預設pool4、承接正式並行流量。
- 候選直連gateway→Next；正式公開網址多了穩定edge18160、Tunnel與CF。尚未獨立量測各段。
- 候選測法是Node fetch；公開前後測法是新curl程序，含TLS與整條公開路徑。firstByte／time_starttransfer定義也不應混用。
- 實測時間、流量、詞庫資料與body大小不同，沒有凍結snapshot；旗標從tech公開關閉轉為開啟（只多導航，不增加首頁資料API）。

外部相同curl方法的正式前／後五次中位仍為**3.978→3.561秒**；babysit UTC06:45三次3.04／2.72／2.39秒是另一時段的少量抽查。都在既定6.17秒門檻內，不以這些樣本宣稱純SQL提速比例、p95或已精確分解CF耗時。

原始五次loopback結果：`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/homepage-local-gen5.json`；獨立條件review：同目錄`homepage-performance-conditions-review.json`，包含來源hash、flags／pool／路徑差異與未確認項目。核定baseline仍3.085秒（origin＋CF＋network），不變更門檻。

## 最新操作限制

使用者取消18:50截止，全部scope完成才結束；SM不開新的build／capture／restore，等待Mint準備好。原始碼、單元測試、離線review與文件持續推進。SM正式gen5繼續no-store、CF兩規則disabled、DNT與零GA守則；不清理舊release／rollback／備份／worktree。新的DNT／GPC證據欄位只適用未來capture，不回填舊manifest。P2深色contrast數值仍pending，不能以純函式mocks關閉UI問題。
