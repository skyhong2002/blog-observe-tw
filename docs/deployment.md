# 部署與回滾

正式服務由三個使用者 systemd unit 組成：`blog-observe.service`（Fastify gateway，18160）、`blog-observe-web.service`（Next SSR，18162）與 `blog-observe-worker.service`（BullMQ）。三者使用 blog 專用 `blog_observe`、Redis 17379、queue `blog-observe-crawl`/prefix `blog-observe`。

切換前先在隔離埠啟動 gateway 18161、web 18162，驗證 `/healthz`、`/api/blogs`、`/blogs/`、OAuth 起始 302 與 PKCE/state/nonce，再停止舊 gateway/worker，啟動新 web→gateway→worker。正式切換後檢查三個 unit 為 active，以及 `https://blog.observe.tw`、`/healthz`、`https://tag.observe.tw`、`https://youtube.observe.tw` 均為 200。

遷移前版本保存在 `pre-skeleton-main`（遷移前完整功能）與 `pre-skeleton-50d9d20`（使用者指定回滾基準）；Steam Machine 舊 unit 備份於 `/home/deck/.config/systemd/user/blog-observe-legacy-50d9d20/`。回滾時停止新 web/gateway/worker，將該目錄中的舊 unit 複製回 `blog-observe.service` 與 `blog-observe-worker.service`，daemon-reload 後重新啟動；程式碼可 checkout `pre-skeleton-main`，若要回到指定基準則 checkout `50d9d20`。回滾不刪除 blog DB 或 seed provenance。

Next standalone build 需要在每次 build 後把 `web/.next/static` 與 `web/public` 同步到 `web/.next/standalone/web/`；目前 runtime unit 以 standalone `server.js` 啟動。web 使用獨立 `/home/deck/.config/blog-observe-web.env`，避免 gateway 的 `PORT=18160` 污染 SSR 埠。
