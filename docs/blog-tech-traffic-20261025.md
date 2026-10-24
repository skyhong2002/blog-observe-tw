# 技術資料改由 traffic 提供（2026-10-25）

`/tech/` 與部落格頁的「使用的技術」改讀 traffic 同機 loopback API，沿用標籤 client 的 credential loader。已驗證部落格的 canonical_host 一次批次讀取，依正規化網域對回 slug；成功快取 60 秒，失敗仍回 503 technology_unavailable。最近嘗試狀態與上次成功快照分開，失敗／阻擋的歷史結果仍可供排行和篩選。

移除 blog 技術 detector、observer、fetch batch、store、backfill 與 worker／favicon／relations／content 掛載。保留文章平台辨識與 Wappalyzer 規則載入。資料已匯入 traffic，本次不做 DDL，保留舊表、schema 與歷史 migration 供程式回滾。詳細契約見 [tech README](../app/src/tech/README.md)。

web 支援 traffic 的 15 種分類與新增 error code，方法說明改為每月抓取首頁、比對 Wappalyzer，部落格技術區連到 traffic 的網域明細。

驗證：後端 Vitest 150 檔 1,468 項、web node tests 251 項、render tests 203 項、前後端型別檢查通過。第一輪整批 favicon 測試逾時，獨立重跑及第二輪整批均通過。SQL writer registry 僅刪除已移除程式的登錄。

全 repo lint 有 40 個錯誤（既有檔案）；本次所有異動檔案檢查通過。以同一 Biome 檢查 3639938 的乾淨 worktree 得 38 個錯誤；另外兩個診斷位於未修改的 Overrides.tsx、use-public-json.ts，兩檔與基準版本逐位元組相同，診斷內容分別是既有 useEffect 的 choose／epoch 相依項目。本次異動檔案無新增錯誤，未擴大修改。

正式資料唯讀 smoke：479 個已驗證部落格全部納入，365 detected、80 unknown、34 not-observed；`/api/tech` 與 `/api/blogs/kocpc/tech` 均 200，並通過 web 公開契約驗證。實際數量會隨 traffic 更新。

## gen107 上線結果

2026-10-25 02:32（台北時間），`green`，commit `1e2ce1a06aaa3e90170d474d51ae61c10345f4c8`，BUILD_ID `MkLH-SmoYP2v86LHxOoYV`。使用 fetch 後 origin/main 的乾淨 detached worktree，git archive 到同 SHA 的不可變 release，各自 npm ci，再以 `BLOG_TECH_PUBLIC_ENABLED=true tools/deploy-blue-green.sh prepare green <release> <source>` 建置及預熱；候選頁面與 API 通過後 `switch green`，generation 107。沒有執行 migration，沒有修改 traffic、tag、youtube 或主 checkout 的未追蹤檔案。

gen106 blue `0c2892e9a5cd79bc841f81da7e2cf2bf68c2a85f` 的 gateway/web 繼續 active，保留立即回滾。

worker 先確認新版 standalone 內的 Sharp 路徑及 1×1 PNG 原生轉換通過，再停止唯一 worker、確認 MainPID=0，新增 `~/.config/systemd/user/blog-observe-worker.service.d/99-release-1e2ce1a.conf`，將 WorkingDirectory 與 NODE_PATH 指向同一新版 release，daemon-reload 後啟動。02:32:38 起 PID 2164360；超過一分鐘後仍相同 PID、active、NRestarts=0，/proc cwd 與 release 一致。原 98-release-e40f2b2.conf 保留。

正式驗證：

- `/`、`/healthz`、`/tech/`、`/blogs/kocpc/`、`/api/tech`、`/api/blogs/kocpc/tech` 均 200，release header 同 `1e2ce1a`、generation 107，`private, no-store`、CF `DYNAMIC`、沒有 Age，HSTS `max-age=86400`。
- `/tech/` 顯示 479 個全部讀取、365 有辨識、114 未辨識（80 unknown + 34 not-observed），方法說明有 traffic 每月抓取首頁與 Wappalyzer 規則，以及 traffic 技術頁外連。
- `/blogs/kocpc/` 的技術區顯示 Google Analytics、WordPress 7.0.2，成功觀測時間 2026/10/24 22:34、來源仍是匯入快照的原文章 URL；連到 `https://traffic.observe.tw/tech/kocpc.com.tw/`（200）。traffic 尚未用首頁結果取代匯入快照時，原觀測來源與時間會如實保留。
- T3 協作瀏覽器檢查 1280×800 與 390×844，兩頁沒有頁面水平溢出；手機展開「部落格資料、內文來源、流量與作者」後，技術區與外連正常。截圖：`~/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mvmql54e-5e85a7d0.png`（tech 桌面）、`browser-screenshot-blog-observe-tw-mvmqlq5t-f5e69f9b.png`（tech 手機）、`browser-screenshot-blog-observe-tw-mvmqlz18-86f66db2.png`（blog 桌面技術區）、`browser-screenshot-blog-observe-tw-mvmqn14r-2c9a9f84.png`（blog 手機技術區）。
- OAuth 起始 302、S256、callback 精確為 `https://blog.observe.tw/auth/google/callback`；tag／youtube 首頁均 200。

## 回滾

在保留的 blue 仍健康且未重用時，以本次 source 的工具執行 `bash tools/deploy-blue-green.sh rollback blue`（工具先驗證舊 slot 再增加 generation，不直接覆寫 active.json）。worker 回到實際前版 e40f2b2：停止唯一 worker、確認 PID=0，將本次 `99-release-1e2ce1a.conf` 移至 drop-in 目錄外保留，daemon-reload 後啟動；既有 98-release-e40f2b2.conf 會恢復生效。最後確認 worker cwd／NODE_PATH、MainPID、NRestarts 與正式健康。舊表未變動，舊程式仍相容；回滾會重新啟用舊 blog 技術偵測。
