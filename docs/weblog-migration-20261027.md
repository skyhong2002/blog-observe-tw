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

## 正式上線結果（2026-10-28 00:08–00:16，台北時間）

- 應用：`d507a1fb6e81db21815dcde2ba6695df06ec8f7a`，**green／generation 109**，BUILD_ID `O0iePAwCzsAmdUMfO-Qnc`。主要搬家提交為 `b8b096420c0e37c6b721bd748e1f17a417a16f94`，d507a1f 將 PWA manifest 改成 force-dynamic，避免候選 manifest 請求產生 route cache。b8b0964 的切換曾因衍生快取觸發校驗而被拒絕，沒有對它切流量、覆寫 receipt 或重建已審產物。
- 部署操作工具：`f26af867a0ecec1eb9b248b68abc0f9729799cc6`。Next 16 正常讀取靜態 `/api/` 頁面也會新增 `standalone/web/.next/server/route-cache`，因此工具只將這個執行期衍生目錄排除於 hash；其目錄不得為 symlink，compiled server/app、primary build、manifest、靜態資產、public 檔案及兩側 dependencies 仍完整比對。8 項工具測試通過，並用原始 receipt 重驗 gen108 與 gen109 皆通過，未重寫 receipt。這筆是操作者工具修正，不是另一個應用部署。
- `edge/code` 從保留的 `93060cc5e97628f84fa1fb2b8e9eecc41157d462` 指到 d507a1f release；只重啟 edge service、保留 socket。舊 pin 記錄於 `~/.config/weblog/edge-rollback.json`，原 release 保留。
- 正式外部檢查全部通過後，才原子寫入 `legacy-host-redirect.json` 的 `{ "enabled": true }`。blue／gen108 `f71d7964402c0fb0a11f9f918474d31780972350` 的 gateway/web 仍 active，作為立即回滾點。
- gateway green 的額外設定：`~/.config/systemd/user/blog-observe-gateway@green.service.d/95-weblog-origin.conf`，追加 `~/.config/weblog/blog-origin.env`，內容僅 `BLOG_PUBLIC_ORIGIN=https://weblog.tw`。全域原 production env 及 blue 設定沒有覆寫。
- worker 先做同 release Sharp 1×1 PNG smoke，再停止唯一 worker、確認 PID=0，追加 `~/.config/systemd/user/blog-observe-worker.service.d/zz-weblog-release-d507a1f.conf`。WorkingDirectory 與 NODE_PATH 指向 d507a1f，追加同一 origin env，原 drop-ins 全部保留。PID `3611249` 自 00:09:25 起持續 active，觀察超過一分鐘、NRestarts=0，實際 cwd／NODE_PATH／BLOG_PUBLIC_ORIGIN 都已核對。沒有同時啟動第二份 worker。
- `weblog-cloudflared.service` active，PID `3590714`、NRestarts=0，readiness 200、4 條 HA 連線；舊 connector 未停止。edge、四個 blue/green gateway/web、唯一 worker 及 active-favicons timer 正常。

### 公網驗收證據

新站驗收使用正確 Host/SNI 的 HTTPS（憑證驗證保持開啟）。本機當時有 DNS 負快取，curl 以已確認的 Cloudflare IP `104.21.69.174` 配 `--resolve weblog.tw:443:104.21.69.174`；使用者已獨立確認 1.1.1.1／8.8.8.8 的 DNS 回應及有效 edge cert，並非僅以 loopback 取代正式驗收。

