# Vocabulary changes：可驗證 chain 契約提案

**狀態：協調用 proposal，未接線、未改 tag、未查正式 HTTP，也不是正式部署相容證據。** 本文唯讀來源為 tag 本機 Git object `a89908a650c42a1224d657e6c908d5fd3c7be5a0` 的 `app/src/vocabulary/snapshots.ts:411–446` 與 `app/src/v1/vocabulary.ts:56–64`。blog 目前的 `snapshot-changes-contract.ts`／`snapshot-changes-client.ts` 維持 opt-in、`chain: unverified`、`completeGeneration: false`、`cutoverAllowed: false`、保留 current。

## 現有缺口

上游依 previousId 往回找到 after，再依 generation 的時間順序 flatten 各自 changePages。回應只有 target 的 snapshot、目前 entries、全 chain cursor／nextCursor 與目前頁 SHA。target.changeCount／changePages 是 **target 自己** 的變更數與 hash catalog，不能拿來檢驗前代頁、chain 總筆數或總頁數。每頁 self checksum 能察覺內容損壞，不能證明它是固定 after→target chain 的正確頁。

full manifest 有原始全部 terms 的 sha256／pages；DeltaGeneration 只有 total／changes catalog、baseSnapshotId 等 metadata，沒有 materialized target 全部 terms 的 checksum。不可把 base full SHA、target 單代 change SHA 或任意 hash chain 冒稱 target 全詞庫 SHA。

## 可先驗 direct generation 與兩種 verification 等級

若固定 target.previousId===after 且 target 是 delta、baseSnapshotId 等於明確已驗 expectedFullBase，target 自己的 changePages/count 就是完整的一代 catalog，可先以獨立純 verifier 驗每頁 checksum/count/nextCursor、按序 continuation 與 wire-complete；不必等待新增多代 catalog。after===target 是獨立 empty，與 target 自身 changeCount 無關。多代仍 unverified/hold，full base transition 要求 full rebase。這只證明 wire sequence，不代表 overlay已落盤／warmup／published，cutoverAllowed 保持 false。

區分 **upstream-full-image-verified**（對應 target full-image oracle 的 whole SHA）與 **base-plus-verified-deltas**（已驗 base、各 direct delta catalog及 metadata 所形成的獨立本地 derived identity）。後者不必先要求上游新增 tree，但不得填假 whole SHA；其 overlay／membership/count／來源、policy/index warmup、原子 cutover／rollback與每日對應 full generation對帳契約仍待獨立驗收。沒有對應 full-image oracle 時，明示尚未 upstream-full-image-verified。

## 最小 additive、明確版號契約

以下名稱都是 **待協調的新欄位／語意**，不是現行 wire 欄位或已存在路徑。保留舊 v1 changes 不變；新能力須以明確 contractVersion opt-in。新增 chain manifest 與分段 catalog 的 endpoint／參數／token allowlist，須由 tag owner 定稿 OpenAPI，blog 不先猜 path。

Chain identity 至少綁定 contractVersion、source、固定 after、固定 target、target baseSnapshotId、chain digest，以及 ordered generations 的 metadata digest/ref。每代描述包含 id、kind(full/delta)、previousId、該代 base identity、generatedAt、noisePolicyVersion、該代 changeCount/pageCount、metadata digest；完整 metadata（含 opaque extras/sourceAsOf）由 immutable ref 綁定，不必在每個變更頁重送。full generation 仍沿原 full manifest schema；delta 仍沿 DeltaGeneration schema，不補假 full sha。

- 第一代 previousId 必須等於 after；後續每代 previousId 等於前代 id，最後 id 等於 target。禁止重複 generation／cycle／跳代；generatedAt 必須有效 UTC ISO，時間倒退拒絕，同時刻以 previousId 鏈順序判定。
- Base transition 由每代 kind 決定：delta 必須延續其聲明的已驗 full base；遇新 full generation 才能明確切換 base。after 所在版本及其 base 也須能解析並與本地 last-good 一致，不能只信 target.baseSnapshotId 推論整鏈同 base。
- 每代 changePages 數等於 ceil(changeCount/500)；chainChangeCount 是每代 changeCount 的和，chainPageCount 是每代 pageCount 的和。兩者獨立於 target 自身的 count。每代零 changes 仍保留 metadata／previous linkage，但不分配變更頁。
- after===target 為明確空鏈：chain count/pages 都為0，仍釘 target identity；cursor0 回 entries=[]、nextCursor=null、SHA256(JSON.stringify([])+LF)。不可因此把 target 自己的 changeCount 改成0。

分段 catalog 的每個 descriptor 包含 globalPageIndex、generationId、generationPageIndex、expectedCount、expectedSha256。順序必須是 generation 鏈順序，再該代 page index 0..n−1；expectedCount=min(500, generation.changeCount−generationPageIndex×500)。變更頁只需回固定 chain identity/digest/ref 加本頁 descriptor；consumer 先查已驗 catalog 再驗 response cursor、descriptor、entries count 與 SHA256(JSON.stringify(entries)+LF)。不能用 wire 自報的 expectedSha256 當 oracle。

