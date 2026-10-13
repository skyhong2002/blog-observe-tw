# 未公開完整詞庫的 scanner proof sidecar

這一批只有 staging writer，沒有公開 reader 採用，也沒有變更 current、歷史
證據或詞庫發布。`canVerify:false` 保持不變；實際完整池容量、dirty writer
barrier、所有 consumer 的共同契約與原子 CAS 還沒通過，不能進行 cutover。

## 明確 opt-in 與原子寫入

`enrollStagedScanProof` 必須明確啟用 `full-index-proof-v1`，只接受 ready、
single-copy、完整 coverage 且尚未公開的 target，連同 manifest／policy／
selection／matcher／cleanup 版本固定。target 有 active scan、舊 index
或 orphan matches 時拒絕 enrollment；不同 pin 不覆寫既有 marker。
已 enrollment 的 target 也不能再用 legacy scanner 靜默覆寫。

每篇匹配的文字與兩個 SQL fingerprints 由同一次 bounded SELECT 讀出。
fresh transaction 依 run → marker → target／import／policy → blog → post →
body 的順序取鎖；沒有 run 的 enrollment 以同一 exclusive topics lease
串列化。final tuple 和 current pointer 均使用 locking read，避免讀到 RR
舊 view。當次資料仍須 verified、owner 正確、日期可公開；hash equality 不
取代任何公開條件或來源判定。

body proof 只接受實際存在且完整的 CB row、既有 adapter 白名單／版本與有效
rule revision，以及 article／post、post／blog、source／blog 的精確 origin。
canonical key 合併 scheme／www 不構成轉址證據；未證明的來源保守 title-only。
source_updated_at 也納入 pre／fresh tuple；沒有 CB 時不使用 relations fallback
補造 full proof。

index、matches、proof、cursor／counter 在同一 transaction 寫入。title-only
proof 的所有 body 欄位必為 NULL；zero-hit 仍有有效 index 和 proof。
capped、撤下或 pre／fresh 不一致會撤除該 target／post 的舊資料。commit 結果
不明時重新讀 durable cursor，不假定 rollback 已撤銷提交，也不重播舊 cursor。

## Additive DDL 與保留

0026 新增 `topic_generation_proof_contracts` 和 `topic_index_proofs`，僅兩張新表
與四個外鍵；沒有刪除或重建既有索引。Drizzle 初稿的無關索引重建已移除，
既有 0024 索引及歷史 migration metadata 保留。

snapshot／contract／run 的父層刪除受 RESTRICT 限制；一個 index 最多 cascade
刪一筆 proof。cascade 不計入 driver 的 affectedRows，不能把它當免費刪除；
未來 GC 要將兩筆 metadata 納入上限。marker target 受 retention 保護，這批
沒有 run／contract 的正式 cleanup API。結構合法性由合作 writer／純 validator
保證，沒有宣稱資料庫 CHECK 已強制，也不是任意 DB writer 的 write-admission。
正式套用 0026 前仍須核目的地父欄位型別、charset／collation 及索引，不可拿
隔離 DDL 成功冒稱正式 schema 相容。

fingerprints 不是 ownership、內容認證或 UTC ingestion 的證明。body hash
正確性依賴合作 writer；同 byte-size 但 hash 未更新的正文修改不會被辨識。
DATETIME 日期只按已知 UTC writer 契約解讀，既有秒精度不代表微秒保留。
細節見 [fingerprints](topic-provenance-fingerprints.md)。

## source／SQL 驗證與尚未完成

5 組、44 項 mocks，app no-emit 通過。既有 DB 18169 的隨機 disposable
schema 套 26 migrations：新 proof fixture 140 個檢查通過，原 scanner 94
個檢查也通過，未操作正式 DB 或 HTTP。

新 fixture 涵蓋 marker／空 target admission、full／title-only／missing／
zero-hit、strict origin／adapter／rule、逐欄 source 變更與撤下、外鍵／
collation、一對一 cascade、rescan、四組寫入回滾，以及未知 commit 後的
durable cursor reconciliation。兩個 RR case 明確設定下一交易為 RR；writer
提交後同 connection 的 plain read 仍見舊 body／pointer，locking read 則拒絕
舊 proof；沒有 sleep、retry 或 TTL。marker 的 retention 證據是實際 predicate，
不是執行未來 GC；fixture 也不是新的 Next／匿名 HTML／RSC 驗收。

root 原始私有 log：
`/home/deck/.t3/projects/blog-observe-tw/.reviews/offline-quality/d1-sidecar-root-isolated-first.log`；
legacy log 同目錄 `d1-sidecar-legacy-root-isolated.log`。
獨立 Sol receipt：
`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/d1-sidecar-runtime-independent-review.json`。
既有 Opus 5.5 instance 的設計 review：
`/home/deck/.t3/projects/blog-observe-tw/.reviews/offline-quality/d1-sidecar-scanner-plan-opus.jsonl`，
H1／H2 等 gate 已採納。

全部 reader／frequency／history／carry／current batch 尚未採用新契約，缺 proof
不能退回 legacy hash 當成新 full 證據。完整池 publisher、dirty replay／future
catch-up、全 writer barrier 與 CAS 維持 hold；不建立新的 SEO 話題頁。
