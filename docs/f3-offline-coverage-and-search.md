# F3 離線 coverage 與搜尋召回修正（2026-10-13）

本批只讀既有 artifact、修改原始碼並執行離線單元測試。未讀正式 DB、未查 HTTP、未補抓、未跑 worker、未建置或部署。正式全文搜尋驗收尚未完成。

## 舊快照的 coverage

以下數字來自 **2026-10-12T18:55:34.300Z** 的既有快照，不是本輪即時查詢。原始檔位於 `/home/deck/.cache/blog-tech-features/.reviews/b0-f4/db-audit.json`、`db-followup.json`；當時的說明為同目錄 `b0-f3-audit.md`。原說明裡「共用 in-flight 查詢」屬舊版行為，目前 main 已改為各 request fresh read，不能沿用舊描述。

| 項目 | 當時數量 |
| --- | ---: |
| 公開部落格 | 313 |
| verified 來源文章，包含未來文章 | 18,839 |
| 排除 1 篇未來文章後的公開文章 | 18,838 |
| relation observations 為 ok | 185 |
| 正文 ok/full | 5,568 |
| partial／missing／deferred | 2,280／657／67 |
| 尚無正文處理紀錄 | 10,266 |
| 正文或 relation 任一 ok | 5,572 |

使用者先前看到 185／18,747，與此快照分母差 91；未找到同時間、同條件的原始快照，不能把差值斷言為新增文章或規則變動。`content.status=failed` 為 0 也不代表全部成功。

關係狀態：ok 185；deferred/budget-deferred 56；reparse-pending/parser-upgrade 39；failed/body-incomplete 26；deferred/budget-exhausted 3。正文失敗／不完整原因含 publisher-excerpt（RSS 1,979、Atom 16）、HTML no-semantic-body 648、HTML content-limit 149、paywall（HTML 82、RSS 1）、budget-deferred（deferred 67、保留 partial 5）。這些分組口徑不同，不相加當成不重複失敗文章數；預算延後也不是抓取錯誤。

## 未知 target 與交流證據

未解析 target_blog_id 的連結共 3,494 條，其中正文 2,841（publication-home 2,361、non-publication-host 372、shortener-unresolved 108），其餘 sidebar 639、comment 7、blogroll 7。這是外連觀測數，不是全部可升格的部落格候選數，也不是當前即時 coverage。

後續順序：先以既存完整正文有界重解析；未知 target 保留來源文章、原始 URL、位置與日期，再以精確 hostname／作者路徑／已驗證 alias 查找站點。需要補證的短網址和舊網域，解凍後才走既有 SSRF、robots、每跳轉址、每站速率與每日預算；保留轉址鏈及 canonical／所有權證據。canonical 是線索，不能單獨跨站合併。`gojp.tw` 和 `gogojp.tw` 不以字串相近直接合併；目前離線檔不足以驗證兩方向引用，維持 unresolved。

直接正文引用、blogroll／側欄、共同標籤、文字相似須分別呈現；每篇對同一目標只計一次。即使將來確認雙向引用，也各列自己的文章和日期，不能包裝成同一期間互惠交流。既有 luckbear author ID 46 與 anise blog ID 38 分離，不把作者筆名當站主。

另有待修風險：`storedRelationContent` 的舊 page_links 可能覆蓋新 parser 對 body_html 的結果，且舊 links 無獨立 parserVersion。本批未改 parser 或觸發重解析；擴 coverage 前應先處理版本遷移，不能把重跑等同正確回填。

## 「蛤蜊絲瓜」召回

舊快照確認 anise.tw/290726 的 post ID 20875 已有 RSS 全文（ok/full、1,153 字，取得於 2026-10-12T15:01:08Z）；正文有該詞，標題和摘要沒有。當時有 4,201 個較新 ID，查詢先取最新 1,000 篇便排除了它。這是搜尋範圍問題，不能推成正文沒抓到。

本批新增 **預設關閉** 的 `BLOG_SEARCH_HISTORICAL_BODY_ENABLED=true` 試驗分支：從現有 ok 正文找最多 200 個命中候選（多讀一筆判斷截斷），與最新 1,000 個 metadata 候選去重，最後再次以現存文章、verified 站、非未來日期與正文站點所有權讀取。每頁最多 20 筆，僅回短片段、articleId、contextSource、matchVersion；正文不外送。`matchVersion=literal-substring-current-body-v1` 是搜尋演算法版，**不是內容 hash 或重新驗證原網站的新鮮度證明**。

候選上限不等於掃描上限：LIKE 沒命中時可能掃許多正文。因此每條 SQL 都設 MariaDB `max_statement_time=0.25`，最多三條 SQL，合計可能約 750ms，連線池等待和傳輸不在此上限內。逾時回 503 `search_timeout`，不假回空結果。coverage 揭露 recent/historical cap 和截斷，`scannedPosts` 只是 recent 候選數，不是 SQL 實際掃描列數。

這是小範圍查詢召回修正，**不是新全文索引**。離線 mock 無法驗證 MariaDB 語法、collation、實際中止、查詢計畫或成本；flag 保持 off，待解凍後獲准隔離測試才能評估啟用。不得據此宣稱正式站已能搜尋到指定文章。

獨立 source review：`/home/deck/.cache/blog-tech-features/.reviews/b0-f4/search-bounds-independent-review-20261013.md`。採納 per-statement deadline 的限制說明、維持 feature flag 關閉，並補 metadata excerpt 各分支離線測試；不以 Promise timeout 代替資料庫取消。所有舊 artifacts 保留。

## 本輪離線測試

整合至 main 後，`vitest run app/src/search-bounds.spec.ts --maxWorkers=1 --no-cache` 的 **23 項測試通過**（UTC 2026-10-12T23:10:20Z 起；執行命令另帶不存在的 search.spec.ts，因此實際只執行 search-bounds.spec.ts）。包括 4 個 metadata 分支的 projection／SQL shape 與完整參數順序；fake adapter 不執行真正 SQL，不能當作資料庫 CASE 或 collation 驗證。`tsc -p tsconfig.json --noEmit --incremental false`、Biome 通過。整個測試未開 browser、HTTP server 或 DB；Fastify inject 僅在行程內驗證 response。

既有 `public-post.spec.ts` 首次回歸有一項失敗：仍期待 12 個同 key 請求共用兩次查詢，與 B0 已採用的 fresh-read 契約衝突。本批以 deterministic barrier 改驗兩個獨立讀取、第三個請求回 503、放行後各自完成、完成後下一個請求再次讀取；保留容量／no-store／query validation 檢查，沒有 sleep、重試或放寬隱私條件。重跑 `search-bounds.spec.ts` 與 `public-post.spec.ts` 合計 **29/29 通過**（UTC 2026-10-12T23:11:17Z 起），後端型別與格式檢查再次通過。