## Metadata 有界與 wire caps

保留 **4MB manifest、2MB decompressed page、變更 entries≤500**；不以600代為理由放大 caps。chain head 只放有界 generation identity/digest/ref 與 catalog chunks 的 hashes/counts，完整 opaque metadata 另有 immutable ref。

建議 catalog chunk 最多1000 descriptors，各 chunk 自己有 SHA256(JSON.stringify(descriptors)+LF)，head 綁 ordered chunk hashes、descriptor 總數及標準整體 catalog checksum。consumer 分段 fresh 驗證，不能把全部 payload 或600代的完整 manifests 放到每頁。保留既有600代上限；global pages 必須能在既有6位 cursor內表示（最多1,000,000頁），超界、metadata超4MB、daily budget／保留期限／disk envelope 無法完成時拒絕並要求受控 full rebase，不能截掉前代再假稱完整。

每個實際 wire（catalog、metadata ref、change page、retry）仍走原固定 origin、public-only服務 token、no-store、外部持久 quota／cooldown、deadline。新 contract 不授權增加呼叫量；2GiB payload 邊界與 metadata/index/disk 實測仍各自驗收。

## Overlay、absence 與 publication oracle

`absent-from-index` 只代表 upstream index 的 membership 事件，不是 blog 作者撤回、文章刪除、SEO 撤頁或原始詞池證據銷毀。依 action 的 exact UTF-8 label SHA identity 套 generation-specific overlay／tombstone；保留 base 原詞與 source attribution，不把標準化 label、AI 詞庫或 blog own public evidence 混成原始來源。相同 term 的跨代重複 upsert/absence 須依鏈順序 replay，不能全鏈 dedup 後掉事件。

Catalog 驗證完成只能說「已驗變更序列」。發布新 pool 還需：

1. 已驗 base、完整鏈／overlay、固定 target 的 termCount 與明確 membership 語意；active=false 與 absence 不混為刪 full pool。
2. **明確 verification 等級與正確 oracle**。upstream-full-image-verified 須對應 target 的 materialized full export，依既有 exact JSONL／UTF-8 label順序重算 whole SHA，或另行驗收版本化上游 membership/content checksum oracle。base-plus-verified-deltas 則保留獨立本地 derived identity，先用已驗 base＋完整 direct catalogs套 overlay並驗 membership/count，另受每日 full 對帳與發布契約約束，不能當 full-image SHA。增量 tree可作後續最佳化提案，但不是本地 derived identity的強制前提；其 leaf／absence/root算法仍須明確版本和獨立 fixtures。
3. blog policy／matcher／article index warmup 與 fresh public/ownership/hash、dirty-post repair、最後 lease/CAS cutover 另行完成。鏈完整不是 corpus 已暖完；不得只因 changes ready 就寫 current。

目前 overlay／policy／warmup／cutover與每日對帳契約未完成，blog delta publication仍 blocked；direct wire驗證可先做。多代完整catalog與 full-image oracle仍需上游協調。不能把原 full checksum指派給overlay target；base-plus-verified-deltas可有自己的明確identity／coverage，不冒稱 upstream-full-image-verified或整個產品已完成。

## 上游協調、風險與回滾

需 tag owner 審查的檔案（均為上述 immutable object 的既有路徑）：`app/src/vocabulary/snapshots.ts`（immutable chain/catalog產生、retention與generation metadata binding）、`app/src/v1/vocabulary.ts`（新版 opt-in routes／caps／409）、`app/src/v1/openapi.ts`（明確版本與欄位）、`app/test/vocabulary-incremental.spec.ts`／`vocabulary-export.spec.ts`（多代、零變更、重複事件、cycle／expired鏈、最後partial頁、catalog tamper與oracle）、`docs/vocabulary-export.md`（來源／checksum／回滾語意）。此清單是提案，不授權本輪修改上游。

必要 fixtures：固定 full→delta→delta／full base transition、after=target／零changes中間代、同term反覆upsert/absence、舊代頁SHA不同於target catalog、catalog亂序／遺漏／wrongbase／opaque漂移、4MB/2MB邊界、retention409、targettermcount或membershiproot不符；blog mock與既有隔離SQL再核 receipts、overlay、崩潰恢復及 current未變。

新版路徑／retention增加 storage與呼叫成本；未驗來源不得預設啟用或擴 quota。409固定 `need-full-rebase` 並保留 last-good，不自動全量下載。驗證失敗保留 run／receipt供repair，不清舊 base與current。回滾關閉新 contract／producer，繼續舊full／window與已驗 last-good；不 alter/drop舊表、不撤 blog evidence。只有後續明確來源與資源驗收後，才另行討論 staging／排程／正式 cutover。
