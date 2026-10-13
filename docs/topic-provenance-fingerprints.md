# 話題 provenance fingerprint：離線 helper 與 SQL oracle

本批新增 `app/src/topics/provenance-fingerprint-sql.ts`，只產生兩個版本化 SQL
fragment，沒有接 reader、scanner、sidecar、marker、current 或發布流程。
`topicFingerprintSql()` 的回應不包含 `canVerify` 或 `canPublish`。

metadata 與 body 使用獨立的固定 domain 和有序 `JSON_ARRAY`，再由 MariaDB
以 UTF-8 序列化做 SHA-256。metadata 包含文章／站點 ID、兩者網址、實際
title／summary 的 digest、原 metadata hash 與刊登時間。body 包含 owner、
status、content hash、revision、來源與 adapter／rule 版本、觀測時間、
完整度、截斷／圖片文旗標及文字／HTML byte count；不取回或 hash 原始正文。
兩種 fingerprint 不能彼此相比，也不是跨資料庫 JSON 序列化相容承諾。

## 未來 caller 必須另行驗證

- `cb` 缺 row 時，固定 domain 加上全 NULL 欄位仍會產生非 NULL hash。
  因此必須檢查正文 row 存在、expected hash 非 NULL，以及 owner、版本、
  來源與完整度；不能用 NULL-safe equality 或 hash 存在代替這些 gate。
- metadata 刻意不含部落格 status。公開條件、verified、owner、發布日期
  與是否撤下，必須由當次 statement 的 fresh predicate 保證。
- body content hash 的正確性依賴合作 writer。相同 byte count 且 writer
  沒更新 content hash 的正文修改不會改 fingerprint；它不是正文認證、
  授權、robots／DNS 或 ownership 的證明。
- 日期 `Z` 依 caller 已用 UTC 寫入 DATETIME 的契約。helper 不推測或
  轉換未知 legacy 時區；既有日期欄位為秒精度，六位格式不能證明微秒保留。
- alias 只接受 exact plain-own 三個白名單欄位；不接受 getter、Proxy、
  prototype、額外欄位或任意 SQL identifier。
- `OCTET_LENGTH` 仍可能造成資料庫 server I/O；本輪沒有 HTTP 成本或
  正式吞吐量測試，未來 caller 必須先限縮文章範圍再計算。

## 測試與證據

6 項純 mocks 涵蓋固定欄位順序、獨立 domain、alias 與 hostile object。
root 的相關三組測試合計 23 項通過，app no-emit 與四檔 Biome 通過。
窄 selector：

```sh
node tools/test-integration.mjs --env-file <private-clone-env> --suite topic-fingerprint-sql
```

runner 仍只允許 loopback DB 18169 的隨機 disposable schema，禁止直接
外網 fetch；不讀正式 `.env`。tiny fixture 使用兩個合成部落格、一篇文章
與一份正文，58 個 SQL 檢查、25 個 additive migrations 通過，涵蓋逐欄
變更／restore、NULL／空字串、Unicode、資料庫 JSON bytes 的 Node SHA
oracle、missing body 與 status 不在 metadata hash 的限制。這不是 reader
採用、完整詞庫切換、正式 DB 或新的 Next build 驗收。

私有原始 SQL log：
`/home/deck/.t3/projects/blog-observe-tw/.reviews/offline-quality/d1-fingerprint-root-isolated.log`。
獨立非作者 Sol receipt：
`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/d1-fingerprint-sql-independent-review.json`。
第一次 root typecheck 誤指不存在的 `app/tsconfig.json`，原失敗 log 保留；
改用根目錄 `tsconfig.json` 的 no-emit 通過，沒有為通過測試更改 runtime。

generation-local sidecar／marker、scanner 和所有 reader 的共同契約，
legacy carry／history、全部 writer 的 dirty barrier、短 TTL intent 與
原子 CAS 仍須分批實作與獨立驗證。在此之前完整池不能發布。
