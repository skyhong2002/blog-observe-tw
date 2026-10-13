# 未發布詞庫的有界 proof 檢查

`app/src/topics/staged-proof-inspector.ts` 是離線診斷用的 private reader，預設
disabled。沒有 HTTP route、worker caller、正式話題 reader 或 current pointer
切換接線。這一批不是完整詞庫發布、公開 B0 或 UI 驗收。

每次啟用呼叫須指定 unpublished full generation、完整版本 pins，以及 1–50 個
不重複文章 ID。只回文章 ID、titleFresh／bodyFresh 和固定原因；不回正文、網址、
雜湊、詞彙或身分資訊。未知全域契約整批 blocked；缺少、撤下、拒收、搬家或未來
文章統一 unavailable，不由診斷結果區分隱藏原因。

同一個 pool 最多保留一個 admission，包含尚未完成的連線取得或查詢。A 卡在
barrier 時 B 回 busy 空結果；A 完成後 C 才做自己的 fresh statement，不共享 A
的 promise。這個契約不能當成公開頁面 concurrent B fresh-read 的證據。
取消訊號使用 native AbortSignal／EventTarget intrinsics，不呼叫 caller 覆寫的
getter 或方法；deadline 清理只處理本次持有的連線。

Title freshness 比對捕捉時的 metadata fingerprint、當前公開性與實際資料庫時間。
正文變更或撤下不必撤銷仍有效的標題。Body freshness 另要求當前同篇、同 owner
正文、固定 adapter／版本、來源與大小限制，以及完整的非 NULL body expectations。
Title-only proof 混入 body expectations 視為不合法；full proof 的 body expectation
為 NULL 時，最多只能保留獨立通過的 title freshness，不能稱整份 proof 已驗證。

這仍以 cooperative writer 為前提。Digest 不提供 authentication，任意有資料庫
寫入權的人可以製造相同 tuple 的 proof；writer admission、dirty replay 與 current
CAS 未完成前，不能拿診斷結果授權發布。

SQL 從明確文章 ID 開始，以 PK join 讀取，沒有全 corpus／詞彙／matches 聚合。
每次最多一條 statement（250 ms 上限），manifest 的 generation derived table
必須由實際 EXPLAIN 證明 materialized，不能只憑 LIMIT 1 宣稱成本已控制。
本批 source／mock review 不替代這項實際 SQL 證據。

## 驗證與執行界線

純測試：`npx vitest run app/src/topics/staged-proof-inspector.spec.ts`。
隔離 oracle 的窄入口為 `tools/test-integration.mjs --suite staged-proof-inspector`，
只接受 owned mode-0600 clone env、loopback DB 18169 與新建 disposable schema；
外部 fetch 禁止，結束只移除自己新建的 schema，不接正式資料庫。

**實際 oracle 尚未執行。**執行前必須將 exact 命令、受測 SHA／tree、fresh probe、
估算用量與預期 artifact 交 babysit 核對。GET_LOCK、SQL／EXPLAIN、建置、candidate、
capture 與部署均不能以 source pass 代替這道核對。

目前 public reader、history、carry、frequency、current batch、publisher 都未採用
此檢查器；no-store、隱私條件與 Cloudflare Disabled 狀態不變。
