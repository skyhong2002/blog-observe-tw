# F3／F4 解凍後驗收與回滾計畫

前半為原始執行計畫；目前執行證據見末節，正式切換以獨立部署 receipt 為準。基底為 fetch 後的 `origin/main` `6f47dda`；開發直接在既有 main 選擇性整合，沒有建立工作樹、staging 或 build。使用者已於 2026-10-13 明確解凍，衝刺期限已取消；以下門檻依最新使用者明確授權與 baseline 為準；磁碟空間恢復本身不代表解除。

## 凍結期間完成的工作與限制

- F4 重用 detector、既有爬蟲回應的被動 hook、版本化證據儲存與公開 API；收集／公開雙旗標預設關閉。不存在的觀測不能用 Alina、Carol、timdream 合成 fixture 補成真站結果。
- F3 修正既有正文搜尋的歷史召回、正文與非正文證據，以及由已驗證轉址／所有權資料解析 alias；不把名稱相近當搬家，不把共同標籤或文字相似叫作交流。
- 只用既有 18169 隔離資料庫建立小型可丟棄 fixture schema、mock 和原始碼審查。不啟新 DB 容器、不觸及正式 DB、不對正式站 probe。測試所建 fixture 的清理只限該隨機隔離 schema；不刪既有檔案、release、回滾版本、備份或資料庫。
- F1 僅以可核對的 tag 候選 OpenAPI 版本建立離線契約，不據此宣稱正式端點已上線。未取得資料版本的欄位保持未知。
- no-store、公開 verified／文章日期與來源所有權 predicate、HSTS、DNT／GA guard 保持；Cloudflare 兩條規則維持 Disabled。

## 唯一一次候選建置前

1. 使用者已授權在備份仍執行時建置；不得接觸備份程序。開始前 /home 至少 40 GiB，監控降至 30 GiB 以下只暫停自己的程序群組。估算 build 2 GiB、不可變 release 1 GiB；截圖每批最多 4 張、50 MiB。既有 release、rollback、備份與 worktree 一律保留。
2. `git fetch origin`，記錄乾淨 source SHA/tree、已審檔案 hashes、測試結果。確認本批所有 source review findings 已採納或有明確未啟用的界線；不以測試成功取代 UI review。
3. 全站（含遠端 YouTube）合計最多一個建置；nice 19、ionice c3、Next worker ≤2。load1 >12、任一首頁 5xx、blog 整頁 >6.17 秒或 tag/YT >2 秒即暫停自己的建置與 capture。以 guarded-build 的啟動握手、主機 quota 與 PGID 所有權檢查監控。只用 prepare-built 部署同一份已審產物，active slot 全程保留。
4. migration 0020 僅新增 blog_tech_scans；沒有 DROP、改寫旧欄位或刪資料。原版程式可忽略新增表。此類 additive migration 不另產生完整備份；沿用既存備份，任何未來破壞性變更須另依授權、容量與串流壓縮規則處理。
5. 先在隔離 schema 驗證 0020，正式 apply 前再次查核精確 SQL。worker 仍只有一份，不複製開第二個；收集旗標在正式資料驗收前保持 false。

## 候選畫面與隱私驗收

同一 SHA／BUILD_ID 只建置一次，記錄 source tree。候選 gateway／web 成對，API／SSR rewrites 必須指向同slot。以候選環境旗標驗 F4 on/off（公開開啟仍不啟動外網抓取）。所有畫面需要独立 Opus 5.5 或 GPT-6.1 Sol reviewer，作者不能審自己；至少 1280／390、深色、多筆／少筆／空／失敗／權限與旗標關閉的適用狀態。截圖沿用 ledger；凍結期間一律「待重拍」。

解凍後 capture 仍須守全站最多兩個 browser、每頁間隔、load≤12、blog 整頁≤6.17秒、tag/YT 整頁≤2秒；優先 candidate。啟動前 DNT=1 並阻擋 GA/GTM，確認零外送，不送合成 GA。

- `/tech/`：分母與五種狀態總和、截斷、技術篩選、cursor、單行固定表頭／第一欄、CMS 與 CDN 分組、unknown 版本、最後嘗試和上次成功不得混淆。
- `/blogs/<slug>/`：optional 技術失敗不拖垮主頁；直接引用每方向保留文章日期及上下文，blogroll／側欄分開；共同標籤不是交流，無文字相似資料不能假稱零相似。
- `/articles/?q=…`：蛤蜊絲瓜正式文章需回到 anise.tw/290726，附短片段／articleId／matchVersion；小 fixture 通過不證明正式掃描成本。歷史正文查詢旗標不得在此實測前啟用。
- 隔離 B0：撤下 source 或 target／文章、future、moved、rejected 後下一個新匿名 HTML/API/RSC/Next-data/sitemap 請求立即看不到。不得恢復快取；不得以 sleep／TTL 或重試湊通過。
- Alina／Carol／timdream：解凍後只重用正常既有抓取取得的 HTML／headers，保存真實來源時間與hash；沒有版本證據顯示 unknown。不得為填 coverage 額外掃描全站。

