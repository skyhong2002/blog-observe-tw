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

## 單份儲存與 stored-data checkpoint 已接線（仍不切 current）

新增0024 additive migration，保留既有legacy-dual為預設。只有明確 `importSnapshot(..., control.payloadMode='single-copy-v1')` 使用新模式。MariaDB VERSION先驗；MySQL不在本專案的exact-JSON／SET STATEMENT相容範圍，single-mode回blocked。既有legacy資料不重解讀、不減舊計費、不放寬其manifest CAS；移植到MySQL需要另做版本化儲存契約，暫不採『只比較數字而放寬legacy原文pin』。

新模式在topic_terms.payload存唯一一份原JSON，每頁indexed import_page_index；page receipt只存count／bytes／首尾labelSHA，≤512B，另8MiB cap。2GiB只計termJSON+LF一次，與標準SHA字節相同。schema／journal／0024 snapshot一起更新，rollback不刪欄位或原資料；0024尚未正式apply。

讀取儲存頁前先做≤501列的長度摘要，驗count與Σpayload上限；同raw SELECT再次byte條件／NULL sentinel，JS再驗單行與總bytes，不先把壞巨大page拉進RAM才驗。原2MB page限制不放寬。每頁以CAST原JSON byte roundtrip、UTF8 BINARY排序、original頁SHA核對，checkpoint／cursor／counts同交易commit，寫完再重驗lease。續跑重新驗上一頁連續性；最後original整體SHA＋各頁counts／receipt計費對齊。

收尾不COUNT473萬詞：使用indexed NULL／負值／越界頁index的三個LIMIT1探測。stale cursor回conflict零UPDATE，所有failed/deferred寫回也先locked CAS，不能把另一worker進度覆蓋成failed。DBtimeout明確local-db-timeout，不叫上游失敗。

### Immutable與證據界線

『凍結』是**合作writer契約，不是資料庫強制immutability**：只由此importer寫full snapshot ID，scanning→validating鎖住狀態後不再insert；window sync使用自己獨立ID、retention不碰active fullrun。未來任何writer必須遵守這個限制；需要改已驗payload時必須restart完整validation，不能沿用checkpoint。stateDigest不是auth。完整manifest原文字串在首個checkpoint開始綁定；在此之前惡意DB改opaque metadata不在防護承諾內。沒有宣稱hostileDB／TOCTOU安全。

root 最終5 suites／67 mocks通過（作者與獨立 reviewer 的選定 subset 另見原始 log）；existing18169 disposable SQL1suite／24migration、1001詞3頁通過：真CJK＋emoji label排序、exactCAST payload(U2028/escape)、游標[0,0,1,2,3]續跑、6種tamper含oversize、commit後記憶體未更新續跑、A barrier後B advance的stale不poison、雙向mode衝突、current保留。不是實際4.733M完整池成本或正式cutover。

獨立Sol最終sourcehash／原始transcript：
`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/snapshot-single-copy-independent-fixes-followup.json`與`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/snapshot-single-copy-independent-byte-cap-followup.json`。
Opus非自審runtime／followup：`.reviews/offline-quality/single-copy-final-opus.jsonl`、`single-copy-followup-opus.jsonl`，model實為claude-opus-5-5且success。採納F1–F4與rootbyte邊界；F5合作writer限制與兩項低風險範圍已在此明記。Opus只審backend，沒有審自己的B2 UI。

原SQLlog保留；最新`.reviews/offline-quality/single-copy-isolated-byte-cap-final.log`。ready依然不是published；接下來需full版本fixture／容量／throughput及保留期preview、bounded matching warmup／atomiccutover、delta-overlay與可驗chain契約。上游本機a899source只保留3份fullbase；現在600/day budget若每HTTP500詞需約16天，**不能直接開full500同步宣稱能在保留期完成**。需先評估已支援5000/compact契約或其他有界throughput方案，仍保留2MB cap及globalguard，blog不自行修改tag。

## 5000 compact SOURCE adapter（尚未接排程）

明確 `enabled:true` 加 `largeContract='tag-a89908a-large5000-compact-v1'` 才使用
LargeSnapshotSource，預設零HTTP。只對固定版本 SOURCE 增加
`?cursor=N&compact=1&limit=5000`，保留原manifest的500詞pageSize／原page catalog，
不把上游large group冒充一頁500詞。先驗五項pinned identity、group count／cursor／
largePages原group SHA，再逐個500詞chunk驗original頁hash／terms，全部通過才留單group。
沒有增加2MB decompressed page／4MB manifest、原600/day budget或匹配RAM上限。

只有已知大頁byte-cap會在同instance記該group走原500 compact fallback；逐次只取需要
的小頁，不一次存十頁。每group最多10次small wire保留（含retry），**不包含先前large
attempt**；large的retry／origin fallback亦消耗外部budget。JSON／hash／identity／count
錯誤不fallback。busy時拒絕第二個操作，不累積共享promise。回傳term物件和內部cache
尚共享引用；可信caller應只讀，若改動則下次checksum fail closed，availability硬化可後續
處理；這不是對不可信任JavaScript的sandbox。

Throughput僅估算：4,733,073詞約947個large group、仍9,467個原500頁；每批最多50原頁、
15分鐘一批，scan約47.5小時，另local validation約47.5小時，再加policy projection／warmup。
validation已從本地儲存讀取，不需上游base仍存在；scan仍受上游3fullbase保留期影響。
5000 byte-cap fallback比例、window共用600/day budget、manifest輪詢、retry、resume於group
中間的重抓都可能延長。不得把 nominal947requests當實際wire或保證完成時間。

root 3 suites／45 mocks及app no-emit通過；非作者Sol自跑29 adapter／transport mocks，
sourcehash／model／UTC／原transcript：
`/home/deck/.t3/userdata/blog-sprint-4cc7bcd/large-source-independent-review/review.json`。
Opus拆解review `.reviews/offline-quality/large-pages-plan-opus.jsonl`：採納validation分段估算、
bytecaponly有界fallback、原500頁checksum與quota維持。**P5 caller／scheduler尚未接**；
沒有任何實際完整pool／wire fixture／page size／retention cadence驗收，正式mode保持hold。
