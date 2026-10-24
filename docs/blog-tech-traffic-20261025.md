# 技術資料改由 traffic 提供（2026-10-25）

`/tech/` 與部落格頁的「使用的技術」改讀 traffic 同機 loopback API，沿用標籤 client 的 credential loader。已驗證部落格的 canonical_host 一次批次讀取，依正規化網域對回 slug；成功快取 60 秒，失敗仍回 503 technology_unavailable。最近嘗試狀態與上次成功快照分開，失敗／阻擋的歷史結果仍可供排行和篩選。

移除 blog 技術 detector、observer、fetch batch、store、backfill 與 worker／favicon／relations／content 掛載。保留文章平台辨識與 Wappalyzer 規則載入。資料已匯入 traffic，本次不做 DDL，保留舊表、schema 與歷史 migration 供程式回滾。詳細契約見 [tech README](../app/src/tech/README.md)。

web 支援 traffic 的 15 種分類與新增 error code，方法說明改為每月抓取首頁、比對 Wappalyzer，部落格技術區連到 traffic 的網域明細。

驗證：後端 Vitest 150 檔 1,468 項、web node tests 251 項、render tests 203 項、前後端型別檢查通過。第一輪整批 favicon 測試逾時，獨立重跑及第二輪整批均通過。SQL writer registry 僅刪除已移除程式的登錄。

全 repo lint 有 40 個錯誤（既有檔案）；本次所有異動檔案檢查通過。以同一 Biome 檢查 3639938 的乾淨 worktree 得 38 個錯誤；另外兩個診斷位於未修改的 Overrides.tsx、use-public-json.ts，與安裝 web 相依套件後的分析環境有關，未擴大修改。

正式資料唯讀 smoke：479 個已驗證部落格全部納入，365 detected、80 unknown、34 not-observed；`/api/tech` 與 `/api/blogs/kocpc/tech` 均 200，並通過 web 公開契約驗證。實際數量會隨 traffic 更新。

部署結果另補；不能把以上唯讀 smoke 視為已上線。回滾須切回保留的前版 slot，並恢復 worker 原 drop-in；舊表未變動，舊程式仍相容。
