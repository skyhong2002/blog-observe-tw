# 正文已提交之後的索引排程契約

基底：fetch 後 HEAD／origin/main `8edeae7ee681f987111f80336ea6d108705830bc`。
本批只新增 `search-index-adoption.ts`、純 mock 與本文。不改 worker、feed、history、
content store、route、migration 或正式設定；沒有 DB／Redis／HTTP／build／capture。
預設 off，完全不讀環境。source 完成不代表索引排程或產品已啟用。

## 已讀的實際提交邊界

- `content/store.ts` 的 `ingestContentEvidence` 回傳 `{postId,status,changed,hash}`。
  retained 分支可能 status=ok 但 changed=false；304 也不是新正文 adoption。
- `content/worker.ts` 先 beginTransaction／ingest，`await c.commit()` 後才可認定
  durable。目前只留下 status，**沒有索引 event caller**。後續接線需保留真實
  written.postId/status/changed 與已驗 owner ID，不能僅看 HTTP200／statusok。
- `crawl/feed.ts` 的 upsertEntries 與 feed validator 在同一 transaction；成功
  commit 後才呼叫 F4 passiveBatch.commit(articleURLs)，rollback 則 discard。
  這個 F4 URL-list callback 不提供 body adoption IDs／changed／owner，因此不能
  冒充本索引契約已接線或把 URL 轉成猜測的 postId。
- `crawl/history.ts` 等 history importer 回傳成功之後才呼叫既有 F4 commit；
  importer 的交易與回傳不是本輪修改範圍。只有實際 caller 可證明 adopted body
  的 transaction 已成功，不能從下載／parse／F4 已觀測推論正文已 durable。

## 純介面與白名單

```
createSearchIndexAdoption({ enabled: false, enqueue? })
recordCommitted({
  commitState:'committed', status:'ok', changed:true, publicationStatus:'verified',
  postId, blogId, postOwnerBlogId, bodyOwnerBlogId
})
discard()
flush()
snapshot()
```

`enabled` 只接受 exact true。每個 batch 最多10個 unique postId，同篇重複去重，
owner metadata 必須相符；raw event 的正文、URL、hash、token、extra 欄位完全不保留。
`commitState` 是可信 caller 的明確宣告，helper **不能證明 SQL commit 成功**。
應在 commit 成功之後才 record；commit rejection／unknown／rollback 不可 record。
沒有新的正文 adoption（retained／unchanged／partial／304）不能藉它補成索引成功。

所有事件收錄在記憶體，不是 durable queue。每個成功的交易／批次用自己的 contract
instance。caller 若 scope 可能超過10項，必須處理 `full`／overflow、拆成受控小批或
留下明確 repair 選項；本契約不偷偷保留第11項、全庫補掃或自動排 timer。

`enqueue(readonly postIds)` 必須明確回 `{acceptedPostIds}`。接受集合須唯一且只包含
本次請求 IDs；missing／錯誤 ack 不能被當成成功。**queued 僅代表 enqueue 已承認，
不代表 producer 已完成索引**；所有 snapshot 都標 indexed=false。

## rollback、失敗與 repair

在 flush 之前 discard 會清除 pending 並關閉 batch，永不 enqueue。已 flush 的
callback 不能假裝可取消：in-flight discard 回 cancellation not-guaranteed，禁止新增
事件與第二個 flush。每 instance 最多一次 enqueue invocation。

callback rejection 可能已造成 queue side effect；狀態 needs-repair、IDs 保留，不自動
重播。部分 ack 只移除已承認 IDs，其他仍 needs-repair。重叫 flush 不會 retry。
flush 不保留／公開依賴的 exception 訊息，也不 rollback 已提交的原文。
caller 必須在 SQL transaction 的 commit／release 之後分開處理 enqueue 結果，不能
把 queue 失敗丟回原文 rollback 區塊，假稱 undo 已 durable 的內容。

這個純 helper 不設外部 queue deadline，也不保證任意 injected callback 會完成。
callback 必須由後續 caller 提供自己有界、可驗 ack 的實作；若一直 pending，batch
保持 flushing，不開第二個 enqueue，避免不明工作堆積。沒有正式 queue／重試策略。

process crash 會失去未 ack 的記憶體 IDs；需由 operator 基於真實 committed source
與 queue 狀態 reconcile。repair 必須明確且重新使用受控選定 IDs；不能自動 retry、
全站掃描，或憑舊 ownership 宣告重放。

實際索引仍由 `produceBodySearchIndex` 另外 fresh read 現存 public／verified／
非 future post、正文 status、owner URLs、content revision 與 raw text hash。
事件只是排程通知，不能授權繞過 producer 的檢查。若源文章後來撤回／改變，producer
按現況拒絕或清除該篇舊派生 postings，原文與引用資料不刪除。

## 證據界線

pure mock 驗 defaultoff、未 commit／rollback、status／owner、cap／dedup、discard、
metadata 白名單、一次 in-flight、partial／invalid ack 與 no-auto-retry。沒有實際
enqueue、worker hook、正式索引回填、產品驗收或部署；須交另一既有 instance 獨立審查。

