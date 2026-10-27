# blog.observe.tw → weblog.tw 正式搬家

## 範圍與來源

2026-10-27 起以 `https://weblog.tw` 為公開 origin。從 fetched `origin/main` 的 `09ef5be828e89d649afe8c41c259dd7857f9446d` 建立獨立 detached worktree，保留 `f71d796` 網站雷達公開連結修正及 `09ef5be` gen108 receipt，不變更共享 checkout 的未追蹤收錄稽核檔案。

公開 canonical／OG／JSON-LD、sitemap／robots、RSS、favicon URL、OpenAPI／API 文件、安裝指示、analytics 正式 host、crawler 識別與健康探針改為新 origin。既有 `b@blog.observe.tw` 聯絡信箱保留，不假設已建立新的信箱。歷史部署證據、repo 名稱、DB／Redis／queue／service ID 不遷移。Similarweb 自站排除清單加入 weblog.tw，避免向服務索取自站結果。

資料庫、使用者、Google subject、角色、session secret、API key、文章、私有資料、圖示 cache 與靜態資產仍共用原 production 資料。沒有 migration、刪除、重新匯入或新建憑證。cookie 維持 host-only、Secure／HttpOnly／SameSite=Lax；既有 blog 網域 cookie 不跨網域傳送，使用者於 weblog.tw 重新 Google 登入即可使用同一帳號與權限。公開 v1 CORS 仍為無 credentials 的 `*`；寫入與登出仍檢查新 origin，不允許舊 origin 或任意外站繞過 CSRF。

## Production 路由與外部配合

兩個獨立 Cloudflare Tunnel 都連到同一個 `http://127.0.0.1:18160` 穩定 socket／edge，再到 active blue/green gateway/web。blue gateway/web 為 18174/18172；green 為 18175/18173。

- 舊 Tunnel `f6342ca7-0e3b-4998-8971-f8f1837d37e9` 屬帳號 `08f074fca6db8519f744f2a2675a2693`，既有 connector 與 blog 路由保留。
- Genehong 帳號 `377d5174f46c07957963d25668d22cdb` 的新 Tunnel `weblog-production`：`828c67e0-7be5-4558-9dd7-4fc5e96e860e`。
- 新 apex 的 proxied CNAME target 必須為 `828c67e0-7be5-4558-9dd7-4fc5e96e860e.cfargotunnel.com`；Cloudflare 不接受直接 CNAME 到不同帳號的舊 Tunnel。
- Published route 僅 `weblog.tw` → `http://127.0.0.1:18160`，保留原 Host。此次不提供 www，不動 board.tw。
- TLS 在 Cloudflare edge 終止，Tunnel 到本機使用 HTTP loopback；有效 edge certificate 必須涵蓋 weblog.tw。HTML／API 保持不快取。
- DNS／Tunnel route／憑證與 Google callback allowlist 由使用者處理；production 不操作 Cloudflare DNS 或 GSC。
- Google OAuth 既有 client 新增 `https://weblog.tw/auth/google/callback`，保留舊 callback，以供回滾。OAuth 起始／callback 邏輯仍使用同一 client 與 secret。

獨立 user unit `weblog-cloudflared.service` 使用 `%h/.local/libexec/weblog-cloudflared`，僅以 `--token-file %h/.config/weblog/cloudflared.token` 讀取使用者安全安裝的憑證；目錄 0700、檔案 0600，不把 token 放入 shell 參數、Git、回覆或部署證據。舊 connector 不替換、不重啟。

## 兩階段啟用與回滾

1. 在 origin/main 建立不可變 release、同 SHA 安裝與建置，green 候選使用額外 EnvironmentFile 設定 `BLOG_PUBLIC_ORIGIN=https://weblog.tw`，其餘私有設定與旗標保持。
2. `record-built`／`prepare-built green` 預熱並驗證新 Host、SEO、資產、API、登入契約，再 `switch green`。初期舊 Host 仍服務，不先導向未驗證的新站。
3. edge/code 固定到本次不可變 release，保留舊 symlink 目標；重啟 edge service 時保留 socket listener。獨立 operator state `~/.local/share/blog-observe/edge/legacy-host-redirect.json` 缺少時或 `{ "enabled": false }` 時不轉址。
4. 待 weblog.tw HTTPS／路由／OAuth 設定及新站驗收通過，使用既有 `atomicJson` 以原子方式寫入 `{ "enabled": true }`。edge 逐請求讀取，無須重啟服務即可開始將精確舊 Host `blog.observe.tw` 的所有公開 path/query 以 308 送往 `https://weblog.tw`，涵蓋靜態資產與 API，且不信任 x-forwarded-host 作為轉址判斷。新 Host 不轉址，不會回舊站。
5. 舊轉址回應不攜帶 session／Cookie，維持 private no-store，部署／健康探針使用 weblog.tw；保留既有 HSTS、權限與 cache barrier。

回滾先原子寫入 `{ "enabled": false }` 停止舊站轉址，再用本次工具 `rollback blue` 回到保留的 gen108 `f71d7964402c0fb0a11f9f918474d31780972350`。部署工具的舊 ready record 沒有 publicOrigin 時按舊 origin 驗 OAuth，新 ready record 明確保存 weblog origin，兩版皆可健康驗證。edge 可保留新版（轉址關閉）；若需還原 edge/code，必須保留 socket 並先驗證舊目標可用，再重啟 service。若 worker 本批已換版，先停止唯一 worker、確認 PID=0，停用本批額外 release/origin drop-in（移到 drop-in 目錄外保留），daemon-reload 後啟動原 worker；不刪除資料，不開第二份 worker。

## 驗證與執行 receipt

部署後補記應用 SHA、BUILD_ID、generation、edge/code 前後目標、worker 設定與實際 HTTP 結果。Google 真實帳號互動授權由本人完成，production smoke 不新建 token、臨時 session 或測試帳號。