- `/`、`/blogs/kocpc/`、`/articles/?q=WordPress`、`/tech/` 均 200，自我 canonical／OG URL 與本站 JSON-LD 均使用 weblog.tw。本站不託管原作者全文的獨立文章頁；原始文章連結不重寫。
- 深層話題 `https://weblog.tw/topics/%E5%89%B5%E6%A5%AD%E5%AE%B6/` 回 200；`/sitemaps/topics.xml` 抽查 663 筆全為 weblog.tw。`/sitemap.xml`、`/sitemaps/pages.xml`、`/sitemaps/blogs.xml`、`/robots.txt` 均 200，本站 URL 無舊 origin。
- `https://weblog.tw/sitemap.xml` 是交付 GSC 的 sitemap index；robots 的 Sitemap 指向同網址。使用者已回報新 sitemap Success、舊 GSC 資源 currently moving to weblog.tw，Confirm Move 由使用者完成，production 未操作 GSC。
- `/api/blogs/kocpc/mentions.xml` RSS、`/healthz`、`/api/blogs/kocpc`、`/api/v1/articles?limit=1`、`/api/v1/openapi.json` 均 200；OpenAPI server 為 `https://weblog.tw`。公開 v1 OPTIONS 204、ACAO `*`、無 allow-credentials，原 rate limit／權限設計不變。
- `/manifest.webmanifest`、`/pwa/icon-192.png`、Next JS chunk 均 200；JS 仍有 immutable cache。HTML／API／auth 維持 `private, no-store`、CF DYNAMIC、無 Age，release／generation headers 都是 d507a1f／109。
- 「編輯標籤」仍指向 `https://site.observe.tw/site/kocpc.com.tw/#tags`，退休 API 回 410 的 url 也相同，保留 f71d796 的結果。
- Google production client ID 與使用者更新的 `453403068137-vtmr47o8so8edt9o7192q0vnvl7qebq8.apps.googleusercontent.com` 完全相符。OAuth 起始 302、S256、新 callback 正確，cookie 為 host-only／Secure／HttpOnly／SameSite=Lax；錯誤 callback 安全返回登入頁。同源無 session 的登出 POST 回 303 並清 cookie，舊 origin 登出回 403。單測涵蓋成功登入持久化、既有身分、錯誤與取消情境。**本人 Google 真實登入、帳號／追蹤與管理權限的人工驗收尚未完成，不能宣稱已人工驗證。**
- 32 組 HTTPS 舊 Host GET／HEAD／POST／OPTIONS，覆蓋首頁、深層部落格、文章搜尋、robots、sitemap、JS、API、OAuth，皆 308 到新域同 path/query，無 Set-Cookie；三組跟隨轉址（首頁、重複 query／百分比編碼的部落格頁、既有 JS）均只轉一次後 200，無 loop。
- 舊 HTTP 目前先由 Cloudflare 308 升級到同 path/query 的 HTTPS 舊站，再 308 到 weblog.tw；兩段都是永久轉址且無 loop。HTTPS 舊站是一段 308。
- 曾發現不帶 query 的舊 JS 命中 Cloudflare gen3 HIT／200，origin 實際已回 308。使用者於 observe.tw zone 新增 Active rule `blog.observe.tw migration - bypass cache`，ID `78056645924c48218b725352e5d16e79`，精確 `(http.host eq "blog.observe.tw")`、Bypass cache、order 8／Last。重驗 `https://blog.observe.tw/_next/static/chunks/28lretm4o41_m.js` 為 308、CF DYNAMIC、gen109／d507a1f，未用 cache-busting query 規避問題。此 Cache Bypass 不必在回滾時關閉，也不影響其他 Host。
- tag／youtube 首頁仍 200。未變更 board.tw、其他 repo、Cloudflare DNS 或 GSC。

### 分析設定與跨 repo 盤點

GA4 沿用 measurement `G-VKWGDHDESV`、property `558498886`、stream `16112932212`。使用者已將 stream URL 更新為 `https://weblog.tw`、property 名稱改為「部落格觀察（weblog.tw）」，Data filter 僅 Internal Traffic Testing。沒有另外配置 GTM container；正式 HTML 未發現注入 Cloudflare Web Analytics beacon。原 DNT／GPC／opt-out 與敏感頁排除都保留。

唯讀盤點 tag 正式來源及 urtube，沒有必須同步修改的部落格公開連結或 Host 相依；網站雷達 `src/tech-pages.ts`、`src/api-docs.ts` 的舊網域文字是在描述歷史技術觀測匯入來源，可由該 repo 擁有者日後整理，不是 routing 依賴。服務間仍走原 loopback，沒有跨 repo 改碼或覆蓋其他人的工作。

### 測試

前後端 typecheck 通過；後端 Vitest 150 檔／1,470 項、web 251 項、render 13 檔／203 項、capture 工具 57 項、prebuilt 工具 8 項通過。高負載下後端使用 `--testTimeout=20000`，沒有修改測試本身的 timeout 設定。manifest 修正後再跑 typecheck／251 項 web 測試、正式 build 與完整候選驗收；工具修正後再跑 8 項 prebuilt 測試及 typecheck。

`npm run lint` 有 37 個既有錯誤、9 個警告；異動中的 audit-topic-history／guarded-build／ui-capture 兩檔工具原本就有 7 個錯誤與1個警告，於 fetched 基底相同四檔重跑亦一致。新 edge／OAuth／部署工具程式檢查通過，未為改網域全面格式化既有大型工具。`docs:api:check`、`git diff --check` 通過。