## 修訂：一次 capture 後才驗證

事件白名單 primitive 欄位各讀一次到本地副本，再檢查與保存；getter丟錯只回skipped，
不把未知 exception 送回已提交正文 caller。getter若重入並關閉 batch，capture後保守
skip，不復活 queue。ack 先讀固定length（最多10），逐索引只讀一次到普通localarray，
再驗unique/requestedsubset；完全不呼叫輸入 Symbol.iterator／some／再spread原ack。

這只固定契約metadata的讀取／驗證語意，不是任意JavaScript執行的沙箱。committed
仍是trustedcaller宣告，不能被文件或mock誇大成資料庫提交證明。

## 實際 caller／queue 接線（離線 source 批次）

本節取代上文「沒有worker hook」的現況描述；上文保留為純契約階段的證據界線。
`BLOG_SEARCH_INDEX_ADOPTION_ENABLED` 只有字串 `true` 才開啟，預設關閉。
`runContentBatch` 在 `ingestContentEvidence` 已鎖住 verified／owner 的交易成功 commit、
connection release 後收集 changed／ok 正文 ID，批末 flush。304、retained、rollback、
unknown commit、不相符 ID 不排隊。只接這個 content caller，feed／history 的其他正文
寫入通道尚未接入，F4 的 URL callback 也不等同正文索引事件。

使用 blog 既有 BullMQ queue／prefix，新 job 名 `blogs-search-index`，不增加 Redis
服務、全站掃描或 backfill 排程。每個 job 最多10個選定 ID，attempts=1。enqueue
及 Redis NX claim 都有1000ms deadline；尚未 settle 的操作保留單一 pending 槽，
不能逾時後再累積同類操作。晚到 claim 不會啟動 SQL。queue 錯誤回 needs-repair，
不 rollback、不把已提交正文改記成抓取失敗。

consumer 先以既有 queue namespace 的原子 Redis SET NX 保存 claimed-not-indexed
標記，再由 producer 依現存公開／owner／日期／正文 hash 重讀處理；不共用舊 promise。
claim 沒有 TTL，job 被移除也不自動移除 marker，避免未知 SQL 結果被自動重播。
**claimed 不是 indexed；Redis 遺失也不保證 exactly-once。**marker 會隨工作數增加，
必須在正式 enable 前確認 Redis 持久化、容量監控與 operator reconcile 流程。
repair 必須核實既存正文、SQL postings 與 queue／claim 狀態，另以受控選定 ID 執行；
本批沒有自動刪 marker、重試或自動修復。

作者與非作者各實跑4 suites／56 mock；raw作者報告：
`/home/deck/.t3/userdata/blog-sprint-4cc7bcd/search-index-queue-wiring/author-report.json`；
獨立 review：
`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/search-index-queue-wiring-independent-review.json`。
app no-emit 與5檔Biome通過。沒有 native Redis／正式DB／HTTP／新build或capture，
所以不是正式索引coverage、worker運行或「蛤蜊絲瓜」產品驗收。

## RSS／歷史匯入／relations 已接線（本次 source 進度）

此節取代上文「只接 content」的現況；純 helper 的早期描述保留為時序。
RSS 每個 source、history 每個 commitTask、relations 每個有界批次各有自己的
staging collector。真實 ingest 的 primitive post／blog／owner metadata 只 capture一次；
每個 SQL transaction 的未提交暫存彼此隔離。只有 commit resolved 且 connection
release 成功才採用；沒有 native transaction、commit／release 結果不明時只記
unproven repair scope，不捏造 committed、不排 queue。

relations 最外層 finally 仍會 flush 先前已提交 IDs，不因後續 observation／lease／
cache／abort 出錯而丟掉通知。queue 或 best-effort reporter 失敗，不 rollback 正文、
不把成功的 history task 改成失敗。原回傳介面保留；history 的 queued 仍指 child
history tasks，不能誤解為索引 job 數量。

每個 collector 最多10個 unique ID，超額只保留 overflowEvents／有限 numeric blog
repair scope，結果明列 partial／needs-repair。overflowEvents 不是全批 unique 數量；
也沒有保存 raw body、URL、hash、任務 payload 或無界 ID。正文 commit 到 enqueue
之間的 process crash gap 仍存在，reporter 不是 durable audit／outbox；需 operator
選定 IDs reconcile，沒有自動全站回填或不明結果重播。所有背景 hook 仍由 worker
明確注入 default-off adoption provider；CLI 直接使用低階 writer 不造 commit 證明。

root 與非作者 Sol 各跑9 suites／106 mocks；root 另在既有18169 disposable schema
跑 F3/F4 9 suites／24 migrations，未碰正式DB。app no-emit 通過。
原始 root log `.reviews/offline-quality/all-callers-root-final-units.log`、
`all-callers-f3-f4-isolated.log`；非作者 receipt：
`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/search-index-all-callers-independent-runtime-review.json`。
没有 native Redis／HTTP／新BUILD_ID／正式flag enable或全文coverage驗收。
