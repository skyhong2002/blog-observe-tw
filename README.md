<img src="assets/icon.svg" width="64" height="64" alt="">

# blog.observe.tw

Created in [T3 Code](https://t3.codes).

## 目前版本

目前服務使用 Steam Machine 上分離的 gateway、web、worker user services：gateway 對外監聽 `127.0.0.1:18160`，Next web 監聽 `127.0.0.1:18162`，由 Cloudflare Tunnel 提供 `https://blog.observe.tw`。目前版本提供：

- 前端直接移植新文易數的 Tailwind 4 版面、分組導覽、來源頁、文章列表、手機選單、深淺色與 PWA 元件；首頁顯示收錄排行、標籤與文章，詳見 [`docs/frontend-parity.md`](docs/frontend-parity.md)。
- 135 個原始 seed 與通過 RSS 自動驗證的新收錄部落格，網址核對與收錄統計見 [種子處理紀錄](docs/seed-resolution-2026-10-12.md)；支援分類搜尋、個別網站頁與原站連結。
- `/healthz`、`/auth/me` 與 Google OAuth PKCE 登入流程；callback 固定為 `https://blog.observe.tw/auth/google/callback`。
- 私有 OAuth 設定檔 `/home/deck/.config/blog-observe.env`，不提交到 Git，也不與 tag.observe.tw 共用服務設定。
- 獨立 MariaDB `blog_observe` schema、Drizzle schema 與持久化 session；seed 匯入器保留原始列、來源 SHA-256、分類與未換算的流量原值。
- 登入後可追蹤部落格，透過 `/me/feed.xml` 匯出個人 RSS，並以 `/me/opml` 匯出、`POST /api/me/opml` 匯入 OPML；未知 OPML 網址只進候選清單，不會自動公開收錄。
- 專案骨架跟隨 tag.observe.tw 固定 commit `afe0a653fa8aae7e25a04a1d9fe87bf0400a2a39`：Fastify、Drizzle、BullMQ、Next 16、React 19、Tailwind 4、Biome、Vitest；`NOTICE` 保留移植來源與 MIT 聲明。
- RSS/Atom/sitemap 抓取遵守 robots、識別 User-Agent、每站延遲和 ETag/Last-Modified；blogblog.club discovery 每週執行，Similarweb 已接通 tag 的唯一供應商工作，正式旗標已啟用，本地持久化限制每日 30 次提交與至少六小時輪詢；舊 direct provider 與 mkdir 鎖已移除。
- 作者身份以部落格範圍分開保存，爬蟲標籤與社群／人工標籤有 provenance，不會覆蓋人工修訂；部落格另外保存最後抓取成功、最後發文、預期更新頻率與歷史匯入時間，低頻站不因沒有近期文章被判 stale。
- 高信心且首頁／RSS 身份一致的候選會自動收錄；未通過者保留原因，管理員仍可在 `/admin/discovery/` 查看來源、路徑與稽核；設定檔以 `BLOG_ADMIN_EMAILS`（逗號分隔）指定帳號，所有決定寫入 audit。

seed 匯入：

```sh
set -a; . /home/deck/.config/blog-observe.env; set +a
npm run db:migrate
npm run seed:import /path/to/Similar-Web.csv
# 歷史匯入模式：保留舊文，不把 sitemap lastmod 當原始發文時間
npm run history:batch -- --blogs 5 --pages 5 --articles 30
```

網址搬家或合併先以 dry-run 檢查，確認不是 Blogger、WordPress.com、Medium、Pixnet 等共用平台後才加 `--apply`：

```sh
npm run blogs:merge -- old-slug new-slug
npm run blogs:merge -- old-slug new-slug --apply
```

目前附件已匯入 136 列、135 個不重複名稱；原始 CSV 不在 repository，匯入摘要保存在 Steam Machine 的 `/home/deck/.local/share/blog-observe/seed-import-manifest.json`。

完整的來源探索設計（`blogblog.club`、Similarweb Similar Sites、速率限制與和 tag 的協調方式）見 [`docs/discovery.md`](docs/discovery.md)。正式 Google 帳號登入仍需使用者本人在瀏覽器完成；Similarweb 方案一已接成 tag 的 loopback API client：只提交核准網域，每日最多 30 次、六小時輪詢、配額與退避持久化，預設 `BLOG_SIMILARWEB_ENABLED=false`。契約與回滾見 [`docs/similarweb-coordination-proposal.md`](docs/similarweb-coordination-proposal.md)。圖示抓取、私人 runtime catalog 與每月刷新見 [`docs/favicons.md`](docs/favicons.md)。

最新部署與完整驗收、favicon 全批數量及真人驗收項目見 [2026-10-12 部署紀錄](docs/deployment-2026-10-12.md)。

## 開發與發版

以 GitHub `main` 為唯一整合與發版來源；主要工作目錄 `/home/deck/.t3/projects/blog-observe-tw` 的 main 已同步，`feat/tag-frontend-parity` 已完整納入。新工作先 fetch，再從遠端 main 開始；正式服務固定使用 commit SHA 的獨立 release，不從功能分支或 checkout 的舊 `.next` 發版。詳見 [分支、部署與回滾流程](docs/deployment.md)。

依使用者要求，自行搜尋並驗證 131 個缺網址 seed；唯一官方身份及有效 RSS／Atom／sitemap 通過後直接補入既有 seed，真正無法驗證者保留 unresolved 與證據。詳見 [種子網址驗證流程](docs/seed-url-matching-proposal.md)。

## 歷史匯入與自動驗證

[持久化歷史遍歷](docs/history-import.md)支援 sitemap 全分片、RSS／Atom 下一頁與 WordPress／Blogger 公開分頁；每五分鐘處理最久未輪到的五站，按頁數、文章數與時間切批，不因低頻發文判 stale。僅走完且沒有來源缺口才標完整，受限或公開索引不足會明確保留狀態。

[候選自動收錄](docs/automatic-candidate-review.md)每半小時驗證最多25筆，完整名稱、RSS首頁與文章歸屬皆須一致；網站／feed所有權、人工決定與稽核在同一交易保護。每十五分鐘另補最多10個新收錄站的缺圖，失敗冷卻七天；每月原圖示刷新保留。三種新工作都在 blog 自己的 BullMQ 單一 worker，以獨立旗標停止，姊妹站不改動。

最新部署與本輪驗收：[2026-10-12 歷史遍歷、來源驗證與圖示補齊](docs/completion-2026-10-12.md)。

## 部落格之間的引用與探索

[關係、探索與話題設計](docs/blog-relationships.md)：文章正文的外連與 blogroll、側欄、留言分開保存；
`/relations/` 看提及方向與互相引用，部落格頁可查看「提到誰／被誰提到」並回原文章核對。
`/topics/` 採 7／30／90 天與同站遞減權重；本站 RSS 標籤和 tag 公開文章窗口的共同詞彙分開標示。
詞庫保留來源、固定窗口、版本與同步時間，不宣稱尚未部署的完整匯出已可用。

新工作以 `BLOG_RELATIONS_ENABLED`、`BLOG_AI_ENABLED`、`BLOG_TOPICS_ENABLED`、`BLOG_VOCABULARY_ENABLED`
獨立啟用（程式預設關閉，正式部署審查後明確設定）。沿用 blog 原本的單一 worker／佇列。
`relations:once`、`ai:once`、`topics:once`、`vocabulary:sync` 可手動執行同一個有預算的工作。
AI 一律使用 `sky-quality` 別名，標示「AI 推定」；私密金鑰不入庫，人工覆寫優先於自動產生的簡介／主題。
Similarweb 目前不提供引薦流量欄位，擴充需求見[欄位提案](docs/similarweb-referrals-proposal.md)，沒有修改 tag。

管理員身分綁定、權限與稽核：見 [docs/admin-access.md](docs/admin-access.md)。
