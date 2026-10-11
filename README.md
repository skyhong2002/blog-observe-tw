<img src="assets/icon.svg" width="64" height="64" alt="">

# blog.observe.tw

Created in [T3 Code](https://t3.codes).

## 目前版本

目前服務使用 Steam Machine 上的 `blog-observe.service`，監聽 `127.0.0.1:18160`，由 Cloudflare Tunnel 提供 `https://blog.observe.tw`。目前版本提供：

- 135 個 seed 部落格目錄，其中 4 個已有核對網址；支援分類搜尋、個別網站頁與原站連結。
- `/healthz`、`/auth/me` 與 Google OAuth PKCE 登入流程；callback 固定為 `https://blog.observe.tw/auth/google/callback`。
- 私有 OAuth 設定檔 `/home/deck/.config/blog-observe.env`，不提交到 Git，也不與 tag.observe.tw 共用服務設定。
- 獨立 MariaDB `blog_observe` schema、Drizzle schema 與持久化 session；seed 匯入器保留原始列、來源 SHA-256、分類與未換算的流量原值。

seed 匯入：

```sh
set -a; . /home/deck/.config/blog-observe.env; set +a
npm run db:migrate
npm run seed:import /path/to/Similar-Web.csv
```

目前附件已匯入 136 列、135 個不重複名稱；原始 CSV 不在 repository，匯入摘要保存在 Steam Machine 的 `/home/deck/.local/share/blog-observe/seed-import-manifest.json`。

完整的來源探索設計（`blogblog.club`、Similarweb Similar Sites、速率限制與和 tag 的協調方式）見 [`docs/discovery.md`](docs/discovery.md)。自動 discovery、RSS 抓取、文章索引、持久化追蹤與個人 RSS 仍在後續區塊完成。
