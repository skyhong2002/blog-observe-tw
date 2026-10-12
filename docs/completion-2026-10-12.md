# 2026-10-12：歷史遍歷、來源驗證與圖示補齊

## 版本及正式部署

本階段從 fetch 後 `origin/main` **9a7f1b1** 開始；所有程式提交均已 push 至 `skyhong2002/blog-observe-tw` 的 main。建置使用 remote main 的乾淨 detached worktree，不 reset 共用 checkout。

正式 release：**452383e**（完整 SHA 見 Git），gateway／Next web／BullMQ worker 及 favicon timer 的工作目錄均指向同一不可變 release。gateway 仍為 loopback 18160，web 18162；`blog_observe` DB、Redis queue/prefix、session、圖示快取維持獨立。前一版 `6e48bbd` 與本階段前的 `0882121` release 均保留。

主要提交：`d84f6d7` 圖示修復、`738c048` 月份覆蓋、`1cb70f3` 自動驗證、`e7c9324` 歷史游標、`1b72647` 回滾清理、`54b8f67` oEmbed 排除、`6e48bbd` 完整目錄／作者分頁、`452383e` 頁尾公開計數一致。

## 四項結果

### 可續跑歷史遍歷

- RSS／Atom next、Blogger OpenSearch、WordPress 公開 REST 分頁及 sitemap 全部分片，均使用原有 DNS 釘選、robots、每站延遲與大小上限。
- metadata、文章待辦與游標持久化；post／作者／標籤及游標同交易，SQL 失敗不前移。按 canonical URL 去重，空 sitemap 欄位不覆蓋 RSS，lastmod 不當作發文日期，低頻站不判 stale。
- 每五分鐘排一批，最多五站，每站五頁／三十篇／四十五秒，worker 閒置後依序處理。403／robots 保持阻擋；非政策錯誤第三次失敗後保存原因並繼續其餘工作。oEmbed 不再誤當 feed。
- 正式資料實測兩站重啟續跑：各 10 → 20 篇，原有游標保留。三個新增背景工作都已由正式 worker 成功執行，queue failed=0。
- **14:28 台北時間快照**：314 個 verified 站全數已有 durable run；310 partial、4 blocked。已發現 2,567 個工作、完成 254 個，處理 210 次文章寫入；遍歷過程會繼續新增子工作。尚未宣告全量回填完成，阻擋站維持至少六小時冷卻。現有索引已包含 2001 年文章。

詳見 [歷史匯入](history-import.md)。

### 七個失敗圖示

原先七站修好五站：Nash、可人之家、美食好芃友、朱寶妮、WA!COOKIES。使用可驗證的官方作者／導覽品牌圖片，沒有放寬解碼與像素限制。依武、CELESTETERRY 的圖片 CDN robots 不允許，保留原因與預設圖。

原 135 筆種子現在 124 個本地圖示、2 個受阻、9 個尚無可信網址。新增 190 站另完成首次抓取：161 成功、29 使用預設（26 無可解碼的本站圖示、3 robots 限制）。這些是兩組不同母數，不把失敗算成功；完整 sourceChecks 存私人 runtime。成功 PNG 為 192 px，revision 隨內容改變。

新增站每十五分鐘補缺圖，最多十站／兩分鐘；同網址失敗七天後才重試，與月刷新 CLI 共用互斥鎖。詳見 [favicon](favicons.md)。

### 同樂會截斷覆蓋

根頁 1,044 個外部 anchor，正規化去重後 1,011 個候選連結；保留每頁 1,000 上限與 truncated 標記。沿官方回顧／主題月份頁共取得 11 個月份頁，原缺漏 **11／11 全部補回、remaining=0**。此次 traversal 共 24 頁、3,073 observations、1,078 個 blogroll 關係，新增 186 個候選。保留來源頁及發現路徑，不硬編特定部落格。

這是本次公開根頁所列連結的覆蓋證據，不代表未連出的歷史月份也已取得。週排程會持續發現新月份。詳見 [discovery](discovery.md)。

