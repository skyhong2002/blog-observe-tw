# 歷史正文搜尋

以 fetch 後 origin/main `2eed666c7f0969d7efb0a24c34f1a78781922d12` 為基底。`BLOG_SEARCH_FULLTEXT_ENABLED=true` 時，`/api/search` 對至少兩個字的查詢使用 MariaDB 的歷史索引；不再只查最近收錄的 1,000 篇。單字查詢維持原來的有限 metadata 搜尋。

新增 additive migration `0027_historical_fulltext`，建立 private `post_search_documents`。Drizzle schema 定義資料欄位，FULLTEXT 是 migration 中明列的原生索引（Drizzle MySQL index builder 不支援 FULLTEXT 類型）。不修改既有文章或作者資料，不使用另一個資料庫或外部搜尋服務。

正文以 NFKC、大小寫與空白正規化，整份已取得文字拆為 Unicode bigram，編成固定九字元 ASCII token，再以 InnoDB FULLTEXT BOOLEAN AND 查詢。這讓中文、emoji、標點的兩字以上搜尋不依賴 MariaDB 的自然語言斷詞與短詞規則；最後仍檢查真正的連續字串，而不是把 token 共現當作命中。參考 [MariaDB FULLTEXT 文件](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/full-text-indexes/full-text-index-overview)。

## 隱私與證據

- 索引只產生候選 ID。每次 API 都重新讀取當前文章與部落格，排除 seed、隱藏、rejected、moved、刪除與未來才發布的資料；沒有 result cache 或共享 in-flight promise。
- 正文需要目前 status=ok、post/blog owner 一致、取得時間不在未來、source/article/current URL 身分相符，以及目前全文 SHA-256 與索引相符。標題、公開短摘要、站名另有 metadata hash；資料修改但未重新索引時，舊命中會被排除。
- 公開結果只提供最長 240 字的短片段、原文連結、文章 ID、contextSource 和 `nfkc-bigram-whole-body-v1` 比對版本；不公開原始全文或索引 token。
- 隱藏交易 commit 後開始的新請求立即重新讀取；commit 前已完成讀取的 A 可以保留舊結果。隔離 fixture 用 barrier 卡住 A 的實際最後 SQL 結果，再 commit 撤下，B 完成後才釋放 A，沒有 sleep 或 TTL。
- no-store 與 Cloudflare 停用的快取規則維持不變。

## 範圍與資源

每篇可索引已保存的整份正文，上限 128 KiB（沿用正文採集上限），不再截在前 4,096 字。尚未取得正文、尚未建索引、oversize、partial 或無法驗證所有權的正文不在範圍內；metadata 仍可獨立命中。這不表示已抓齊原站所有歷史文章。

每個查詢最多兩個 SQL statement，每個 server timeout 1 秒；最多讀 200 個候選、候選上限固定公開，原始候選數／過期數／截斷狀態不對外提供，以免舊正文索引成為探測工具。公開 counts 只計當前驗證通過的結果。每頁最多 20 筆，只處理有界 ID 集合，沒有對全站歷史正文做 LIKE 掃描。

`tools/index-historical-search.ts --after <ID> --batches <N>` 每批 10 篇、批間五秒、pool size=1；每篇 upsert 後保留 cursor，可續跑、可重複；只對正式首頁發 DNT 健康檢查 GET，不增加對來源站的抓取。不把文章全文或金鑰寫進 stdout。worker 每五分鐘以獨立 high-water keyset 處理 5 個新文章，再循環核對 5 個歷史文章；hash／版本未變時跳過寫入，不持續重建 FULLTEXT。刪除文章透過 FK 同步清掉衍生 document，歷史核對會刪除已撤下文章的 document；正文 durable commit 後的既有 adoption job 可立即更新索引。只有一個 blog worker，不啟動第二個。

回滾關閉新旗標或切回 af0；保留 additive table 與索引，不需要 down migration。正式遷移前保留 streamed gzip 備份，既有備份不刪。建置、candidate 和正式截圖各自記錄 SHA／BUILD_ID；正式 DNT/傳輸層 Google 阻擋與 raw network 不拿 candidate review 代替。

