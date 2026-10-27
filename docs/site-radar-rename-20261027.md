# 網站雷達更名與公開連結更新（2026-10-27）

來源：fetch 後的 `origin/main`，基底 `cd7126de6265173f736f516934e2ba50b2e06306`；以獨立 detached worktree 作業，未變更共享 checkout 的未追蹤收錄稽核檔案。

應用 commit：`f71d7964402c0fb0a11f9f918474d31780972350`。

- `TRAFFIC_ORIGIN` 改為 `https://site.observe.tw`，編輯標籤與退休寫入 API 的 `410 tags_moved` 都使用新網址，保留 `/site/<domain>/#tags`。
- 前端公開契約僅接受新網域；更新連結提示、方法說明、管理頁、文章說明、技術資料頁外連、SEO 與 API 方法描述為「網站雷達」及新網址。
- 保留 `TRAFFIC_TAGS_BASE`、`TRAFFIC_SIMILARWEB_BASE`、`TRAFFIC_WATCH_URL` 的 `127.0.0.1:18150/internal/...` 呼叫。服務識別碼、方法 ID、repo 名稱和歷史部署證據保留。
- 全 repo 搜尋舊網域，執行碼剩餘命中皆為服務／repo 註解；測試保留一筆舊網址拒絕案例。

## 檢查

- 前後端 `npm run typecheck` 通過。
- 後端 Vitest：150 檔、1,468 項通過（`npm test -- --testTimeout=20000`）。初次預設 5 秒測試遇到 snapshot-full-caller 的 child process 及 runtime-icons 逾時，單獨重跑兩檔共 22 項通過；最終完整套件亦通過。未修改測試逾時設定檔或測試程式。
- `npm run test:web`：251 項通過。
- `npm run test:topic-ui`：13 檔、203 項通過。
- 全 repo `npm run lint`：38 個錯誤、9 個警告；乾淨基底同工具檢查為 40 個錯誤、5 個警告，既有 Hook 相依診斷數會變動。本次修改檔案的 Biome 檢查全過，完整診斷沒有落在本次修改檔案上。
- `npm run docs:api:check`、`git diff --check` 通過。
- 不可變 release 以相同 SHA 的 `git archive` 建立，獨立 `npm ci`；Next 正式建置、standalone BUILD_ID 與 API HTML 比對通過。

## 部署

2026-10-27 23:50（台北時間），blue／generation **108**，應用 SHA `f71d7964402c0fb0a11f9f918474d31780972350`，BUILD_ID `lWYEiETKq3k_OWhLgZ3eT`。

使用低優先權建置（nice 19／ionice c3，Next workers 2），設定 `BLOG_TECH_PUBLIC_ENABLED=true` 與 blue gateway `http://127.0.0.1:18174`。完成 `record-built`、`prepare-built blue`，候選 HTTP 頁面與 API 驗證後執行 `switch blue`；部署不重建已記錄產物，未重啟 edge。沒有 migration、worker 變更或姊妹站設定變更。

- 正式 `/blogs/kocpc/` 的實際 HTML 只有一個「編輯標籤」，href 為 `https://site.observe.tw/site/kocpc.com.tw/#tags`，title 為 `site.observe.tw/site/kocpc.com.tw/`。技術明細連到 `https://site.observe.tw/tech/kocpc.com.tw/`。
- 新目的頁 `https://site.observe.tw/site/kocpc.com.tw/` 直接回 200（無 Location），HTML 有 `id="tags"`。
- `/api/blogs/kocpc` 的 `tagsUrl` 與上方相同；`GET /api/me/blog-genres/kocpc` 回 410 `{ "error": "tags_moved", "url": "https://site.observe.tw/site/kocpc.com.tw/#tags" }`。
- `/`、`/healthz`、`/blogs/`、`/blogs/kocpc/`、`/tech/`、`/api/blogs/kocpc`、`/api/tech` 均 200；release header 同應用 SHA，generation 108，`private, no-store`、CF `DYNAMIC`、沒有 Age。三個 HTML 內容均無舊網域。
- Google OAuth 起始 302、S256、callback 精確為 `https://blog.observe.tw/auth/google/callback`。tag／youtube 首頁均 200。
- blue／green 的 gateway／web 四個 unit 均 active。前版 green／gen107 `1e2ce1a06aaa3e90170d474d51ae61c10345f4c8` 保留運作，未停止。

必要時使用本次 source 工具 `bash tools/deploy-blue-green.sh rollback green`；工具先重驗舊 pair 健康才增加 generation 切回。worker 未變更，無須切換。

本次本機驗證紀錄：`/tmp/blog-site-rename-production.json`、`/tmp/blog-site-rename-candidate.json`、`/tmp/blog-site-rename-build.log`、`/tmp/blog-site-rename-vitest-20s.log`、`/tmp/blog-site-rename-web-final.log`、`/tmp/blog-site-rename-ui-final.log`、`/tmp/blog-site-rename-changed-lint.log`。
