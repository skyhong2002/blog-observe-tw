# 凍結期間 F3／F4／B3 原始碼交付

基底：先 fetch 的 `origin/main`＝`6f47dda9204656a7d291bbdb699dd7560b9a0b88`。此輪未建新工作樹、staging、build、image、capture、正式 probe、publisher 抓取或資料匯出；未刪檔、未碰備份、未部署。現有正式狀態僅引用上輪紀錄，不能把它當本輪即時查核。

## Commits

| commit | 範圍 |
|---|---|
| `1fe9ec8` | F4 被動 observer、儲存、公開統計／單站 API、additive migration 0020、資源／隱私 guard |
| `d914dc0` | B3 tag OpenAPI 離線 relations/visual parser、12 mock tests |
| `1ed9b97` | F3 exact URL 身分界線、版本化 body/non-body 證據、原始共同標籤、搜尋與 SQL fixtures、fresh-read 測試 |
| `ffe63cd` | B3 依賴注入 client、原 transport 安全重用與 Retry-After／UTF-8；未接頁面或 worker |
| `3578025` | Opus F4／F3 UI、導航、單一方法展開區、typed payload／舊 DTO 相容、SSR tests |

## 最終驗證

- Backend Vitest：**883／883**，86 files；`.reviews/f3-f4-isolated/backend-final.log`。早期舊 single-flight 的兩項失敗 log 保留，未移除 fresh-read／容量／隱私要求。
- Web node tests：**189／189**；`.reviews/f3-offline-ui/final-web-tests.log`。
- React SSR：**92／92**，3 files；`.reviews/f3-offline-ui/final-render-tests.log`。涵蓋畸形 200 真正經 readPublic／contract 轉局部 error，不只 mock 一個錯誤。
- App／web TypeScript noEmit 通過；web 使用 incremental=false。Biome 檢查新增／修改 source 通過（最後两檔僅 formatter 改動）；git diff whitespace 檢查通過。
- 既有隔離 MariaDB 18169：20 migrations、六組 **172 checks**（search15/profile15/shared-tags14/tech34+82+12）。隨機 fixture schema，未使用正式 DB；`.reviews/f3-f4-isolated/boundary-fixes-sql.log`。
- 全程無 Next build，所以 **沒有 BUILD_ID**；以上不算 B0 最終 build、RSC、正式效能或視覺验收。

## 獨立審查

前端作者 log：`.reviews/f4-offline-ui/opus.jsonl`，`.reviews/f3-offline-ui/{opus,revision-opus,final-opus}.jsonl`，均核對 actual model `claude-opus-5-5`、result success。前端由另一個 GPT-6.1 Sol instance 獨立 source review。

獨立 review 原始 log 的 model receipt／UTC／calls 位置見 `.reviews/b0-f4/{f4-independent-source-review,f3-independent-ui-source-review,f3-shared-tags-profile-independent-review,b3-client-independent-review}.md`，及 `.reviews/f3-f4-independent/codex-alias-evidence-review.json`。F4 resource 與 B3 transport 另有 Opus review，model、stop 均核驗；初次截斷 packet 不计有效 review。

本批按功能節點計 **Codex 6／Opus 2＝3:1**；同節點修訂複查不重複計數，Opus 前端作者不冒充 review。`.reviews/f3-f4-independent/batch-review-ledger.json` 保留明細。

採納的主要發現：連線取得容量、poison connection、Gamer exact alias 擴權、證據 SQL 時限和截斷邊界、畸形 DTO 的局部錯誤隔離、舊 DTO 欄位相容、重複方法區、上游 schema invalid 的 unavailable 分類。沒有擱置 blocker。完全相同 URL／anchor／context 的顯示去重保留；它不增加文章統計，與保存不同證據的要求一致。client 的跨實例 budget 尚未整合，明確未接正式 caller。

## 未完成與解凍後驗收

- ledger 24項：pass0／fixed3／issues8／pending11／n/a-ui2。新source不是畫面pass；詳見 `docs/ui-review-ledger.md` 的待重拍表。
- 真站技術輸入／coverage、Alina/Carol/timdream版本證據、gogojp↔gojp別名入庫、蛤蜊絲瓜正式召回／成本仍待解凍；不把fixture當正式資料。
- B3 client 是已審的接線點，尚未安排共享背景同步／持久化／話題頁呈現。person/avatar parser與正式payload版本仍缺；不能宣稱共用標籤整合已上線。
- 按 `docs/f3-f4-thaw-release-plan.md` 解凍後先一次候選建置，取得 SHA/tree/BUILD_ID、逐頁独立視覺review與完整匿名隱私驗收後才藍綠切換。不得因磁碟數字回升自行解除凍結。


## 接續 104da1f 的離線批次（2026-10-13）

本節取代上節「B3 尚未接入」的 source 進度；不改變尚未部署的結論。本輪開始已 fetch origin，基底 `104da1f69f7aa635997e23bbc183773c3d93ee3d`，沒有建立工作樹。

