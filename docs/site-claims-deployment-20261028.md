# 網站認領與具名推薦正式部署（2026-10-28）

## 已部署版本

- 應用 commit：`10565148fbf2bfb76ca65de5cc7e65b21cabc7a3`。
- 從 fetched `origin/main@a217ff56d7f886197f9c2353a2003bad2820382e` 的獨立 worktree 完成開發，
  以 fast-forward 推送 main；原共享工作目錄與其四份未追蹤稽核檔案保持。
- blue／generation **110**，BUILD_ID `uS8QvjG9NIImBF6zhPcE-`。
- green／generation 109 的 `d507a1fb6e81db21815dcde2ba6695df06ec8f7a` 保持運作供回滾。
- 不可變 release：`~/.local/share/blog-observe/releases/10565148fbf2bfb76ca65de5cc7e65b21cabc7a3`。
- 未重啟 edge、未改 Cloudflare、DNS、Google client 或其他網站服務。

## 備份、migration 與建置

本批只新增四張表，不改既有 schema 或批次更新既有收錄決定。先備份**整個資料庫結構及帳號／收錄相關資料表**，
再套用 migration；這是限定範圍備份，**不是整個 69.49 GiB 資料庫的完整資料備份**。
未變更的文章、全文與話題資料未包含於本次備份，既有備份保留。

備份為私有 0600 的 `~/.local/share/blog-observe/backups/pre-site-claims-20261028-1056514.sql.gz`，
2,533,332 bytes，SHA256 `673d5410c45eb3bbd7ade6a8fa35e84a0c634077f61fc206d71876c6c0e584ec`，
直接 gzip 串流、`gzip -t` 通過，不產生未壓縮 SQL。
包含 users、user_sessions、authors、blog_authors、blogs、blog_urls、discovery_candidates、
discovery_candidate_audits、seed_records、migration ledger；憑證只由 stdin 傳給暫存 option file，沒有寫入 Git 或日誌。

正式 ledger 由 0035 追加 **0036_site_claims**；僅建立 site_claims、site_recommendations、
site_review_requests、site_identity_audits。migration 後舊 green `/healthz` 仍為 200。

依既有滾動保留政策，在部署鎖內重查 unit、slot／ready、edge/code、程序 cwd 與 worktree 依賴，
移除 9 個未引用舊 release 及對應 prepared/build receipt。保留現行、回滾、基礎程式及仍被 unit／依賴引用的 release，
沒有刪除備份、正式資料或一般 worktree。可用空間由約 37.13 增至 44.91 GiB。

從 commit archive 建立獨立 release，使用同 lockfile 安裝的本機依賴副本。
建置前 gate 為 load1 **11.36**、其他 build **0**、空間大於 40 GiB；取得共用 build lock，
以 nice 19／ionice c3、CIRCLE_NODE_TOTAL=2、RAYON_NUM_THREADS=2、UV_THREADPOOL_SIZE=2 執行。
編譯 `/api`、`/auth` rewrites 均指向 blue gateway **18174**，技術公開旗標沿用 true。
正式 build 與 standalone 配對檢查通過，依序 `record-built`、`prepare-built blue`、`switch blue`；
record 後沒有重建、覆寫 receipt 或修改已審產物。

## 正式驗證

- 公網 `/`、`/queue/?q=hawks.tw`、`/my/sites/`、候選查詢、待查清單 API、Hawks profile API、
  `/healthz` 均為新版 release／gen110。
- HTML／API 為 private no-store、Cloudflare DYNAMIC、無 Age；`/my/sites/` 為 noindex。
- 未登入 `/api/me/sites` 與同源 claims POST 為 401，異源 POST 為 403；未建立 production 測試帳號、
  臨時登入 session、虛構認領或推薦。正式 claims／recommendations 皆仍為 0 筆時完成驗證。
- Google OAuth 起始 302、S256、精確 callback `https://weblog.tw/auth/google/callback` 正確。
  沒有代替使用者完成 Google 互動登入。
- 舊 Host `/queue/?q=hawks.tw` 仍 308 到新域相同 path/query；tag／youtube 首頁皆 200。
- 使用者取消正式截圖，因此沒有以截圖作為發布條件，也沒有為畫面建立正式測試資料。
  使用者提供的 Google「browser or app may not be secure」畫面發生於預覽瀏覽器；
  不將其誤報為本站 callback 錯誤或真人登入驗收成功。

