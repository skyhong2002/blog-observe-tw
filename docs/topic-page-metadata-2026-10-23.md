# 話題深頁 500（metadata 逾時）修復交接（GSC-20261023 第二輪）

接續 [sitemap-503-2026-10-23.md](sitemap-503-2026-10-23.md) 的 B 節。本輪動話題頁的 metadata／歷史讀取、兩個索引，以及驗收時確診的關係圖撤回殘留（下節「關係圖」）；不動 Sitemap（52 子檔、lastmod 規則不變），不操作 GSC。

## 症狀

switch 到 gen99 後，web 讀 `/api/pages/topics/<key>` 超過 web 的 10 秒讀取上限，話題 HTML 回 500：17:40:11 `火車站`、17:45:59 `美術館`、18:05:16 `條件`（後者 edge 另有 `ui origin unavailable`／Headers Timeout）。web 先讀 metadata，再讀 `/api/topics/tag:<id>?days=30`，兩者各有 10 秒上限。

## 精確慢點（正式 DB 實測，2026-10-23 19:26–19:31，負載約 12–17）

- `/api/pages/topics/:key` 一次請求呼叫 `topicHistoryDisposition` 三次（page-api、`resolvePublicPage`、`getPageIndexability`），之後 `cumulativeTopics` 以 `historyEvidenceSql` 聚合；該 CTE 為了算 `fresh`／`title_hit` 對每篇證據文章 LEFT JOIN `content_post_bodies` 與 `relation_observations`，但 posts／blogs／lastmod 都不用這兩欄。
- `content_post_bodies`：194k 列、8.7 GB（平均每列約 45 KB，Dynamic row format）；`relation_observations`：137k 列、0.87 GB。JOIN 走 PRIMARY eq_ref，每篇文章讀一個寬 clustered row，冷時是一次隨機 IO。
- `ANALYZE FORMAT=JSON`（`餐廳`，1,999 證據列，首次讀）：總 2,716 ms；`content_post_bodies` 1,144 ms／2,679 次實體頁讀、`relation_observations` 1,282 ms／2,815 次、posts 160 ms、evidence 35 ms。正文兩表約占 90%。
- 同一連線、單一話題：舊 `cumulativeTopics` 首讀 1.5–4.2 秒（`旅行`、`美術館`、`條件`、`咖啡`；`火車站` 的首讀列被輸出截斷而遺失），重讀 15–27 ms；不 JOIN 正文的同一聚合首讀 4–10 ms。
- gateway（green 18175）：誰先讀某話題誰付冷成本。`攝影` 先讀 `/api/topics` 2.44 秒、接著 `/api/pages` 0.05 秒；`公園` 先讀 `/api/pages` 1.98 秒、接著 `/api/topics` 0.10 秒。所以只改 metadata 會把同一冷成本移到 HTML 的 `/api/topics` 讀取；歷史列表的 confirmed／pending 確實需要正文 hash，不能拿掉。
- 17:40 等三次失敗當下的 SQL 秒數沒有量到；當時主機負載與 IO 壓力高於本次量測時段，這裡不推定具體秒數，也不把 swap 當已證根因。

## 修復

1. `cumulativeTopics`（話題頁 metadata、`getPageMetadata`、`getIndexablePages`）改為不 JOIN 正文的聚合：`COUNT(DISTINCT p.id)`、`COUNT(DISTINCT p.blog_id)`、`MAX(p.published_at)`，條件沿用 `historyPublicEvidenceSql`＋`historyPublicTopicSql`＋`exclusionReason`。與 `historyEvidenceSql` 每文章一列的定義相同（正文表以 post_id 為 PK，不會放大列數）。
2. 同一請求只讀一次 disposition：page-api 把結果傳給 `resolvePublicPage` 與 `getPageIndexability`；gateway 的頁面 redirect hook 也把它傳給 `resolvePublicPage`。不跨請求保存，撤回／遮蔽在下一個請求立即生效。
3. Migration `0035_body_hash_covering_indexes`：`content_bodies_hash (post_id, blog_id, status, content_hash)`、`relation_observations_hash (同欄)`。`topicBodyHash` 只讀這幾欄，JOIN 改為 index-only，HTML 歷史讀取（`readTopicHistory`、`durableTopicDetail`）不改 SQL 也受益。
   - 可安全重跑：MariaDB 每個 CREATE INDEX 各自 commit；用 `CREATE INDEX IF NOT EXISTS`，每個索引建立後以 `information_schema.STATISTICS` 核對欄位順序、非 unique、無 prefix、BTREE、ASC、未 ignored，不符就 SIGNAL 失敗且不記 ledger。
   - `ALGORITHM=INPLACE LOCK=NONE`；`lock_wait_timeout=5`：被長交易擋住時 5 秒失敗，排在後面的讀取最多等約 5 秒（低於 web 10 秒上限），不會無限排隊。
   - 正式套用後 EXPLAIN 顯示優化器仍走 PRIMARY eq_ref（合成資料時會選覆蓋索引），所以 `historyEvidenceSql` 改用 `topicBodyHashJoins`，只在這條只讀 hash 的 JOIN 上 `FORCE INDEX`（同 `PROFILE_MENTIONS_SQL` 的作法）；需要 body_text 的 worker 查詢不變。索引必須先於程式存在：已於 2026-10-23 21:34:14 CST 套用。
   - posts 不加索引：`posts_blog_guid … USING HASH` 讓 posts 任何新增索引都只能 ALGORITHM=COPY（以正式 DDL 在一次性 DB 實測），會擋爬蟲寫入，所以 root／blogs.xml 冷讀（posts 全表掃描，19:30 實測 3.0 秒／4,505 次實體頁讀）本輪不改，lastmod 仍為 updated_at 優先。

