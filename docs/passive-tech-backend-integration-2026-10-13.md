# F4 後端隔離整合紀錄（2026-10-13）

基底已先 `git fetch origin` 核對 main HEAD／origin/main 同為 `6f47dda9204656a7d291bbdb699dd7560b9a0b88`。本批選擇性移植既有 `/home/deck/.cache/blog-tech-features` 未提交的 F4 後端；保留來源工作樹，沒有回退 main 已整合的 pure detector，也未搬入 F3/search 或前端。

## 已整合

- `app/src/tech/`：有界 queue／store、五種公開狀態投影、統計與單站 API、只讀預設 backfill、mock／隔離 SQL fixtures。最新嘗試的 detected/unknown/failed/blocked 與未觀測 not-observed 分開；失敗可保留仍符合公開條件的上次成功，`observedAt` 與 `lastAttemptAt` 分開。
- `0020_passive_blog_technology.sql`／schema：只新增 `blog_tech_scans` 及兩個索引；meta snapshot 核對 0019 全部既有表未變。只在既有 `127.0.0.1:18169` 隔離資料庫的隨機 fixture schema 套用；未套用正式資料庫。
- 既有 `content/worker`、`relations/worker`、`relations/home` 的 HTML 回應加上被動 observer；`politeFetch` 沿用原本 DNS 釘選、robots、redirect、大小／時間限制與 fetch 次數。observer 只讀已有 buffer，保留 caller response；失敗、pending Promise 不阻擋 crawler。固定本機 budget/stopped 錯誤不誤報成站方 blocked。
- queue 上限 32（1 writer＋31 pending），滿額記 dropped，不額外排 HTTP；writer 有 2.5 秒 deadline。只保留 allowlist 技術與證據，不存原始 HTML/header/script、query token 或分析帳號。
- API 每次重新套 verified blog、來源 post 存在／同 blog／非未來的 SQL 條件，沒有跨 request 結果或 in-flight 共用。狀態篩選與技術統計可納入失敗後保留的有效成功證據，兩種數量不能混為一談。
- 局部 error handler 將缺表／DB／registry 失敗固定為 503 `technology_unavailable` 與 `private, no-store`；不外送 driver 訊息，不改其他路由 error policy。

## 介面與範圍

`BLOG_TECH_ENABLED` 控制收集；`BLOG_TECH_PUBLIC_ENABLED` 控制 GET/HEAD `/api/tech` 與 `/api/blogs/:slug/tech`。兩者皆預設關閉，只有字串 `true` 開啟。flag 關閉 API 回 404，不碰 DB。沒有改 env、部署或啟動工作。

API 合約見 `app/src/tech/README.md`。統計分母為 verified blogs，最多掃描 2,000 筆觀測，`totalBlogs`、`scannedBlogs`、`truncated` 明示涵蓋範圍；五狀態和為 scannedBlogs。列表每頁最多 100、cursor 使用穩定 blog ID；站內 URL 只從既有 registry 取，缺登記為 null，絕不自造 slug。來源 URL 去掉 credentials/query/hash；版本只接受 generator 明確證據。

backfill CLI `tools/backfill-blog-tech.ts` 預設 dry-run，一批最多 10 站、每站最多 512 KiB 既有 body fragment，沿用原 `obtained_at`，缺 HTML 不捏造 blocked/failed；只有明確 `--apply` 才寫入。**本輪沒有執行 CLI 或資料匯出，也沒有取得新網站原始輸入。**

## 驗證與待完成