## 切換與回滾

候選完成以上測試和逐頁 review 才可 switch。切換保留前一個已通過 B0 的 slot，記錄 active.json、generation、UTC、SHA、BUILD_ID；確認新 gateway/web healthy 後才改 edge 指向，不停 active 再建新站。

切換後低頻驗證 blog HTML、healthz、OAuth S256/callback、HSTS、no-store 和 CF DYNAMIC/BYPASS，tag/youtube仍200。不要改CF/WAF。這些是解凍後授權的驗收，不在凍結期執行。

發生功能或資源問題，先將 `BLOG_TECH_ENABLED`／`BLOG_TECH_PUBLIC_ENABLED`／`BLOG_SEARCH_HISTORICAL_BODY_ENABLED`／`BLOG_SHARED_TAGS_ENABLED` 設 false；新 UI 的功能入口不得殘留。必要時重新檢查前一 B0-safe slot 健康後走既有 rollback，保留新增表與觀測，不執行 down migration，不恢復到 f6bd919 等有舊隱私漏洞的版本，不刪任何 release／artifact。停止觀測不代表刪除已存證據，公開層仍即時檢查隱私。

已下載的靜態資產或使用者自行保存的內容不在撤回範圍。任何快取恢復必須另交 origin、Next、CF 三層失效證據並取得既有流程的同意。

## B3 後續批次（原始基底 104da1f；公開與同步旗標保持關閉）

- 0021 僅新增 `topic_shared_label_snapshots`，0022 僅新增 `shared_label_sync_control`；均 additive，舊程式可忽略。不建立新完整備份、不執行 down migration。正式套用前重新核對 SQL；隔離驗證後，正式於 UTC 2026-10-13T05:55:58 套用，詳見末節的 migration receipt。
- `BLOG_SHARED_LABEL_SYNC_ENABLED` 與 `BLOG_SHARED_LABELS_PUBLIC_ENABLED` 預設 false，分別控制手動背景同步與話題頁本地資料呈現。沒有新增排程；不得在頁面請求時呼叫上游。
- `tools/shared-label-sync.ts --selection <json>` 預設 dry-run（不開 DB／HTTP）；最多 10 個精確標籤。解凍後、契約與真實上游確認後才允許加 `--apply`，且同步旗標必須精確為 true。來源必須有目前公開 blog 文章的話題證據，上游詞庫或選單檔本身不授權建立頁面。
- 背景工作預設 UTC 每日 40 次 wire request、單批 30 秒、跨程序 DB lease；每一次 fallback／retry 都計預算。任何 429 立即停止整批，Retry-After 存於資料庫，下個程序仍遵守。全部保持既有 local/public 間隔與 token 使用範圍。
- 快照 24 小時有效期只代表上游補充資料時效，**不是公開頁快取 TTL**；公開父話題仍 fresh read、no-store。讀取時再驗契約、精確標籤與期限，metadata 出錯只影響該區塊；失敗更新清除前次 ready 資料。契約 SHA 不是資料版本，後者目前 unknown。
- 解凍後 B3 候選畫面要驗：關閉／缺欄位、ready／missing／unavailable、關係與圖示局部失敗、24 筆截斷、授權缺值、歷史文章優先。代表圖片由瀏覽器 lazy 向 tag 載入；SSR 不另讀上游 JSON，不宣稱瀏覽器零圖片請求。
- 回滾先關上述雙旗標，再依既有 B0-safe slot 流程切換；保留表、冷卻紀錄與資料，不能為避開預算重設 cooldown。已包含在 4cc7bcd 的同一份 build，但 B3 雙旗標維持 false；不據此宣稱功能已上線。

若 B3 同步因 store／lease 失敗退出，不得自動重跑；尤其冷卻寫入失敗時，先確認上次 Retry-After 與儲存狀態，再安排下一批。解凍後也不可因 source tests 已通過就逕行新增 timer。

## 同產物交付紀錄

候選由重新 fetch 的 origin/main 建置一次。`record-built` 保存 SHA、BUILD_ID 與 primary server/static 與完整 standalone（含 manifests／traced dependencies）、release 根 node_modules 雜湊及 edge 外部 receipt 摘要；`prepare-built` 與切換前再次驗證。這是位元組一致性證據，不是建置執行者的簽章。建置可借用既有依賴，release 的 runtime 依賴必須複製並固定，不能依賴其他工作樹的可變 symlink。候選透過 isolated gateway 18176 存取 Next 18177，避免直接打 Next 時走向編譯時 green gateway 18175；正式 green 為 gateway 18175 / web 18173。公開 B3 雙旗標維持 false。

## 2026-10-13 候選 4cc7bcd（已於UTC06:28切換）

