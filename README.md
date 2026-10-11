<img src="assets/icon.svg" width="64" height="64" alt="">

# blog.observe.tw

Created in [T3 Code](https://t3.codes).

## 目前版本

目前服務使用 Steam Machine 上分離的 gateway、web、worker user services：gateway 對外監聽 `127.0.0.1:18160`，Next web 監聽 `127.0.0.1:18162`，由 Cloudflare Tunnel 提供 `https://blog.observe.tw`。目前版本提供：

- 135 個 seed 部落格目錄，其中 4 個已有核對網址；支援分類搜尋、個別網站頁與原站連結。
- `/healthz`、`/auth/me` 與 Google OAuth PKCE 登入流程；callback 固定為 `https://blog.observe.tw/auth/google/callback`。
- 私有 OAuth 設定檔 `/home/deck/.config/blog-observe.env`，不提交到 Git，也不與 tag.observe.tw 共用服務設定。
- 獨立 MariaDB `blog_observe` schema、Drizzle schema 與持久化 session；seed 匯入器保留原始列、來源 SHA-256、分類與未換算的流量原值。
- 登入後可追蹤部落格，透過 `/me/feed.xml` 匯出個人 RSS，並以 `/me/opml` 匯出、`POST /api/me/opml` 匯入 OPML；未知 OPML 網址只進候選清單，不會自動公開收錄。
- 專案骨架跟隨 tag.observe.tw 固定 commit `afe0a653fa8aae7e25a04a1d9fe87bf0400a2a39`：Fastify、Drizzle、BullMQ、Next 16、React 19、Tailwind 4、Biome、Vitest；`NOTICE` 保留移植來源與 MIT 聲明。
- RSS/Atom/sitemap 抓取遵守 robots、識別 User-Agent、每站延遲和 ETag/Last-Modified；blogblog.club discovery 每週執行，Similarweb Similar Sites 預設關閉且有主機級 budget/lock。

seed 匯入：

```sh
set -a; . /home/deck/.config/blog-observe.env; set +a
npm run db:migrate
npm run seed:import /path/to/Similar-Web.csv
```

目前附件已匯入 136 列、135 個不重複名稱；原始 CSV 不在 repository，匯入摘要保存在 Steam Machine 的 `/home/deck/.local/share/blog-observe/seed-import-manifest.json`。

完整的來源探索設計（`blogblog.club`、Similarweb Similar Sites、速率限制與和 tag 的協調方式）見 [`docs/discovery.md`](docs/discovery.md)。正式 Google 帳號登入仍需使用者本人在瀏覽器完成；Similarweb 跨服務共用鎖與 tag 端排程整合仍是後續工作。
