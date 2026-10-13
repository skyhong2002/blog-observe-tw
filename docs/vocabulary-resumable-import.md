# 完整詞庫：compact 與標準 SHA-256 續跑契約

來源基底 `00d050198e46de658ffe0b75b253bacf450bfe83`，只做離線 source／mock；沒有完整4.733M stage、切換、網路或新建置。正式 worker 仍使用15分鐘文章窗口。完整 tag 池不等於 blog 可索引話題集合；SEO 必須有自己的公開文章命中證據。

## Compact page

本機唯讀 remote Git object `a89908a650c42a1224d657e6c908d5fd3c7be5a0` 的 tag snapshots/page source，支援 `?cursor=N&compact=1`，回五項 identity：id、generatedAt、total、pageSize、sha256。這不是已部署相容性證據。blog `HttpSnapshotSource` 只有明確指定 `compactContract='tag-a89908a-compact-v1'` 才使用；預設 full strict、4MB manifest／2MB decompressed page、固定 origin/service-token規則不變，未新增環境旗標或排程。

compact identity須完全符合先前完整 pinned manifest；cursor、count、term exact-label ID、原頁hash仍沿用 full validator。回傳頁持有原pinned full manifest，opaque extras不刪除、不cast成可信active集合。**五欄不能證明opaque metadata沒被上游變更**；未來runner仍需版本化完整fixture／固定世代manifest核對，不能拿compact宣稱原全manifest逐頁deep-equal條件已完成。

## 可序列化標準 SHA-256

`SnapshotSha256` 使用標準SHA-256 compression／padding；不是逐頁hashchain，也不序列化OpenSSL internals。export包含8個uint32 words、0–63 pending bytes、totalBytes≤2GiB；可跨process JSON匯出/恢復，finalize後不能再update/export。checkpoint envelope固定version、snapshotId、完整persisted manifest字串SHA、下一頁與詞序數／計數／verifiedBytes，stateDigest只偵測意外損壞，**不是HMAC／DB敵意篡改防護**。

helper檢查identity與預期counters，但不證明SQL cursor原子、receipt真實、資料列不可變或排序。caller還必須驗儲存後的原payload／receipt，並讓checksum state與cursor同一交易commit；結尾必須比對上游原本整體 `SHA256(concat(JSON.stringify(term)+LF))`，不能把stateDigest當全量checksum。2GiB邊界用synthetic state做小型測試，不是實際讀2GiB效能測試。

32項mock（checkpoint／compact／transport）通過，checkpoint另有真正Node子process serialized resume、標準向量與Nodecrypto oracle。獨立非作者Sol review：`/home/deck/.t3/userdata/blog-sprint-4cc7bcd/snapshot-compact-checkpoint-review/review.json`；作者checkpoint receipt：`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/snapshot-checkpoint-author-handoff.json`。

## 接線前的設計裁決

既有Opus5.5非自審design review raw `.reviews/offline-quality/b2-fix-vocab-plan-opus.jsonl` 的taskB，taskA是UI作者fix不算review。採納：保留legacy mode、單份MariaDB原JSON payload、exact byte roundtrip oracle、mode/CAS隔離、LIMIT501、原SHA與checkpoint同transaction。新提案不用另一份v2 payload表，以免policy reader分岔；前提是18169 MariaDB實測原JSON byte保留，不支援的driver/DB直接失敗，不能重serialize冒充原字串。

receipt使用首尾label的SHA（不是兩個最長原label），固定有界metadata；logical payload2GiB只計一次，receipt另有8MiB安全閥。實體DB、index、policy與磁碟用量仍需量測，不保證10M都能stage。0024預留additive模式／pageindex／checkpoint欄位；current、warmup、cutover、changes皆為後續批次，不能以ready宣稱已發布。
