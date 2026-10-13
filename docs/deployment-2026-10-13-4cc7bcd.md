# 4cc7bcd 同產物部署紀錄

UTC **2026-10-13T06:28:04.914Z**，edge 從 blue `42711cf18c452b406904af6000ccbf88a1ff6102` generation4 原子切至 green **`4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8` generation5**。先確認 inactive gateway/web 可用再切流量，沒有停止原 active 服務。

- fetch 的 `origin/main` 基底及 runtime release：`4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8`。
- Next BUILD_ID：`2ZIfs00KopZi_HHl8ahLU`；Git source tree：`de1ca738a2e351895b4f354908142351e917b6f7`。
- release：`/home/deck/.local/share/blog-observe/releases/4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8`；gateway18175、web18173、edge18160。
- `active.json`：`/home/deck/.local/share/blog-observe/edge/active.json`；切換 UTC 原始 journal：`/home/deck/.local/share/blog-observe/edge/transitions/5.json`。
- 建置名額 UTC06:04 已交 YT。後續 prepare、candidate review、switch **全部使用同一份產物**，沒有重新建置。收尾 guard／文件 commit 不取代上述 runtime SHA。

## 已公開的範圍

- 首頁話題 coverage SQL 改為單次證據掃描；不恢復查詢 promise 共用或快取。
- `/tech/` 與部落格技術區、導覽入口公開；CMS／主題／外掛與主機／CDN分開，附規則、信心度、觀測時間，只採明確版本。
- F3 正文直接引用、兩方向文章／日期／上下文，非正文 Blogroll 分列；沒有分析結果不能表示成「零相似」，共同標籤也不當交流。
- 話題頁初始先顯示文章，方法與除錯說明收合；歷史 fallback 維持。
- B3 shared-label 同步／公開、common-tags、歷史正文搜尋仍 **false**。程式存在不代表功能已驗收或上線。

可驗收：

- https://blog.observe.tw/
- https://blog.observe.tw/tech/
- https://blog.observe.tw/relations/
- https://blog.observe.tw/blogs/alinalife-tw-567/
- https://blog.observe.tw/blogs/carol-691/
- https://blog.observe.tw/blogs/blog.timdream.org/
- https://blog.observe.tw/topics/風險管理/

新增操作 guard／capture 單元與 mock 測試53項通過，passive observer單元11項通過；另有同SHA/build的隱私整合結果見下文。測試檔包含 `tools/guarded-build.test.mjs`、`tools/ui-capture.test.mjs`、`app/src/tech/observer.spec.ts`；私有interaction helper測試屬截圖工具，不作產品UI pass。

## 真正的 candidate 圖片 review

提交 manifest：`/home/deck/.t3/projects/blog-observe-tw/.reviews/thaw-candidate/submission-manifest.json`。14批／56張圖片、9份獨立 review 的絕對路徑和 hash；每張都有實際 SHA、BUILD_ID、viewport、theme，所有批次 GA/GTM=0。圖片保存在 repo 外私有目錄，不入 Git。

逐頁結果與原始 model／圖片工具呼叫／transcript：`docs/ui-review-ledger.md`。F4 補驗了桌機1280／手機390、深淺色、橫捲、篩選零筆、精準 synthetic503 錯誤、313站真實資料首50筆，已審範圍無 blocking；合成 fixture 與真資料清楚區分。**完整24項仍 pass0／fixed3／issues8／pending11／n/a-ui2；正式切換後 babysit 瀏覽器重驗尚待。** 不用設定檔、HTTP200或這份索引取代看圖。

## 隱私、功能與健康

同 build 的53個 barrier、60個SSR/RSC sequence通過（57個200、撤下部落格3個404）；無sleep／TTL／重試湊通過。證據在 `/home/deck/.t3/projects/blog-observe-tw/.reviews/thaw-candidate/4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8/privacy/`。新的匿名請求獨立fresh read；hide／rejected／moved／delete／future predicate維持。不恢復Next／origin／CF共享快取。

正式測量原檔：

- 前：`/home/deck/.t3/projects/blog-observe-tw/.reviews/thaw-candidate/formal-before-1791872806846.json`，UTC06:25:24–06:26:46，blue427。
- 後：`/home/deck/.t3/projects/blog-observe-tw/.reviews/thaw-candidate/formal-after-1791872986420.json`，UTC06:28:26–06:29:46，green4cc。

DNT=1、Accept:text/html、每站5次、間隔3秒，只下載首頁HTML，不執行JS或送GA；curl `time_total` 中位數：

|站|切換前|切換後|核定閘門|
|---|---:|---:|---:|
|blog|3.978237s|3.561391s|6.17s|
|tag|0.267657s|0.218055s|2s|
|YT|0.196875s|0.274359s|2s|

這是來源站渲染＋Cloudflare＋網路的端到端數字，不是精確origin渲染時間，也不據此宣稱純SQL提速比例。blog後五次為3.900、3.184、3.561、5.028、3.020秒；只有5次，不估計p95。核定baseline仍UTC05:47:30–05:48:30的3.085／0.256／0.289，門檻不隨本次數字更新。

首頁、`/blogs/`、`/topics/`、`/tech/`、`/relations/`、`/articles/`、`/api/v1/articles`、`/api/v1/openapi.json`、`/healthz`均200、`private, no-store`、`cf-cache-status: DYNAMIC`。missing404、SSRF測試400；上述採樣皆HSTS `max-age=86400`，未加includeSubDomains/preload。OAuth起始302、S256、callback精確為`https://blog.observe.tw/auth/google/callback`；真人Google登入仍待本人。tag／YT皆200。