- F3 `c2ff861`：指定網址用於**合成**雙向引用與歷史全文召回 fixture；各方向文章／日期分開、同篇同 target 只計一次、blogroll 另列，作者 `luckbear` 與站名 `愛吃鬼芸芸` 分欄核對。沒有據此寫入正式 gojp 搬家關係，或宣稱正式 anise 正文已抓取。搜尋目前是受限的歷史正文 LIKE 召回，不是新建 FULLTEXT index。
- B3：shared-label client 已接本地快照背景 producer，話題頁只读本地可公開父話題的補充資料。sync/public 雙旗標預設關閉；沒有新 worker schedule。頁面將上位分類、相關詞與別名分開，不把上游 metadata 當 blog 文章證據或建立空頁。圖片只有來源確實提供才顯示；授權缺值保留 unknown。
- 0021、0022 additive migrations 在 18169 fixture 驗證，**未寫入正式 DB**。資料失敗清除、24h snapshot expiry、跨程序冷卻與 UTC wire 預算都有測試；頁面 no-store／B0 privacy 不變。
- Source review 不等於畫面 review。ledger 仍 24 項：pass 0／fixed 3／issues 8／pending 11／n/a-ui 2；B3 已列入 topic 的待重拍狀態。首批 120 張估算保留 160 MiB、全站 360 張保留 384 MiB（含首批），不含 build／release／DB。現階段完全不新增 capture。

本輪 raw evidence 都在 `.reviews/b3-topic-wiring/`，獨立 Sol review 位於 `.reviews/b0-f4/b3-{enrichment-selection,topic-ui,backend}-independent-review.md`，含來源雜湊、model receipt／UTC與原始log路徑。Opus 前端作者 log 是 `ui-opus.jsonl`，修訂分開保存；作者不作為自己UI的獨立 reviewer。


### 接續批次的實測紀錄

- F3／F4 既有 SQL 組合：6 suites、186 checks、22 migrations；`.reviews/b3-topic-wiring/f3-f4-sql.log`。較前批多出雙向日期與實際回應欄位檢查，沒有拿掉原來隱私／容量測試。
- B3 SQL：2 suites、33 checks；`b3-sql.log`。全部是 18169 隨機 fixture schema；沒有 publisher HTTP 或正式 schema 改動。
- B3 focused Vitest：6 files、60 tests；`b3-unit.log`。F3 evidence＋B3 enrichment 另 25 tests，`enrichment-f3-unit.log`（含重疊，不合併虛增總數）。
- 前端 helper：13 tests，`web-unit-fixed.log`；全組 React SSR：4 files、106 tests，`web-ssr-final.log`。App／web noEmit：`app-types-final.log`、`web-types-final.log`，incremental=false。
- CLI dry-run／disabled apply 都回 networkRequests=0、applied=false；`cli-dry-run.log`、`cli-disabled.log`。沒有執行 enabled apply。
- Biome 21 檔檢查無 error，保留一個經獨立 reviewer 評估的原生 img warning（固定尺寸、lazy、限制 upstream 圖片路徑，避免 optimizer 額外回源）；`biome-final.log`。git diff whitespace 檢查通過。
- 初次 SSR 3 個失敗、web typecheck 失敗紀錄均保留；分別修正了把整頁原有詞庫連結誤當新 B3 行為的斷言，以及聯集型別縮窄。沒有移除 off／錯誤隔離要求。


### B3 獨立審查處置

Opus CLI review `backend-opus-cli.jsonl` 已確認 actual `claude-opus-5-5`、success／end_turn；兩次 API 回應截斷的 stderr 原樣保留，未計為有效 review。按功能節點累計 **Codex 9／Opus 3＝3:1**，修訂複查不重複算；本輪台帳 `.reviews/b3-topic-wiring/review-ledger.json`。

採納：特殊網址解析、圖片請求說明、proper union narrowing、producer deadline 前停止剩餘 kind、CLI store／lease 失敗非零退出。保留兩個 store admission slot：超出時只讓 optional metadata 不可用，避免同機資源負載；這是每個 wrapper/pool 的上限，不是假稱全站僅兩連線。精確標籤是既有上游 ID 契約，不能自行模糊合併；真實 `topic_pages.label`／detail label 對應需在解凍啟用前核對。

冷卻資料若寫入失敗，本批立即停止、CLI 非零；**無法保證該次 Retry-After 已持久化**。目前沒有自動排程、雙旗標預設關閉；操作者不得在 store failure 後自動重跑，須先確認儲存恢復及冷卻狀態。未新增獨立檔案鎖或自行繞過預算。24h snapshot expiry 不是公開頁快取。


### 最終 source revisions

- `c2ff861`：F3 指定案例的離線回歸。
- `ee81c9d`：Opus 話題頁 shared-label 呈現，獨立 Sol 複審。
- `3bfc5f6`：本地快照／sync／頁面接線、0021–0022、deadline 與 exit status 修正；Sol＋Opus 獨立審查。
- 最後完整 Backend Vitest **89 files／913 tests 全數通過**，`backend-final.log`；最後 app／web noEmit 通過，`app-types-reviewed.log`／`web-types-reviewed.log`。Web node **202／202**（`web-node-final.log`）、React SSR 106、SQL 186＋33 亦通過。

這些是 source commits，**未部署、未建置、未啟用旗標**，不存在新正式 UTC 或 BUILD_ID。正式 coverage 與逐頁 candidate 畫面依凍結規則仍待驗。