- 單 worker `vitest run app/src/tech app/src/crawl/feed.spec.ts --maxWorkers=1`：**98 tests／8 檔通過**（4.87 秒）。涵蓋 fake fetch 次數不增、observer 失敗隔離、queue/drop、版本／信心、來源 ownership、deadline、公開投影、五狀態分母及 API 固定錯誤。
- `tsc -p tsconfig.json --noEmit` 通過；Biome 與 diff whitespace 檢查通過。
- 原始測試輸出位於忽略目錄 `.reviews/f4-backend-integration/`。
- 後續集中 runner 已在既有隔離 MariaDB 18169 實跑 20 個 migrations：tech-store 34 checks、tech-routes 82 checks、tech-backfill 12 checks 全通過。最終修訂輸出 `.reviews/f3-f4-isolated/review-fixes-sql.log`。這不代表正式 coverage、正式成本或瀏覽器驗收。
- 收集／公開旗標保持關閉。隔離 SQL 與 GPT-6.1 Sol / Opus 5.5 source review 已完成；前端由另一個 Opus instance 實作、Sol 獨立 review。建置、正式輸入、候選畫面與部署均等使用者解除凍結。

## 獨立 review 後追加：取連線與讀取資源界線

API／DTO、no-store、default-off 契約不變。原整合缺少的資源界線已補：

- 公開讀取每個 pool 最多兩個 operation，等待 `getConnection()` 也占名額；超額立刻固定 503。每條 SELECT 使用現有 search 的 MariaDB `SET STATEMENT max_statement_time=0.25`，另有 driver 500ms timeout；整個讀取有 2.5 秒回應 deadline。
- 回應 deadline **不等於 Promise 能取消 DB**：已取得的 connection 在 deadline／query error 時 destroy；取連線仍 pending 時保留 active，直到它真正 settle。晚到 connection 直接 release、不發 SQL。無舊 DTO fallback，正常 request 仍各自 fresh read。
- 寫入模組每個 pool 只有一個尚未結束的 acquisition；2.5 秒回應逾時後該名額不提前釋放，後續 queue writer 直接 unavailable，避免逐筆堆積 pool waiters。名額在晚到 connection release 或 acquisition 拒絕後恢復。此為可用性取捨：無法取消的 acquisition 若永不 settle，F4 暫不可用；不以無限等待取代資源上限。
- 以上為 module／process／pool 邊界，不是假稱全主機共用限額；沒有改 tag/youtube 或 DB pool 全域設定。

新增 fake-timer／barrier 測試覆蓋 40 次超額呼叫不增加 pool waiter、晚到 connection 不發 SQL、driver failure destroy、A 已讀舊值卡住時 B 獨立讀新值、HTTP 503/no-store 與晚到釋放後可恢復。初次 tech 全套 75 tests 通過，追加 HTTP barrier 後 focused 三檔 21 tests 通過；log 分別為 `resource-bounds-units.log`、`resource-bounds-http-units.log`，舊 log 保留。這些仍是 mock 驗證，不能宣称 MariaDB timeout 實際驗收完成。

### Opus 資源複審補正

查詢 wrapper 現在在單次 query rejection 當下立即 destroy，不依賴外層 loader 繼續拋錯；expired／destroyed 後拒絕後續 query，loader 即使吞掉錯誤並回 fallback，也會被 runTechRead 判定失敗。新增「吞錯直接回 fallback」及「吞錯再查再回 fallback」兩個回歸測試。

寫入 `unavailable` 代表**結果未確認**，不是保證未寫入：若 deadline 發生時 COMMIT 已送出或完成，資料可能已提交。程式會 destroy 連線，但不能撤回已完成的 COMMIT；重試仍依 monotonic last_attempt_at guard，不宣稱 timeout 等於 rollback。

獨立 review：Sol 發現取得連線與 query 的容量／deadline 缺口，已採納；Opus `claude-opus-5-5`（`.reviews/f3-f4-independent/resource-opus.json`，finish_reason=stop）發現吞掉 query error 可回成功的缺口，已修，Sol 再核對 poison-connection source。沒有駁回安全建議。首次較大的 Opus packet 因截斷被工具拒絕，`.reviews/f3-f4-independent/incomplete-review.txt` 保留原因，該次不計有效 review。所有結果僅 source／隔離驗證，沒有 BUILD_ID。