不做：加長 timeout／重試、回空殼、把存在的話題改 404／noindex、跨請求快取、改公開邊界或刪歷史。

## 關係圖撤回殘留（gen97 `7fff5d3` 起）

- 症狀：`content-visibility` 整合測試在 origin/main（不含本輪改動）同樣失敗：部落格改回 seed 後第一次讀 `/api/relations?days=90` 仍含該部落格（`seed legacy-relations first read leaked removed text`）。
- 根因：gen97 把 `/api/relations` 整份 DTO 放進 5 分鐘 SharedSnapshot，只有 admin 隱藏（`invalidateRelationCache`）會清；部落格離開 verified、文章刪除或改期、重讀正文後連結消失、觀測待重解析，都要等快照過期，最多約 5 分鐘仍顯示已撤回的部落格名稱與關係。
- 修復（安全投影）：快照只存「（文章, 被連部落格）」公開配對與全站覆蓋率計數（只有數字）。每個請求以快照內的文章 ID（正式 90 天約 467 篇、972 對；7 天 35 篇）用與原聚合相同的公開條件（`PUBLIC_RELATION`、雙方 verified、`last_success_at`、文章日期窗、admin 隱藏）重讀，只用仍公開的配對畫圖；部落格名稱也每次只讀 verified。撤回在下一個請求就消失，只有新增要等下一次快照。不每次重跑全站聚合與覆蓋率，不延長 timeout，不放寬測試。
- 邊數、份額分母（10,000 邊上限前）、首末提及日期、互相連結與排行由同一個 `projectRelationMap` 從配對算出，`loadRelations`（v1 API 每次即時）與快照路徑共用。
- `/relations/` 方法說明改為「新文章最多晚幾分鐘才出現；已撤回或隱藏的部落格、文章與連結在下一次讀取就不再顯示」。

## 驗證（本機）

- Migration 演練（`tools/rehearse-migration-0035.mjs`，一次性 MariaDB 11.4，經真正的 `tools/migrate-drizzle.mjs`）：
  1. 握住 `relation_observations` 的 metadata lock：第一個索引建立並 commit，第二個 5 秒後 `Lock wait timeout`，ledger 0 筆；期間排在 DDL 後的讀取等 5.3 秒。
  2. 放開後重跑：補完第二個索引，ledger 1 筆；第三次執行 `applied: []`。
  3. 同名但定義不同（`content_bodies_hash(post_id,status)`）：`existing index definition differs` 失敗、ledger 0 筆；換成正確索引後重跑成功、ledger 1 筆。
- 正式 DDL 在一次性 DB 上的 INPLACE 檢查：posts 失敗（USING HASH），兩張正文表成功。
- 優化器（一次性 DB、正式表定義、合成資料）：有索引時 `cb`／`o` 為 `ref content_bodies_hash`／`relation_observations_hash`、Using index；無索引時為 `eq_ref PRIMARY`。
- 單元：全部 157 檔中，`runtime-icons`（負載下 5 秒 timeout）與 `topic-writer-audit`（未追蹤暫存腳本；已刪並為兩支新工具重新產生 registry）單獨重跑通過；relations／v1／seo 規格全過。web：`relations-render.spec.tsx` 50/50、`relations-graph-icons.test.ts` 5/5。
- 整合（一次性 MariaDB，分段跑；`127.0.0.1:18169` 被其他 session 的容器占用，改用 127.0.0.2 並只在本機暫改連線主機檢查，提交前已還原）：49 套中
  - 本輪程式下通過：其餘 46 套（分段 receipt）；受影響套件在最終程式上重跑通過：`content-visibility`、`relations`、`relation-candidates`、`relation-visibility`（69 項）、`relations-quality`、`public-api`、`topic-history-read`（含新的計數等價與撤回 410）、`indexability`、`topic-body-owner`。
  - `content-visibility`：修前（origin/main 與本分支修 relations 前）失敗，修後通過。
  - `tech-routes`（`status filter`）：origin/main 同樣失敗，既有問題，本輪不處理。
  - `staged-proof-inspector`：負載 40 以上時 5 秒內部期限回 `deferred`；去掉 0035 同樣失敗，重啟前同一程式曾通過。
  - `relation-visibility` 的競態 barrier 原本比對舊 SQL 開頭，改成新配對查詢，並在未到達時以 `barrier_not_reached` 失敗、finally 一定放行，不會再無限等待。

## 未完成／注意

