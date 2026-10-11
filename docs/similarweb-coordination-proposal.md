# Similarweb 跨服務協調提案

目前 blog.observe.tw 的 Similarweb Similar Sites 供應商抓取預設關閉（`BLOG_SIMILARWEB_ENABLED=false`），不會自行修改 tag.observe.tw，也不會與 tag 共用 Redis、資料庫或排程。blog 的候選探索可使用 blogblog.club；這不需要 Similarweb。

若日後要啟用 Similarweb，建議由 tag 端維護唯一的供應商請求工作，blog 只提交網域並讀取唯讀結果。需要 tag 端評估的檔案是 `app/src/media-traffic/live.ts`（請求與 401/403/429 退避）、`app/src/media-traffic/worker.ts` 或目前 `MEDIA_TRAFFIC_CRON` 排程（批次與延遲）、以及新增的 blog 結果讀取 API／資料表。blog 端則只改 `app/src/crawl/similarweb.ts` 為該 API client，保留 `source=similarweb-similar-sites`、發現時間與原始 evidence。

若不能排入 tag 既有工作，第二方案是在 Steam Machine 使用一個由兩個服務共同認得的 `flock` 鎖與主機級 token bucket：全域突發量低於 20 次、避開 tag 每小時 :35、任一服務遇 401/403/429 令全域退避；鎖檔和狀態目錄須由兩個 systemd service 共同擁有且可觀測。`mkdir` 目錄鎖不是跨服務契約，不能直接拿現有 blog 實作上線。

風險包括共用對外 IP 的配額互相消耗、供應商封鎖造成 tag 流量資料中斷、候選結果被誤當成權威分類，以及 tag worker 併發增加造成 CPU／網路尖峰。啟用前要先在隔離環境驗證 403/429 退避、每日預算、重啟後鎖釋放與觀測指標。

回滾方式是先將 `BLOG_SIMILARWEB_ENABLED` 設回 `false`、停止 blog 的 Similarweb job，再移除 tag 端新增的排程/API，保留已寫入的候選和 provenance；不得回滾或重設 tag 的既有流量資料。使用者核准前不執行上述 tag 端修改。
