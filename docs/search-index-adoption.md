# 正文已提交之後的索引排程契約（尚未接 caller）

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