- Fetch 基底／release：`4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8`；tree `de1ca738a2e351895b4f354908142351e917b6f7`；BUILD_ID `2ZIfs00KopZi_HHl8ahLU`。一次建置，後續僅使用同產物。
- 該 build 的 53 個 barrier 案例與 60 個 SSR/RSC sequence 已通過。完整證據：`/home/deck/.t3/projects/blog-observe-tw/.reviews/thaw-candidate/4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8/privacy/barrier-result.json` 與同目錄 `sequence-result.json`。不以 sleep、retry、TTL 通過；不代表所有 UI 狀態通過。
- UI 四種寬色狀態的 capture／獨立 review 存於 `/home/deck/.t3/userdata/blog-sprint-4cc7bcd/`；未驗證狀態仍待補。GA/GTM 在網路層阻擋，不進行收件驗證。
- 正式全文搜尋測試尚未通過，因此 `BLOG_SEARCH_HISTORICAL_BODY_ENABLED=false`；B3 的 `BLOG_SHARED_LABEL_SYNC_ENABLED`／`BLOG_SHARED_LABELS_PUBLIC_ENABLED` 與未驗共同標籤仍 false。不能把「蛤蜊絲瓜」已存在資料庫當作搜尋驗收成功。
- 0020／0021／0022 僅新增表與索引，沿用既有完整 gzip 備份。MariaDB DDL 不隨交易 rollback；若中途失敗，立即停止並查表／索引／migration ledger，不盲目重跑。舊 42711cf 可忽略新表，回滾不 DROP。
- 技術回填只讀既有 HTML，10 站一批、逐批 gate；缺少 head／header 的正文片段不能推出 CMS 版本。寫入數以 `written` 為準，不把 dry-run 的 detected 數當成正式觀測。

### 已核定首頁 baseline

UTC `2026-10-13T05:47:30Z–05:48:30Z`，本機經 Cloudflare，curl `DNT: 1`、`Accept: text/html`、每站 5 次間隔 3 秒，只下載完整 HTML，取 `time_total` 中位數。來源 `/tmp/babysit/gate-baseline-receipt.md`，原始值 `/tmp/babysit/baseline-raw-0547.txt`。

|站|中位數|門檻 max(2s, 2×baseline)|baseline 快取|
|---|---:|---:|---|
|blog|3.085s|6.17s|DYNAMIC／no-store|
|tag|0.256s|2s|HIT|
|YouTube|0.289s|2s|HIT／EXPIRED|

Guard 共用 `tools/homepage-gate-baseline.mjs`，新 receipt 含時間、方法、三站 baseline。舊 receipt 保留原樣，不回填歷史數字。這是完整 HTML 回應時間，不是 TTFB 或瀏覽器所有資源的 load。其他門檻仍是全站 1 個 build／2 個 capture browser、load≤12、40→30 GiB、任一 5xx 停止新的 build/capture。

blog 的 DYNAMIC `time_total=3.085s` 包含來源站渲染、Cloudflare edge 與網路，不等於精確的來源站渲染時間。正式與本機 candidate 的差異也不能直接解讀為 SQL 改善比例。


### 本批具體證據（公開切換前）

- Migration 實際紀錄：`/home/deck/.t3/projects/blog-observe-tw/.reviews/thaw-candidate/migration-receipt.json`，0020–0022 UTC05:55:58 完成；既有 gzip 備份早於變更。只驗 metadata，沒有宣稱此次做了備份還原測試。
- 被動回填：`/home/deck/.t3/projects/blog-observe-tw/.reviews/thaw-candidate/tech-backfill-final.json`，UTC06:19:50，313 個公開站，260 unknown、53 not-observed，detected／failed／blocked 各0。不把缺 head 的正文片段推測成 CMS；Alina／Carol／timdream 的真站版本驗收仍 pending。fixture 的 WordPress 7.1.3 是合成輸入，不是 timdream 真站證據。
- 本批第二次公開量測（切換前）：`/home/deck/.t3/projects/blog-observe-tw/.reviews/thaw-candidate/formal-before-1791872806846.json`，UTC06:25:24–06:26:46，blue427，blog 五次 median3.978237s，tag0.267657s，YT0.196875s。這次量測不更換核定 baseline／門檻。
- 最終 Opus 安全部署 review：`/home/deck/.t3/projects/blog-observe-tw/.reviews/thaw-candidate/final-switch-opus-retry.json`，回應 model `claude-opus-5-5`、finish_reason stop；第一次截斷輸出保留但不算完成 review。採納：B3／共同標籤／歷史搜尋關閉、核對備份先後、兩端旗標、同產物、單 worker、補橫捲／empty／error／真資料圖片。先前「tech NO-GO」原因必須以後續實際圖片 review 補證，不把配置檔當 pass。
- 回滾限 blue427（已有隱私修正），保留所有表與資料；正式異常先判斷是否由本批造成，再以既有工具回滾。Opus 建議把其他站的瞬時 load／latency 一律當 blog rollback 觸發，未直接採用：它是全站啟動／capture 的閘門，不能證明 blog 回滾會改善別站；本批的5xx、隱私或功能回歸則直接停止並回滾。

完整正式切換、兩輪worker交接（含sharp解析失敗與同產物NODE_PATH補正）、正式量測與待辦，見 [4cc7bcd 部署紀錄](deployment-2026-10-13-4cc7bcd.md)。