source review：既有 Opus 5.5 指出公開候選計數側通道、反向 anti-join 成本、unchanged 重寫、adoption 旗標與空白比對。以上皆修正並加測試；GPT-6.1 Sol 對最後的全文讀寫／DDL／fixture source 審查 pass（沒有冒稱執行測試）。常見詞與長字串實際查詢成本須在資料補齊後量測；仍有 SQL timeout 與候選上限，不隱藏失敗為「沒有結果」。兩份初期 API Opus 回應遭截斷，不計成功 review。私人 logs 位於 `.reviews/f3-fulltext/`。

19:34 UTC 正式 overview 發生500，與建置／首次大量回填重疊；web log 沒有保留當時 DB driver error code，不能斷言唯一根因。19:42 停止回填後才繼續量測。CLI 已改10篇／五秒、pool1、nice19/ionice3；每批間用 DNT GET 正式首頁，非200或超過6.17秒便取消並保存cursor，沒有SIGSTOP或自動重試。worker 索引工作也先檢查首頁，並降至5+5篇／五分鐘，durable change job最多10篇；不把背景成本轉嫁給公開請求。

節流delta review釐清：大量初次回填由CLI執行，worker仍有每輪5篇的歷史對帳，並非宣稱歷史工作只由CLI執行。舊prefix與新whole-body adoption的所有實際寫入路徑都先檢查首頁，不只新fulltext旗標。最後一批的健康檢查仍保留，若已完成SQL但首頁不健康，stdout cursor可續跑而exit非0，避免把故障標成成功。

## 公開 v1 與網站搜尋的差別

`/api/v1/articles?q=...` 與 `/api/v1/blogs/{slug}/articles?q=...` 的 `q` **只比對文章標題**，預設窗口為 720 小時（30 天）；也可指定 `hours` 或成對 `since`／`until`，單一窗口最多 90 天。這是既有公開 v1 合約，OpenAPI 的摘要為「最新文章與標題搜尋」，不是正文或全歷史搜尋。這次不改變其查詢行為。

網站 `/articles/?q=蛤蜊絲瓜` 使用 `/api/search` 的歷史正文索引，因此正文含有查詢但標題沒有的文章可命中。`/api/search` 是網站使用的介面，尚未納入公開 v1 的穩定端點清單；不把它誤稱為新的公開 v1 契約。公開結果仍只有短片段，全文在原站閱讀。

## 正式交付（2026-10-14）

- 正式切換 UTC **20:00:27.606Z**：green／generation 17／APP `7ffd036fd7a968f228e0f8ebf7539d2dd94edc63`，Next BUILD_ID `F_zSp1Bg_oZWzezesLRmQ`。回滾為 `tools/deploy-blue-green.sh rollback blue`，blue `af0e73c` 保持在線。
- 正式 HTTP 23 項通過，包括歷史搜尋的文章 ID、正文片段與比對版本、no-store／DYNAMIC、HSTS、OAuth 起始、404 與 SSRF。隔離資料庫 29 項全文測試、53 barrier＋60 SSR/RSC、額外 28 項實際全文 HTTP 隱私斷言通過；各自的旗標與身份證據分別記錄，不把 legacy B0 等同全文旗標測試。
- 正式六模板的 1280／390 截圖與 candidate 看圖 review 分開保留；見 `docs/ui-review-ledger.md`。首次手機首屏沒有涵蓋下方歷史結果，額外捲動證據另列，不回寫首屏檔案。
- 批次回填曾與 overview 500 重疊，不能憑時間重疊判定唯一 DB 根因；目前使用小批次及逐批正式首頁 guard。未建索引的歷史文章仍是未完成資料 coverage，不宣稱全站原文已抓齊。

私有驗收：`/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/formal-acceptance-final.json`；
隔離全文 HTTP：同目錄 `isolated-api-runtime-final-result.json`；
B0：`/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-final-barrier/7ffd036fd7a968f228e0f8ebf7539d2dd94edc63/`。

### 後續健康回滾（同日UTC20:27）

小批次回填在第14批取得首頁500，guard自動取消，cursor24418；其後curl exit28／中位數超閘門，UTC20:27:33.445Z切回blue/gen18/af0。worker也恢復af0，不讓producer繼續寫入。gen17真實功能與證據保留在inactive green，不把歷史成功驗收宣稱為目前仍在線。需要先處理DB寫入資源競爭；完整證據與每個檔案的hash見 `docs/f3-gen17-evidence.md`。

### 查詢成本與更慢的回填（待本批驗收）

