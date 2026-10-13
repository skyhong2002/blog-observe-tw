# Blue/green 部署前置（尚未代表正式站已切換）

**最新發版規則：**Mint一次建置、技術/B0與主要candidate頁面非作者看圖後，
用 `record-built`／`prepare-built`／`switch` 部署同一份產物；SM不執行會重建的
`prepare`。其餘頁面部署後逐頁review、ledger保留pending。備份須先於additive
migration，完整閘門與立即回滾見 [下一批release](next-release-candidate.md)。
下方含早期引入程序及歷史建置方式，不應當作本輪SM建置許可。

本方案新增固定 loopback edge，不修改 Cloudflare／Tunnel、tag、youtube、既有 blog units、資料表或 worker。正式啟用前必須經整合審查。既有 gateway 直接監聽 18160 的發版流程仍有 restart 空窗，不能稱為零停機。

| 角色 | blue | green |
| --- | --- | --- |
| gateway | 127.0.0.1:18174 | 127.0.0.1:18175 |
| Next web | 127.0.0.1:18172 | 127.0.0.1:18173 |

公開入口維持 `127.0.0.1:18160`，改由 `blog-observe-edge.socket` 持有 listener、edge service 代理到其中一個 gateway。18163 不使用。埠使用狀態須在首次部署前確認；不能停止不屬於本次 blog 部署的程序。

## 安全與切換契約

- Edge 只有編譯固定的兩個 loopback target。`active.json` 只接受 `active`、正整數 `generation`、40 位 `commit`，不接受 URL、host 或 port。每個請求開始時讀取本機 state；已開始的請求繼續原 slot。
- 以單一 host `flock`、同目錄暫存檔、fsync、rename 切換。非法／缺失／倒退 state 保持 edge 已載入的最後有效 target；edge 首次啟動沒有有效 state 就不接受流量。回滾必須增加 generation，不可直接複製舊 state。
- 轉送 Cookie、Authorization、x-api-key、Origin、Host、CF client IP 只到自家固定 gateway；雙向移除 hop headers 與 Connection 指定欄位。Set-Cookie 多值、Cache-Control、Vary、RSC headers 維持。狀態／工具輸出不包含 header、session、token 或 OAuth URL。
- 原始請求路徑必須是單一 `/` 開頭；拒絕絕對 URL、雙斜線／反斜線及其編碼、控制字元。HTTP request/response 串流，不整包緩存在記憶體，不跟 redirect、不重送 GET、HEAD、POST，也不切到另一個 slot 重試。WebSocket、CONNECT 不提供。
- socket activation 僅接受本 PID 的一個名為 `http` 的 FD。平常只換 slot，不重啟 edge。edge 自身更新只重啟 service，保留 socket listener；優雅停止最多等 30 秒，不能保證崩潰或逾時的在途請求零錯誤。

## 不可變 release 與 Next 配對

正式來源為 fetch 後的 `origin/main`，release 沿用既有 `git archive` 不可變產物，位於 `~/.local/share/blog-observe/releases/<完整 SHA>`，具備該次 `npm ci` 與 `npm --prefix web ci` 的相依套件。`prepare` 另外接收乾淨 source checkout（應由 fetch 後的 origin/main 建立），只用它查驗 Git tree／版本，不在該 checkout 提供正式服務。工具逐一串流計算 release tracked files 的 Git blob SHA-1，確認與 source 的指定 commit 一致；release 本身不需要 `.git`。

Next 的 runtime SSR origin 與 build-time rewrites 都要指向**同一個 slot gateway**。`prepare` 先啟動新版 gateway，以 `BLOG_GATEWAY_INTERNAL_URL=http://127.0.0.1:<slot gateway>`、`CIRCLE_NODE_TOTAL=2` 建置新版 web，檢查 routes-manifest 的 `/api`、`/auth` rewrites，才啟動 web。不能把 blue 的建置物直接拿去 green。

`prepare` 會拒絕 active slot、仍在運作的 inactive slot、既有正式服務正在使用的目錄、已準備成功的 release、不是 current origin/main 的 commit，以及正常發版的歷史倒退。建置及 static archive 都會先使用既有 `assertLargeWriteSpace()` 10 GiB 守門。失敗會留下 inactive slot／journal logs／建置資料供診斷，**不自動停止正式站、不刪除檔案、不建立備份**。失敗後要重試同一份尚未準備成功的 release，先明確停止該 inactive slot；已成功的 release 一律不重建。

## 首次引入（仍有一次性最小空窗）

以下為人工操作程序，尚未自動執行。先記錄現有正式服務名稱、release、啟用狀態和可用回復指令。避免同時啟用舊 `blog-observe.service`／`blog-observe-gateway.service` 與 edge socket 搶 18160。

