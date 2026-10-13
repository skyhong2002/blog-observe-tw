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