### 全批候選自動驗證

2,174 筆待審候選全部驗證；193 筆通過，新增 **190 個部落格**、3 筆關聯既有站。1,981 筆仍保留候選及原因（其中 1,407 筆為文章／分類等非 publication 首頁）。沒有要求使用者逐筆人工審核，也沒有以名稱猜測直接收錄。

核准必須首頁完整名稱、RSS 名稱、channel 首頁及文章所屬 publication 相符，並重新檢查人工狀態、網址／feed ownership、搬家別名與稽核。所有新增 190 站都已開始索引，共取得 **6,436 篇**，各站至少一篇；seed_records 的 136 筆原始列未改動。

總 DB 為 325 blogs（314 verified、9 未確認 seed、2 moved）；公開目錄排除 moved，列出 323 站。目錄及作者頁改成完整 SQL 分頁，搜尋、排序、分類／狀態 chips 與計數不再受首頁前 200 筆排行截斷。頁尾同樣使用公開計數；healthz 的 blogs 仍保留全資料庫筆數，維持原契約。

詳見 [自動驗證](automatic-candidate-review.md)。

## 驗收與審查

- 289 項 Vitest、app/web TypeScript、Biome、Next production build 通過；Biome 只有既有 img element warning 與設定 deprecation 提示。Drizzle generate 無額外差異。
- migration 0004 備份後套用；兩輪隔離 MariaDB 11.4 還原演練驗證重啟、分片、去重、SQL rollback、雙鎖、政策阻擋、軟404與 prefix index EXPLAIN。隔離容器均已刪除。
- 隔離 Redis queue 驗證回滾工具：刪除 208 個本次新增類型工作，原抓取／discovery／Similarweb 排程與 paused 狀態保留，無全域 drain。
- Codex／Opus 累計 **21／7（3:1）**；三份新增 Opus 回應皆驗證 `claude-opus-5-5`、finish=stop。採納身分匹配、來源歸屬、稀疏資料保護、失敗工作處理、保守完整性判定、停止順序／排程清理與回滾驗證。未改成預設全關：使用者已授權自動收錄，正式 drop-in 明寫三個 enabled=true；未重跑整批月圖示：首輪專用工作已執行同一模組並持有同一鎖，避免重複抓取。review packet／細節與比例只存 gitignored `.reviews/`。
- 每次部署後 blog 首頁、目錄、來源頁、完整目錄 API、作者 API／頁面、13 個靜態資源與 healthz 均 200；OAuth 起始 302、S256、精確 callback `https://blog.observe.tw/auth/google/callback` 通過；雙斜線 SSRF 回歸 400。tag.observe.tw、youtube.observe.tw 仍 200，未修改其程式、服務或排程。
- 正式原生協作瀏覽器實查第七頁 23 筆，390 px 手機無全頁水平溢出，本機圖示正常解碼；桌面淺／深色版型均檢視。不是重新設計頁面，沿用 tag 的表格／tabs／圖示元件。
- 三服務穩定 active、NRestarts=0。worker 實際 CPUQuota=35%、MemoryHigh=512 MiB、MemoryMax=768 MiB、TimeoutStopSec=600 已核對。favicon timer active。

## 後續自動執行及回滾

歷史全量回填仍在低速背景進行；受限來源不繞過，無法確認的九個 seed 與低信心候選保留證據。真人 Google 授權、登入後追蹤／個人 RSS／OPML 仍留給使用者本人驗收。

回滾依 [歷史匯入的停止順序](history-import.md#背景排程與停止)：先在新600秒期限下停 worker、用新版 `tools/pause-background.ts` 清除三個新增 scheduler／等待工作，再恢復保留 release drop-in、daemon-reload、啟動並驗證。新增 DB 表／證據／圖示保留，不執行舊版 `--history`。本階段的 DB dump 與每次原 drop-in 私人備份已保留；不刪正式收錄成果，不恢復舊的直接 Similarweb provider client。