1. 完成測試／review，從 origin/main 建立新的完整 SHA release、安裝依賴。確認磁碟空間及雙 web/gateway 暫時共存的記憶體餘裕；不要和其他大型 build 同時進行。
2. 建立 `~/.local/share/blog-observe/edge/`（0700），將 `edge/code` symlink 固定指向一個已審查、不可變的 release。這是 edge／slot launcher 自身版本，日後一般應用發版不變動此 symlink。
3. 將四個**新增**範本 `blog-observe-edge.{socket,service}`、`blog-observe-gateway@.service`、`blog-observe-web@.service` 安裝至 user units 並 daemon-reload。**此時不要啟動 edge socket/service**，舊 gateway 仍持有 18160。
4. 舊正式服務繼續運作時執行：

   ```bash
   bash tools/deploy-blue-green.sh archive-static /home/deck/.local/share/blog-observe/releases/<前版 d6 完整 SHA>
   bash tools/deploy-blue-green.sh archive-static /home/deck/.local/share/blog-observe/releases/<前版 f6 完整 SHA>
   bash tools/deploy-blue-green.sh prepare green /home/deck/.local/share/blog-observe/releases/<完整 SHA> /home/deck/.cache/<乾淨來源 checkout>
   bash tools/deploy-blue-green.sh bootstrap green
   ```

   `bootstrap` 只在沒有 active state 時成立；預熱通過後寫初始 state，**不停止舊 gateway、不接管 listener**。其輸出 `listenerMigrated: false`，不能當成完成上線。
5. 以單一維運者執行最小切換：停止實際持有 18160 的舊 gateway，立刻啟動 `blog-observe-edge.socket` 與 `blog-observe-edge.service`。舊 gateway 不支援 FD 交接，因此這一步仍有短暫空窗；不變更 CF／Tunnel 的前提下，不能保證首次零中斷。準備好失敗時先停止 **edge socket 和 service**、再恢復原 gateway 的指令。
6. 驗證直連 18160 `/healthz` 回新 gateway port、`x-blog-release`／`x-blog-edge-generation` 正確；正式站、OAuth、私人 session、API、Cookie／RSC cache bypass 及三站 200。觀察無誤後才停用舊 gateway 的開機啟動，啟用 edge socket 與 active slot 的開機啟動；不要讓舊 web/gateway 與新服務在 reboot 後互搶。
7. Worker 仍只有原來一份；依 additive migration／任務相容性獨立切換。Favicons、uploads、cache、DB、Redis、session 金鑰繼續共用 blog 自己的既有 runtime，不與姊妹站共用。不要啟動第二個 worker。

## 之後每次發版

由 `status` 確認 active slot，inactive 是另一色。先保留上一版 release、state transition 紀錄；在舊 slot 已排空且可放棄即時一鍵回滾後，才能明確停止它來準備下一版。工具不會幫忙停止它。

```bash
bash tools/deploy-blue-green.sh status
# 此例 blue 尚未提供正式流量，而且其舊程序已由維運者明確停止。
bash tools/deploy-blue-green.sh prepare blue /home/deck/.local/share/blog-observe/releases/<新完整 SHA> /home/deck/.cache/<乾淨來源 checkout>
bash tools/deploy-blue-green.sh switch blue
```

`prepare` 只檢查 inactive gateway/web，包含 `/healthz`、首頁、目錄、文章、overview、OpenAPI 和 Google OAuth 起始的 S256／精確 callback。啟動預熱只對網路失敗與 HTTP 502／503／504 做最多六輪、輪間一秒的輪詢；錯誤路由、非 HTML、OAuth 契約不符立即停止，最後錯誤不會被籠統訊息覆蓋。

`switch` 重新驗證 ready/build ID、origin/main／祖先關係、所有探針後才切檔；透過 18160 的 `/healthz` 確認 generation／commit／port，另透過同一入口的 `/` 驗證 200 HTML 與相同 generation／commit，不能只有 gateway 健康就視為切換成功。

新版本確認失敗時，**先重新驗證舊 slot**，通過後才增加 generation 切回並再次驗證 edge。舊 slot 不健康時維持目前 target，不把流量切向已停止的服務。工具輸出結構化 `code`、`primaryCode`、`rollbackCode`，分別保留原始失敗與回滾失敗的安全錯誤碼；例如 `rollback_target_unhealthy`、`rollback_publish_failed`、`rollback_ack_failed`。回滾成功仍以 `switch_failed_rolled_back` 回報這次發版失敗。不嘗試重新送出使用者請求。

切換不會停止舊 pair。正常請求在途排空與異常 timeout 的界線不同；至少留足 proxy 120 秒 request timeout／30 秒 graceful 邊界，並觀察流量。維運者可先延長回滾觀察時間，之後再停舊 pair。不要因 probe 200 就立即重啟／停止它。

正式驗收還必須由操作者確認 `https://blog.observe.tw/`、`/healthz`、OAuth 起始、tag/youtube 200、公開 HTML／API 的 no-store、Cloudflare DYNAMIC／BYPASS（不得 HIT、不得有 Age）及私人路徑不共享快取。工具不修改或觸發姊妹站服務。

## 靜態檔與回滾