- 正式 migration（2026-10-23）：21:33:08 起以 `tools/migrate-drizzle.mjs` 在共用鎖內套用，21:34:14 完成，ledger `0035_body_hash_covering_indexes` 1 筆；`information_schema` 兩個索引定義與檔案一致。同一時段 edge／gateway 無錯誤紀錄。
- 正式比較（`博物館`，956 證據列，首次讀，FORCE 先跑）：覆蓋索引 278 ms（cb 121 ms／419 次實體頁讀、o 74 ms／327）；接著 PRIMARY 571 ms（cb 387 ms／1,186、o 162 ms／518）。
- 部署與驗收：見下節。
- `/api/mentions` 第一頁同樣是 5 分鐘快照，撤回的引用文章最多晚約 5 分鐘消失（方法說明已寫明延遲）；其可見條件（成句、轉載上限等）較複雜，本輪未改。
- root／blogs.xml 冷讀：posts 需全表掃描，索引需 COPY，未改。
- `tech-routes` 整合測試既有失敗（見上）。

## 正式部署與驗收（2026-10-23）

- 部署：origin/main `24df583d993cfde376e1c18a8fc15a54c1f9f70e`（含 `6d54213`），gen100 blue，21:43:26 CST switch；公開回應 `x-blog-release: 24df583d…`、`x-blog-edge-generation: 100`。回滾目標 green gen99 `fd8b90d`（仍在執行）。
  - 第一次 prepare 以 systemd-run 執行時 PATH 缺 `~/.local/bin`，`spawn npm` ENOENT 被遮成 `deployment_failed_check_local_service_status`；帶 PATH 重跑成功（21:41:19）。
- switch 前 blue 自測：`/api/relations` 每個期間第一次讀要載入快照底（90 天 31.6 秒、30 天超過 40 秒，gen97 起即如此，主要是全站覆蓋率）；已在 switch 前讀過三個期間。之後每次請求的即時投影：7 天 0.07–0.15 秒、90 天 0.98–1.7 秒、30 天 0.24–4.8 秒。
- 21:43:48 起依序各讀一次完整 HTML、`/api/pages/topics/…`、`/api/topics/tag:…?days=30`、再一次 HTML（負載約 12）。全部 200、canonical 自指、無 noindex、標題含話題名、HTML 含第一篇文章、metadata posts 等於歷史總數：

| 話題 | 角色 | HTML① | metadata | /api/topics | HTML② | posts／history.total | blogs |
|---|---|---|---|---|---|---|---|
| 火車站 | 原失敗 | 200 0.95s | 200 0.91s | 200 1.12s | 200 0.97s | 1052／1052 | 69 |
| 美術館 | 原失敗 | 200 1.02s | 200 0.5s | 200 0.78s | 200 1.62s | 1418／1418 | 99 |
| 條件 | 原失敗 | 200 0.76s | 200 0.48s | 200 0.65s | 200 1.19s | 1357／1357 | 151 |
| 溫泉 | 冷對照 | 200 0.85s | 200 0.53s | 200 0.59s | 200 0.67s | 1088／1088 | 56 |
| 早餐 | 冷對照 | 200 0.75s | 200 0.5s | 200 0.65s | 200 0.68s | 1225／1225 | 89 |
| 旅行 | 暖對照 | 200 0.69s | 200 0.47s | 200 0.55s | 200 0.59s | 1068／1068 | 102 |

  冷對照 `溫泉`、`早餐` 當天未被讀過；三個原失敗話題當天讀過多次，DB 頁可能已在快取，不能代表冷讀。
- 撤回邊界（正式）：`/topics/鮮豆漿/` 與 `/api/pages/topics/鮮豆漿`（all-evidence-revoked）410；未知話題 404；`/api/relations?days=90` 的 165 個部落格全部 verified。
- control：首頁 200 1.02 秒、`/relations/` 200 0.70 秒；edge／gateway healthz 200。switch 後 edge／gateway／web 日誌無任何錯誤（至 21:44:31）。
- 第二輪（21:49，過了 5 分鐘快照更新點，負載約 12）：

  | 話題 | HTML① | metadata | /api/topics | HTML② |
  |---|---|---|---|---|
  | 火車站 | 200 2.16s | 200 0.88s | 200 0.89s | 200 0.70s |
  | 美術館 | 200 1.32s | 200 0.91s | 200 1.35s | 200 0.83s |
  | 條件 | 200 1.27s | 200 0.49s | 200 0.63s | 200 0.75s |
  | 拉麵（冷對照） | 200 0.95s | 200 0.59s | 200 0.66s | 200 0.69s |

  一致性、canonical、noindex 同第一輪。`/api/relations` 90／7／30 天 1.04／0.54／0.88 秒；首頁 1.61 秒。gateway 21:46:11 一筆 `home.mentions` statement-timeout（首頁引用區塊的既有降級，switch 前即多次出現，與本輪無關）。
- 仍未知：17:40 等三次失敗當下的 SQL 秒數；更高負載（40 以上）時的冷讀；Google 端處理與收錄（Codex 追蹤）。