## Worker 與 Hawks 修復

停止舊唯一 worker、確認 PID=0 後，保留全部舊 drop-ins，新增
`~/.config/systemd/user/blog-observe-worker.service.d/zzz-site-claims-1056514.conf`。
WorkingDirectory、NODE_PATH 指向同一 release，沿用 weblog origin 與既有其他設定。
同 release 的 Sharp 1×1 PNG smoke 通過；web 公網驗證後才啟動 worker。
實際 cwd、NODE_PATH、BLOG_PUBLIC_ORIGIN 已核對，PID **622163**、NRestarts=0；啟動超過一分鐘後仍為同 PID、active，觀察期間 journal 沒有 warning／error，沒有開第二份 worker。

以原有 operator 審查工具、原准入 writer 與 v6 證據重查候選 **1436**：
`hawks.tw` 自動通過，建立 blog **525**／`discovered-bff2f465f7cf01bcb5c9`，
再用限定 `--ids 525` 的正常 feed crawler 抓入 **29 篇文章**。
未新增人工覆寫、偽造帳號擔保或跳過准入交易。
初次驗證時 profile 尚待既有每 15 分鐘的網址登錄排程，HTML 曾回 404；本批以既有 `backfillPublicRoutes`、`afterId=524`／`limit=1`／`missingOnly=true` 立即完成唯一新站的登錄，沒有手寫 registry SQL。
重驗舊 slug 轉址後 **200**，canonical 為 `https://weblog.tw/blogs/hawks.tw/`，CF DYNAMIC、release 正確。
這代表已收錄與取得 RSS 文章，不宣稱所有文章全文分析及後續背景索引都已完成。

## 使用者操作

1. 在一般瀏覽器開啟 `https://weblog.tw/queue/`，登入後輸入網站網址並按「檢查」。
2. 自己的網站選「這是我撰寫或管理的網站」，選擇關係與驗證方式，確認聲明後建立申請。
   按指示把驗證碼放到關於頁第一個獨立段落、首頁 head，或指定純文字檔，發布後按「我已發布，驗證網站」。
3. 推薦別人的網站選「我想具名推薦這個網站」，可填推薦理由，確認後送出；不會取得網站管理權。
4. 已卡住的候選可以按「要求重新檢查」，結果在「我的網站與推薦紀錄」或待查清單查看。
   重查排程每五分鐘執行，仍受額度與連線影響；新站的公開網址登錄另有每 15 分鐘排程，完成前可能暫時無法打開介紹頁。既有人工處理與站主排除保留。
5. 右上角帳號選單的「我的網站」（`/my/sites/`）可繼續驗證、重新整理進度、撤回自己的認領／推薦。
   撤回不等同撤下部落格；控制權驗證不等同實名或所有文章的作者認證。

DNS、平台專用認領、共同管理、移交與 metadata 管理仍屬後續批次，未宣稱本次部署已提供。
細節見 [網站認領與具名推薦](site-claims-and-recommendations.md)。

## 回滾

先用目前工具驗證保留 green 並回滾 web/gateway，保留所有新增表與資料：

```bash
bash tools/deploy-blue-green.sh rollback green
systemctl --user stop blog-observe-worker.service
# 確認 MainPID=0 後，只移出本批新增的 override，舊設定保持。
mv "$HOME/.config/systemd/user/blog-observe-worker.service.d/zzz-site-claims-1056514.conf" \
  "$HOME/.config/weblog/zzz-site-claims-1056514.rollback-kept.conf"
systemctl --user daemon-reload
systemctl --user start blog-observe-worker.service
```

這會回到 d507a1f 與 gen109 的程式內容（edge generation 仍必須增加），維持 weblog.tw origin，
不回復舊 blog.observe.tw 為權威 origin、不反向 migration、不刪除已收錄 Hawks 或其文章。

機器可讀的備份、建置、候選／正式 HTTP、worker 與保留政策證據，存於本機忽略追蹤的
`.reviews/site-claims-deploy/`。不將 Cookie、登入 token、Google Email 或私有 unit 備份提交 Git。