`prepare` 以 append-only 方式把 `.next/static` 存至 `edge/static`。Edge 優先服務 `GET/HEAD /_next/static/*`，同名不同內容立即拒絕準備；不允許目錄列示、symlink 跳出或覆寫舊檔。此集合保留歷代 immutable chunks，讓 CF／ISR／已開頁面引用前版資產時不會因切換 404。不能只保留 300 秒：瀏覽器開著的舊頁面可能更久才載入 lazy chunk。

首次接管前須對仍可能被 CF／瀏覽器引用的既有版本（至少 d6／f6）執行 `archive-static`。這個命令只把指定 SHA release 的 static append 進集合，不啟動／停止服務或切換 listener。

這一版**沒有自動資產或 release 清理**。需觀察磁碟用量；容量政策應另行審查，不在發版時臨時刪除。Static union 僅保護 `/_next/static`；其他非版本化 public 檔案須保持向後相容，不能把改名刪檔當成已受此機制保護。

```bash
# 舊 blue pair 必須仍在運作且其 ready/build ID 未變。
bash tools/deploy-blue-green.sh rollback blue
```

回滾重新驗證舊 pair，允許 commit 歷史倒退並增加 generation。資料庫僅能依 additive／前後版相容的前提回滾程式；本工具不反向 migration、不還原 DB、不回復已完成外部寫入。若舊 pair 已停／其 slot 已重用，不能再執行上述一鍵回滾；需從保留 release 重新規劃驗證，不得偷偷重建舊 release。

## 驗證

`app/src/edge/edge.spec.ts` 由既有 Vitest glob 自動收錄，測試使用隨機 loopback 測試埠，沒有正式埠／systemd 操作：

```bash
npx vitest run app/src/edge/edge.spec.ts
npx tsc -p tsconfig.json
bash -n tools/deploy-blue-green.sh
```

涵蓋 state 非法保留、monotonic generation、FD 契約、固定 target、防 authority 路徑、hop headers、敏感 header 只到自家 gateway、Set-Cookie、多次方法均不重送、雙向串流、切換時在途請求仍留舊 slot、跨版 static 保留及衝突拒絕。正式 systemd FD 繼承、首次遷移與重啟排隊效果尚須在部署前受控驗證；unit 通過不等於這些環境行為已驗證。

Opus 審查後另有 `app/src/edge/deployment.spec.ts`，測試舊 slot 已停止時不切回、原始與二次錯誤都保留、edge 首頁 HTML／release 驗證，以及 wrapper 只在本身已收到停止信號時，把子程序 SIGTERM／SIGINT 正常結束回報為 0；非預期信號或實際非零退出仍是失敗。執行兩份測試使用 `npx vitest run app/src/edge`。

本輪採納上述 M1／M2／M3 與有限的 L4 啟動輪詢；L2 state TTL 暫不加入，以保持切檔立即生效，L3 公開 commit header 保留供切換驗證（不含秘密）。此階段僅完成程式與測試，正式遷移暫緩，不影響現有服務。


## 2026-10-13：舊服務退役與安全回滾底線

2026-10-12 18:39:21 UTC 核對 active blue 的 gateway/web 為 18174/18172、green 為 18175/18173，兩個 Next build rewrites 與實際子程序的 upstream 均不指向 18162；edge 只接受固定的 slot gateway。

已 `disable --now` 舊 `blog-observe.service`、`blog-observe-web.service`、`blog-observe-favicons.timer`，並停止舊 `blog-observe-favicons.service`。所有 unit、drop-in、release、回滾檔案與備份保留。`127.0.0.1:18162` 不再監聽；`100.85.214.25:18162` 是 tag 的獨立預覽，未操作。slot wrapper 父程序仍可能繼承舊 PORT 值，但它沒有 listener，實際子程序已明確覆寫為 slot 的埠，不能只看父程序 env 判定 upstream。

新的 `blog-observe-active-favicons.timer` 維持每月 1 日 06:20、最多兩小時抖動，呼叫 `blog-observe-active-favicons.service`。launcher 每次從 active.json 讀取並驗證 immutable release，確認 slot descriptor commit 一致且 state 未在讀取途中切換，只允許固定 favicon 命令。該次工作固定使用啟動時的 release，不在執行中換程式；下一次才跟隨新 active slot。既有圖示鎖仍負責互斥，不持有長時間部署鎖。可用 `node app/src/edge/active-job-service.ts --check` 唯讀檢查目標，不抓取、不寫資料。舊 timer 保持 disabled；新排程單獨啟用。

**green 的 2379fba 早於公開資料隱私修正，不可視為安全回滾版本。** 保留它與歷史 release 供診斷，不刪檔、不切回。部署工具對手動切換、手動回滾與自動失敗回復，都要求目標是 `a45b06a8816e8388c463173f6b7c43da81aeb51b` 或其後代；查不到 Git 祖先關係也拒絕。下一版可安全回滾至 a45b06a，不能直接執行舊 release 內未含此檢查的部署工具。

目前所有內容頁與資料 API 維持 no-store，Cloudflare 首頁與 API 兩條規則維持停用。恢復快取須先補齊 origin／Next／edge 撤銷驗證；不能以短 TTL 取代。
