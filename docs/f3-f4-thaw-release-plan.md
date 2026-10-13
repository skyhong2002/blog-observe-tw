# F3／F4 解凍後驗收與回滾計畫

本文件是待執行計畫，不是部署紀錄。基底為 fetch 後的 `origin/main` `6f47dda`；開發直接在既有 main 選擇性整合，沒有建立工作樹、staging 或 build。凍結解除只能以使用者端明確通知為準；磁碟空間恢復本身不代表解除。

## 凍結期間完成的工作與限制

- F4 重用 detector、既有爬蟲回應的被動 hook、版本化證據儲存與公開 API；收集／公開雙旗標預設關閉。不存在的觀測不能用 Alina、Carol、timdream 合成 fixture 補成真站結果。
- F3 修正既有正文搜尋的歷史召回、正文與非正文證據，以及由已驗證轉址／所有權資料解析 alias；不把名稱相近當搬家，不把共同標籤或文字相似叫作交流。
- 只用既有 18169 隔離資料庫建立小型可丟棄 fixture schema、mock 和原始碼審查。不啟新 DB 容器、不觸及正式 DB、不對正式站 probe。測試所建 fixture 的清理只限該隨機隔離 schema；不刪既有檔案、release、回滾版本、備份或資料庫。
- F1 僅以可核對的 tag 候選 OpenAPI 版本建立離線契約，不據此宣稱正式端點已上線。未取得資料版本的欄位保持未知。
- no-store、公開 verified／文章日期與來源所有權 predicate、HSTS、DNT／GA guard 保持；Cloudflare 兩條規則維持 Disabled。

## 唯一一次候選建置前

1. 收到明確解凍通知，確認備份作業已安全收尾；重新檢查 /home 至少 10 GiB，估算安裝、build 與保留兩 slot 的增加量後仍滿足門檻。不能自行清理任何候選。
2. `git fetch origin`，記錄乾淨 source SHA/tree、已審檔案 hashes、測試結果。確認本批所有 source review findings 已採納或有明確未啟用的界線；不以測試成功取代 UI review。
3. 全站只容許一個建置，先與既有程序核對；當時負載不宜超過既定閘門。沿用 `tools/deploy-blue-green.sh` 準備 inactive slot，active slot 全程保留。
4. migration 0020 僅新增 blog_tech_scans；沒有 DROP、改寫旧欄位或刪資料。原版程式可忽略新增表。此類 additive migration 不另產生完整備份；沿用既存備份，任何未來破壞性變更須另依授權、容量與串流壓縮規則處理。
5. 先在隔離 schema 驗證 0020，正式 apply 前再次查核精確 SQL。worker 仍只有一份，不複製開第二個；收集旗標在正式資料驗收前保持 false。

## 候選畫面與隱私驗收

同一 SHA／BUILD_ID 只建置一次，記錄 source tree。候選 gateway／web 成對，API／SSR rewrites 必須指向同slot。以候選環境旗標驗 F4 on/off（公開開啟仍不啟動外網抓取）。所有畫面需要独立 Opus 5.5 或 GPT-6.1 Sol reviewer，作者不能審自己；至少 1280／390、深色、多筆／少筆／空／失敗／權限與旗標關閉的適用狀態。截圖沿用 ledger；凍結期間一律「待重拍」。

解凍後 capture 仍須守全站最多兩個 browser、每頁間隔、load≤12、正式 TTFB≤2秒；優先 candidate。啟動前 DNT=1 並阻擋 GA/GTM，確認零外送，不送合成 GA。

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
