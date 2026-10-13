# F3／F4 解凍後驗收與回滾計畫

本文件是待執行計畫，不是部署紀錄。基底為 fetch 後的 `origin/main` `6f47dda`；開發直接在既有 main 選擇性整合，沒有建立工作樹、staging 或 build。使用者已於 2026-10-13 明確解凍，以下門檻以當日 2 小時衝刺指示為準；磁碟空間恢復本身不代表解除。

## 凍結期間完成的工作與限制

- F4 重用 detector、既有爬蟲回應的被動 hook、版本化證據儲存與公開 API；收集／公開雙旗標預設關閉。不存在的觀測不能用 Alina、Carol、timdream 合成 fixture 補成真站結果。
- F3 修正既有正文搜尋的歷史召回、正文與非正文證據，以及由已驗證轉址／所有權資料解析 alias；不把名稱相近當搬家，不把共同標籤或文字相似叫作交流。
- 只用既有 18169 隔離資料庫建立小型可丟棄 fixture schema、mock 和原始碼審查。不啟新 DB 容器、不觸及正式 DB、不對正式站 probe。測試所建 fixture 的清理只限該隨機隔離 schema；不刪既有檔案、release、回滾版本、備份或資料庫。
- F1 僅以可核對的 tag 候選 OpenAPI 版本建立離線契約，不據此宣稱正式端點已上線。未取得資料版本的欄位保持未知。
- no-store、公開 verified／文章日期與來源所有權 predicate、HSTS、DNT／GA guard 保持；Cloudflare 兩條規則維持 Disabled。

## 唯一一次候選建置前

1. 使用者已授權在備份仍執行時建置；不得接觸備份程序。開始前 /home 至少 40 GiB，監控降至 30 GiB 以下只暫停自己的程序群組。估算 build 2 GiB、不可變 release 1 GiB；截圖每批最多 4 張、50 MiB。既有 release、rollback、備份與 worktree 一律保留。
2. `git fetch origin`，記錄乾淨 source SHA/tree、已審檔案 hashes、測試結果。確認本批所有 source review findings 已採納或有明確未啟用的界線；不以測試成功取代 UI review。
3. 本機 tag/blog 合計最多兩個建置；nice 19、ionice c3、Next worker ≤2。load1 >12、任一首頁 5xx、blog 整頁 >6 秒或 tag/YT >2 秒即暫停自己的建置與 capture。以 guarded-build 的啟動握手、主機 quota 與 PGID 所有權檢查監控。只用 prepare-built 部署同一份已審產物，active slot 全程保留。
4. migration 0020 僅新增 blog_tech_scans；沒有 DROP、改寫旧欄位或刪資料。原版程式可忽略新增表。此類 additive migration 不另產生完整備份；沿用既存備份，任何未來破壞性變更須另依授權、容量與串流壓縮規則處理。
5. 先在隔離 schema 驗證 0020，正式 apply 前再次查核精確 SQL。worker 仍只有一份，不複製開第二個；收集旗標在正式資料驗收前保持 false。

## 候選畫面與隱私驗收

同一 SHA／BUILD_ID 只建置一次，記錄 source tree。候選 gateway／web 成對，API／SSR rewrites 必須指向同slot。以候選環境旗標驗 F4 on/off（公開開啟仍不啟動外網抓取）。所有畫面需要独立 Opus 5.5 或 GPT-6.1 Sol reviewer，作者不能審自己；至少 1280／390、深色、多筆／少筆／空／失敗／權限與旗標關閉的適用狀態。截圖沿用 ledger；凍結期間一律「待重拍」。

解凍後 capture 仍須守全站最多兩個 browser、每頁間隔、load≤12、blog 整頁≤6秒、tag/YT 整頁≤2秒；優先 candidate。啟動前 DNT=1 並阻擋 GA/GTM，確認零外送，不送合成 GA。

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

- 0021 僅新增 `topic_shared_label_snapshots`，0022 僅新增 `shared_label_sync_control`；均 additive，舊程式可忽略。不建立新完整備份、不執行 down migration。正式套用前重新核對 SQL；目前只套用於既有 18169 的隨機 fixture schema。
- `BLOG_SHARED_LABEL_SYNC_ENABLED` 與 `BLOG_SHARED_LABELS_PUBLIC_ENABLED` 預設 false，分別控制手動背景同步與話題頁本地資料呈現。沒有新增排程；不得在頁面請求時呼叫上游。
- `tools/shared-label-sync.ts --selection <json>` 預設 dry-run（不開 DB／HTTP）；最多 10 個精確標籤。解凍後、契約與真實上游確認後才允許加 `--apply`，且同步旗標必須精確為 true。來源必須有目前公開 blog 文章的話題證據，上游詞庫或選單檔本身不授權建立頁面。
- 背景工作預設 UTC 每日 40 次 wire request、單批 30 秒、跨程序 DB lease；每一次 fallback／retry 都計預算。任何 429 立即停止整批，Retry-After 存於資料庫，下個程序仍遵守。全部保持既有 local/public 間隔與 token 使用範圍。
- 快照 24 小時有效期只代表上游補充資料時效，**不是公開頁快取 TTL**；公開父話題仍 fresh read、no-store。讀取時再驗契約、精確標籤與期限，metadata 出錯只影響該區塊；失敗更新清除前次 ready 資料。契約 SHA 不是資料版本，後者目前 unknown。
- 解凍後 B3 候選畫面要驗：關閉／缺欄位、ready／missing／unavailable、關係與圖示局部失敗、24 筆截斷、授權缺值、歷史文章優先。代表圖片由瀏覽器 lazy 向 tag 載入；SSR 不另讀上游 JSON，不宣稱瀏覽器零圖片請求。
- 回滾先關上述雙旗標，再依既有 B0-safe slot 流程切換；保留表、冷卻紀錄與資料，不能為避開預算重設 cooldown。尚未建置，沒有本批 BUILD_ID 或正式切換 UTC。

若 B3 同步因 store／lease 失敗退出，不得自動重跑；尤其冷卻寫入失敗時，先確認上次 Retry-After 與儲存狀態，再安排下一批。解凍後也不可因 source tests 已通過就逕行新增 timer。

## 同產物交付紀錄

候選由重新 fetch 的 origin/main 建置一次。`record-built` 保存 SHA、BUILD_ID 與 primary server/static 與完整 standalone（含 manifests／traced dependencies）、release 根 node_modules 雜湊及 edge 外部 receipt 摘要；`prepare-built` 與切換前再次驗證。這是位元組一致性證據，不是建置執行者的簽章。建置可借用既有依賴，release 的 runtime 依賴必須複製並固定，不能依賴其他工作樹的可變 symlink。候選透過 isolated gateway 18176 存取 Next 18177，避免直接打 Next 時走向編譯時 green gateway 18175；正式 green 為 gateway 18175 / web 18173。公開 B3 雙旗標維持 false。
