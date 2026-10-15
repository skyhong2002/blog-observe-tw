# 首頁正文引用查詢修正（2026-10-15）

## 診斷

`/api/overview?view=home` 的 `home.mentions` 在 MariaDB 11.4.12 上曾由
`relation_observations` 全表掃描開始，再回頭套用文章日期範圍與公開條件。正式唯讀
量測在約 1,019 ms 觸發 `errno=1969`（statement timeout），使整個 overview 回 503；
同時期的 authors 查詢約 34 ms。這是查詢計畫與回填爭用造成的逾時，不是公開資料格式錯誤。

## 修正

`app/src/relations/home-feed.ts` 的查詢現在先以 `posts.published_at` 的 90 天範圍作
`posts_published` 索引驅動，使用 `STRAIGHT_JOIN` 找到正文連結、公開且已成功解析的
觀測，並在 `eligible_links` 內完成搬家／隱藏／未來文章／verified 部落格等所有公開
條件。只對每篇文章與目標部落格保留第一條連結，在 `picked` 先取 9 個鍵，最後才讀取
標題、anchor、context 等顯示欄位。日期條件與舊查詢相同，仍是文章發布時間的 90 天
窗口；目標文章的 `published_at IS NULL` 也刻意保留既有公開讀取政策（部分 feed 沒有
發布時間），且首頁只回傳目標部落格，不回傳目標文章欄位。這不是改變窗口定義。

若這個獨立區塊仍遇到 statement timeout 或其他資料庫錯誤，首頁會記錄白名單診斷欄位，
將 `mentions.status` 設為 `unavailable`，其他首頁區塊仍回 200；前端顯示「正文引用
暫時無法載入」，不把失敗誤呈為空結果。HTTP 維持 `cache-control: no-store`，不會快取
降級結果。下一個成功請求會重新查詢，不共用失敗 promise。

## 唯讀驗證

在同一個唯讀交易比較新舊 SQL，結果雜湊相同（`e4e193…`）。正式資料上的新查詢 5 次
耗時約 302、71、60、71、64 ms，皆回 5 列；隔離資料庫 18169 約 189、13、10、10、10
ms。新 `EXPLAIN FORMAT=JSON` 顯示先使用 `posts_published` 日期範圍，再連結 relation
資料，最後只對 9 個鍵讀取完整欄位。既有一秒 statement timeout 保留作為最後界線。

回填服務 `blog-fulltext-backfill-20261014t2233.service` 維持停止，修正與驗證期間沒有
寫入正式資料庫，也沒有新增 migration 或索引變更。

## 測試與回滾

針對 SQL 公開條件、去重、barrier fresh-read、timeout 降級、失敗後重新查詢與隱私日誌
執行 29 個 Vitest 測試；app 與 web TypeScript typecheck 通過。部署沿用既有前端產物，
以 blue/green 切換；若首頁或 `/api/overview?view=home` 任一驗收失敗，執行既有
`tools/deploy-blue-green.sh rollback green`，保留 blue 供診斷。