本機機器可讀證據（無 token／Cookie 值）：`/tmp/weblog-production-before-redirect.json`、`/tmp/weblog-candidate-final.json`、`/tmp/weblog-redirect-verification.json`、`/tmp/weblog-deep-topic.json`；測試／建置 log 以 `/tmp/weblog-` 開頭。上方結果已摘要保存於 Git，tmp 不是唯一正式紀錄。

### 精確回滾（恢復舊站為權威 origin）

使用已含衍生快取校驗修正的本次 source 工具，不使用 release 內較舊的部署工具：

```bash
cd /home/deck/.cache/blog-weblog-migration
# 先關閉舊 Host 的 308，避免切回舊版後仍導向新域。
flock --exclusive --nonblock "$HOME/.local/share/blog-observe/edge/deploy.lock" \
  node --input-type=module -e 'import { atomicJson } from "./app/src/edge/state.ts"; await atomicJson(process.env.HOME+"/.local/share/blog-observe/edge/legacy-host-redirect.json", { enabled: false });'
bash tools/deploy-blue-green.sh rollback blue
# 只在 web 已成功回滾後還原唯一 worker；先確認完全停止。
systemctl --user stop blog-observe-worker.service
test "$(systemctl --user show blog-observe-worker.service --property=MainPID --value)" = 0
mv "$HOME/.config/systemd/user/blog-observe-worker.service.d/zz-weblog-release-d507a1f.conf" \
  "$HOME/.config/weblog/zz-weblog-release-d507a1f.rollback-kept.conf"
systemctl --user daemon-reload
systemctl --user start blog-observe-worker.service
```

工具會先驗 blue ready／BUILD_ID／產物與健康，再增加 generation，不能手動複製舊 active.json。blue 回到 f71d796，worker 由保留的 99-release-1e2ce1a.conf 回到 1e2ce1a 的 origin／NODE_PATH；新 edge 保留、轉址關閉即可，不必再次換 edge/code。確認舊站 HTML／API／OAuth、worker cwd／PID／NRestarts，資料不回復、不刪除；Google 舊 callback 已保留。兩個 Tunnel 與 Cache Bypass 可保持。

這個回滾是恢復 `blog.observe.tw` 的服務與登入；若還要把使用者從 weblog.tw 導回舊站，須由使用者協調 Cloudflare 新 zone 的臨時 307（只能在舊站 308 已關閉後啟用，避免 loop），並按實際回滾狀態處理 GSC。production 不擅自撤回使用者已確認的 GSC 網址變更。

確實尚待：

1. 由本人在 weblog.tw 完成一次 Google 真實登入，確認原帳號／追蹤／角色或管理權限，然後登出。
DNS 未決項已解除（2026-10-28）：使用者授權並登入 `192.168.88.1` 的 WebFig（RouterOS 7.6）處理。據使用者實測，固定 upstream `45.90.28.20`／`45.90.30.20` 直接查詢均逾時，動態上游 `140.113.1.1` 對 weblog.tw 回 NODATA／舊 SOA，另一動態上游 `140.113.6.2` 正常；清除路由器快取後仍未恢復。因此新增精確 DNS 規則：Name `weblog.tw`、Type `FWD`、Forward To `1.1.1.1`、TTL `00:05:00`，comment 為 `weblog.tw migration DNS fix 2026-10-28: forward to Cloudflare; preserve default upstreams`。其餘 DNS 設定及預設上游保持，未硬寫網站 IP。

使用者已確認路由器 A／AAAA、Mac Tailscale `100.100.100.100` 解析正常，Mac 以系統 DNS、不帶 `--resolve` 的 HTTPS 回 200，Brave 首頁亦已載入。Production 本次僅重驗一次 `curl https://weblog.tw/`：使用系統 DNS、未帶 `--resolve`、TLS 憑證驗證保持開啟，結果 **HTTP 200**，remote IP `172.67.210.176`、TLS verify result `0`。本次只更新此紀錄，不重跑整套測試、不重新部署；Google 真人登入仍未驗證。

其餘上述程式、部署與公開 HTTP 驗收已完成。最終 edge socket/service、blue／green 四個 slot units、唯一 worker、獨立 connector 及 favicon timer 均 active；worker PID 3611249、connector PID 3590714 均 NRestarts=0。最終 connector 為 4 條 HA 連線；累積 request_errors 1（非零累計），不能寫成整段觀察期零錯誤，目前 readiness 與公網請求正常。
