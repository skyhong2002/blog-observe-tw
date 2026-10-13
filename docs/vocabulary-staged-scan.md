# 完整詞庫的 generation-local staged scan

這是離線 source 階段的 DAO，不是發布入口。`startStagedScan`／`runStagedScanBatch`
預設不取連線；只有 caller 明確傳入 `enabled: true` 才執行。正式 worker 仍使用原本
15 分鐘的文章窗口，沒有新增 full scan 排程、正式旗標或 current 切換。

## 掃描身份與續跑

`scan-v2` 固定 target snapshot、資料庫 manifest 原文 SHA-256、policy／selection、matcher
與 cleanup version。target 必須是完整來源、single-copy-v1、import 與 policy 都 ready，
而且不得出現在 `topic_current`。每次 target 寫入前都再次核對，不把 ready 當 published。

開始時只讀取索引上的最大文章 ID 作 highWater；之後以 `id > cursor AND id <= highWater`
逐批讀最多 50 筆，包含非公開文章與 ID 缺洞。`asOf` 限定文章刊登時間，NULL 日期仍可
採納；未來文章、非 verified 站、目前站點 URL 不再擁有的文章不得採納。

上游窗口 A → B → C 不會改掉 target 或重置進度。這不放寬原本 `staged-scan-v1` 的
expectedCurrent 契約：未來發布必須另建固定 predecessor 的 cutover intent，再做 CAS。
目前沒有 cutover intent、dirty event replay 或發布 SQL。

`asOf` 不是同一個交易的資料庫快照。每篇採用先讀取、計算，再於寫入交易 fresh read 的
語意；既有不同 writer 的鎖順序仍可能造成 deadlock，這時延後，不跳過游標。

## 正文與公開邊界

每篇核對目前 blog URL、狀態、文章 owner／URL／刊登日與內容修訂。正文須有相同文章
canonical identity、blog ID、目前 publication 的來源與已存 adapter version。tracking
參數可正規化，但有意義的 query ID 保留；不靠筆名、平台根網域或未證實的外站 API
認定歸屬。支援同 publication 的 RSS／Atom 與受限 WordPress REST provenance，未證實
來源只列入 title-only／缺正文計數，不推定為全文，也沒有逐站詳細原因碼的承諾。

SQL 在傳回正文前檢查 text 500,000 bytes／HTML 2,000,000 bytes；截斷、圖片文或過大的
正文分開列 capped。沒有可證實全文的文章可以 title-only，零命中仍建立目標版本的索引
紀錄；capped／fresh read 不一致不寫入部分命中。target matches、indexes、run cursor
在同一個交易提交。公開讀者仍依 current／published 版本，不讀取這份 ready target。

**Reader 相容性還未完成**：title-only 的 `body_hash = NULL` 可能與既有 reader 的
content／relations body fallback hash 不同。未補這項契約與測試之前，不得宣稱完整
warmup、歷史話題補齊或可切換。

## 資源與故障處理

同 pool 最多一個 admission；已知 poolSize 至少 2。DAO 在同一條連線取得既有 topics
named lock、載入有界活躍詞與完成 SQL，避免持有最後一條連線又向 pool 取連線的自鎖。
活躍 matcher 的既有 96 MiB 預算估算仍適用，尚未做完整池的實際 RSS 量測。

連線 acquisition、named lock、SQL 與交易共用一個 deadline；未取消得了的 pending
acquisition 保留 admission 到 late connection 釋放完畢。只清理自己取得的連線，不能
因為這份 fixture 去終止其他服務。回傳固定原因碼，不帶 SQL、正文、URL 或密鑰。

commit 的結果不明時不代表「確定沒有提交」。caller 要重新讀取已保存 run cursor，
再以 expectedCursor 繼續；不能把未知結果當作可以任意重播原批次的證據。

## 仍然禁止發布

所有報告永久 `canVerify: false`；`scanned-as-of` 只表示已掃描這個 ID 邊界，不表示
掃描期間的修改、刪除、新文章、站點狀態或 body 更新已經全部追平。正式發布仍欠：

- 同交易 dirty events／修訂水位與重播，涵蓋所有實際 writer；
- 固定 predecessor 的 cutover intent、鎖與原子 current CAS；
- title-only／正文來源的 reader 相容性、公開 freshness 與 SEO 證據回歸；
- 完整 473 萬詞的容量、保留期、實際 wire 與耗時驗證。

0025 是 additive source migration，目前不套用正式資料庫。小型 SQL 測試只使用既有
18169 隔離服務建立 disposable schema，不代表正式資料驗收或 Mint 建置許可。