load1：切換前測量起迄4.04→6.09；切換後4.07→3.05，不能將其變化完全歸因本批。切換時磁碟約66G（df），後驗65.14GiB；全程高於40GiB。不碰CF/WAF/tag-backup；兩條CF規則維持disabled。沒有刪除既有release／rollback／備份／worktree。

## 資料、worker與回滾

0020–0022於UTC05:55:58新增表／索引，未ALTER舊欄位或改舊constraint。MariaDB DDL不可依BEGIN保證rollback；全部已成功，不盲目重跑。既有完整gzip備份早於本批，只查metadata，未宣稱本次restore測試：`/home/deck/.local/share/blog-observe/backups/pre-completion-2026-10-12T15-35-00.738Z.sql.gz`。不為純程式與additive變更另產生大型備份。

只讀既有HTML、每批10站的回填完成：公開313站，260 unknown、53 not-observed；detected／failed／blocked各0（UTC06:19:50）。保留原obtainedAt，缺head／header的正文片段不能推測CMS；Alina、Carol、timdream真站目前unknown，這三例尚未驗收。新觀測只從原有抓取回應補，不增加請求。

首次worker交接：舊PID1107721停止後，新PID1494220於UTC06:31:11啟動，但後續檢查發現 `MODULE_NOT_FOUND: sharp`，共24次自動重啟；不能把最初 systemd active 當成功。已停止新worker並恢復427單worker（NRestarts0）。網頁green未受影響。實際首次嘗試紀錄：`/home/deck/.t3/projects/blog-observe-tw/.reviews/thaw-candidate/worker-transition.json`，補正為失敗；恢復紀錄 `worker-rollback.json` 同目錄，原檔均保留。根因是backend以root web/package.json解析sharp，而依賴只在本次已固定的standalone/web/node_modules中；後續同產物NODE_PATH修正須以最終紀錄為準。observer只有解析與metadata寫入，最多32DTO、單DB writer；source review已確認無新HTTP／job。shutdown未等待queue idle，可能遺失best-effort metadata；非部分文章公開或隱私繞過，需後續補drain與測試。

最後已採同產物設定修正：worker 的 WorkingDirectory 與 NODE_PATH 均精確指向4cc release（後者為 `web/.next/standalone/web/node_modules`），未拷貝依賴、未改產物、未重建。獨立驗證 sharp／native／libvips 全在同 release 且包含於已核對的 standalone tree／外部 anchor；review：`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/worker-node-path-4cc7bcd-review.json`。另做記憶體內PNG encode/decode與favicon模組載入 smoke，未發HTTP或執行job。

舊worker確認PID0後重新交接，新PID1512645於UTC06:42:26–06:43:26連續7次、至少60秒均 running、NRestarts0、PID與cwd不變。最終證據：`/home/deck/.t3/projects/blog-observe-tw/.reviews/thaw-candidate/worker-runtime-final.json`；僅此檔可作worker成功依據，先前失敗檔全部保留。`BLOG_TECH_ENABLED=true`，B3/common/history-search仍false；favicon寫入根目錄維持既有 `/home/deck/.local/share/blog-observe/icons`，不寫入不可變release。依賴啟動smoke需納入下次部署前檢查，不再以短暫active判成功。

回滾使用保留的B0-safe blue427：`bash tools/deploy-blue-green.sh rollback blue`。回滾worker時先停止新worker，將本輪新增`40-reviewed-4cc7bcd.conf`的WorkingDirectory改回427、tech=false，且將NODE_PATH改為427相容依賴或清空回到舊解析方式，再daemon-reload/start，絕不雙worker。原20號drop-in保留；新增表／觀測不刪，不做down migration。blue427已在migration後持續服務並完成前測，舊worker也持續運行至交接，不對正式資料加合成寫入smoke test。

隔離18176／18177的fixture已由自己持有且核對startTicks的runner正常結束，僅drop這次隨機測試schema；截圖與review保留。沒有再拷貝release或產生新大型暫存。

## Review處理與剩餘

- Opus5.5確認model與finish stop的前／後部署review存於`.reviews/thaw-candidate/final-switch-opus-retry.json`、`post-switch-opus.json`。第一次截斷不計數。採納同產物、兩端旗標、先補表格／empty／error／真資料圖、限制未驗功能、單worker與真實provenance。
- 後審無立即rollback阻擋；「blue未在新schema跑」是packet未交代造成的推測，前測與舊worker時間證據已補。沒有採納新增正式合成寫入；HSTS證據只涵蓋實測路徑，不冒稱逐一量測所有URL。尾端延遲、queue shutdown、完整UI仍列待辦。
- scoped review ledger沿原logical-node口徑，累計Codex14／Opus5（2.8:1），重讀同一節點、UI作者、截斷不另計；原始索引`.reviews/thaw-candidate/review-ledger.json`。
- 待辦：全文「蛤蜊絲瓜」正式bounded-query與索引驗收；擴大relations coverage、unknown target別名證據；真站CMS三例；B3契約正式接入（維持off）；ledger全部pending與未涵蓋狀態、正式瀏覽器驗收。這份部署不代表上述工作已完成。