首頁作者查詢改為先選出八組公開author/blog profile，再統計其當前公開文章；沒有共用promise或cache。正式DB的唯讀交易三次比對結果／hash完全相同，舊查詢中位221.24ms、新查詢3.67ms。這只能證明該查詢成本降低，不能據此宣稱已確認19:34／20:25的500唯一根因。

新的overview錯誤只記bounded MariaDB error code，回503 unavailable，不回傳或重拋SQL／message；既有no-store保留。CLI預設降至**一篇／60秒**，可用 `--batch-size`（1–10）和 `--delay-ms`（5000–3600000）配置，最大2000批與pool1不變。每批仍檢查正式首頁，出錯就停止並留cursor；沒有自動重試。先保持worker在af0，避免同時啟用新的producer與CLI。

既有Opus5.5 reviewer對本批backend source獨立審查通過，actual modelUsage=claude-opus-5-5、success且未截斷；採納null錯誤碼防護與generic503回應，確認blog_authors複合主鍵保证選八組不重複。沒有採用額外排序ID tie-breaker，因為本批維持既有排序合約，且三次SQL parity結果相同；可在另批釐清完全相同名稱的排序。這份review只涵蓋本次diff，不拿它取代先前全文reader、計數洩漏修正與HTTP privacy barrier的證據。

新增／既有17項單元測試通過，含overview故障不回或記錄SQL/message，TypeScript通過。私有source review：`/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/home-query-budget-opus-review-final.json`；readonly parity：同目錄 `home-author-query-parity.json`。

### gen19恢复與公開 v1 未發布邊界

UTC20:49:04.958Z以同一份前端產物切到green/gen19/46c074c，homepage五次median1.968656秒，candidate1.895654秒；新source的53/60 B0與28全文HTTP隱私檢查、正式23項檢查通過。worker仍留af0，不同時啟用新producer。

另核對到公開v1允許until有60秒clock skew容忍，不能讓它變成提早公開文章的權限。`listArticles` 改為重用 `PUBLIC_SEARCH_SQL`，除此之外維持窗口、分頁與q的標題搜尋合約。18169的public-api suite以真實SQL＋Fastify注入請求，測試40秒後發布／until55秒後的兩端點皆為0；有實際 `content_post_bodies` 正文與summary包含查詢但標題沒有的fixture，v1仍0。這不是socket端到端測試；正式body搜尋另有實際loopbackHTTP barrier證據。

此純API變更為n/a-ui，前端git tree、data/openapi與lockfiles不變，不把gen19圖片改寫SHA。既有非作者Opus5.5看過source差異，actual modelUsage/success在 `.reviews/f3-fulltext/public-title-future-opus-review.json`；採納其建議補實際正文fixture，重跑integration-final通過。未額外改動其他端點或q搜尋語意。

### 回填續跑記錄

原先一篇／60秒的20批均通過，cursor24438；首頁各批200，最慢4.342秒。接著保持單一writer、Nice19／IO idle／pool1，設定五篇／60秒，單次最多2000批，非200／>6.17秒立即取消，沒有失敗自動重試。worker仍af0，不啟用新的whole-body producer。CLI日誌與cursor：`/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/backfill-five-per-minute.log`；回填未完成，不把「已能搜到歷史文章」當成全站歷史coverage已完成。

### 搜尋使用量（search_usage_daily）

GA 不計帶 query 的網址，所以 `/articles/?q=` 搜尋本來量不到（docs/analytics.md）。為了判斷回填值不值得，gateway 以台灣日期每天累加 `search_usage_daily`（migration `0033_search_usage_daily`，`app/src/search-usage.ts`）：

- `site_searches`：網站搜尋頁發出的第一頁搜尋（`Sec-Fetch-Site: same-origin`）；換頁另記 `site_later_pages`，503 記 `site_failures`。
- `with_results`／`body_matches`／`body_only`：上述第一頁搜尋中，有任何結果、至少一筆只在正文命中、全部結果都只在正文命中（沒有正文索引就是零結果）。以所有驗證過的候選計算，不只當頁。
- `api_requests`：其他來源（腳本、外站、API 使用者）的有效請求。

不存搜尋字詞、結果、IP、User-Agent 或任何識別資料；只在記憶體累加，每分鐘與 gateway 關閉時各寫一筆 upsert（1 秒 statement 上限，失敗時留到下次）。讀取：

```sql
SET STATEMENT max_statement_time=1 FOR SELECT * FROM search_usage_daily ORDER BY day DESC LIMIT 30;
```
