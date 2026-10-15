# 首頁 overview 間歇失敗診斷（2026-10-15）

基底是 fetch 後的 origin/main `60050f131b2a08eea4417d75cd681fc78a195bd0`。這是後端診斷小修，沒有改 SQL、排序／篇數上限、cache admission八個fresh read、隱私predicate、no-store或公開錯誤格式。前端保持58e551a已建好的同一份artifact／BUILD_ID `Xm1Rp-cc1A9eW-NCT5lnf`，不重新建置。

## 已確認的證據

- 正式 blue gateway 在 UTC00:41:14.111／00:41:17.358／00:41:18.989 三次記 `public overview read failed`，舊欄位只有 `databaseCode=unknown`；web有 `/api/overview?view=home (503)` 的 PublicGatewayError，HTML因此500。**舊紀錄不能回溯這三次唯一的DB錯誤碼或查詢階段**。
- 回填已於前一天UTC22:46:40因首頁200但7.038秒超過6.17秒閘門而自動退出，游標24455，共7筆；00:41沒有正在執行的回填客戶端。保持停止、不自動重試。這不能排除其他共用資源或先前寫入造成的間接影響，但不能稱作「當時回填正在搶DB」。
- UTC00:48:59附近，以pool1、唯讀交易執行現有正式SQL：首頁正文引用 `home.mentions` 約1019ms後中止，MariaDB **errno1969／SQLSTATE70100，driver code未提供**；作者查詢約34ms。server版本11.4.12。這是同一路徑的真實可重現失敗，**不是已取得00:41原始錯誤**。
- mysql2的錯誤字串映射沒有MariaDB1969，原logger只接受ER_*，因而把這類逾時寫成unknown；資料庫仍遵守既有 `max_statement_time=1`，沒有放寬。
- 精簡window projection的小試驗與原查詢三組結果hash相同；暖查詢兩邊約16ms，沒有證據證明穩定的效能收益。因此本批**保留原SQL**，不把第一次逾時與不同暖機條件當效能改善基準。

## 新的受限診斷

每個overview讀取附固定stage（home mentions/authors/totals/recentBlogs/icons；full各projection），失敗記錄：

- `queryStage`、固定 `failureKind`、driver字串 `databaseCode`、數字 `databaseErrno`、`sqlState`。
- `readElapsedMs`：該讀取階段的wall time，含pool等待與該段projection，不是純SQL執行時間。
- `poolState`：失敗捕捉當時的size/free/active/queued/limit，缺值為null，不能從缺欄推論成0。

只分類既有容量拒絕、pool queue/closed、資料庫逾時/鎖/連線等；不新增queue、共享promise、結果快取、重試或更大的容量。**不寫SQL、driver message、cause物件、參數、正文、Cookie/header、DB網址或密鑰**。公開仍只回503 `{"error":"unavailable"}`；Next錯誤頁沒有顯示內部診斷。

原始log/唯讀repro/EXPLAIN/比較/單元測試/審查都在repo外私有 `.reviews/overview-diagnosis/`，部署後收據另外追加。這項是n/a-ui，不把上一版截圖改標新backend SHA，也不宣稱已根治所有間歇失敗。

## 測試與review

27個單元測試（含既有fresh-read/八個容量上限/隱私predicate）、TypeScript、Node24原生載入通過。九段overview SQL的文字與順序比對完全相同，home-feed與TopicResponseCache未改。隔離18169以1ms上限的短SELECT驗證真實mysql2數字1969／70100和pool1快照；這是synthetic driver測試，不拿來當00:41正式故障重現。正式唯讀SQL重現則見前節。

既有非作者Opus5.5 CLI（session6e17，modelUsage實際claude-opus-5-5、success）review無阻擋：採納P2，包裝error不保留原始cause，只存白名單欄位；新增assert連整個wrapped error都不含private SQL。其「失敗時pool可能已釋放」建議以文件說清楚post-failure snapshot採納；不額外增加開始時採樣。production loadOverview呼叫者只有overview route，其他是integration tests，沒有依賴原始error.code的其他production caller。

原始review `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/overview-diagnosis/opus-cli-review.json`；較早API回應finish_reason=length且沒有完整正文，保留但**不計作review通過**。CLI審查後的delta只移除raw cause、改存同樣白名單欄位並補測試，未變更SQL或公開行為。
