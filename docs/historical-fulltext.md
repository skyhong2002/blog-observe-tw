# 歷史正文搜尋

以 fetch 後 origin/main `2eed666c7f0969d7efb0a24c34f1a78781922d12` 為基底。`BLOG_SEARCH_FULLTEXT_ENABLED=true` 時，`/api/search` 對至少兩個字的查詢使用 MariaDB 的歷史索引；不再只查最近收錄的 1,000 篇。單字查詢維持原來的有限 metadata 搜尋。

新增 additive migration `0027_historical_fulltext`，建立 private `post_search_documents`。Drizzle schema 定義資料欄位，FULLTEXT 是 migration 中明列的原生索引（Drizzle MySQL index builder 不支援 FULLTEXT 類型）。不修改既有文章或作者資料，不使用另一個資料庫或外部搜尋服務。

正文以 NFKC、大小寫與空白正規化，整份已取得文字拆為 Unicode bigram，編成固定九字元 ASCII token，再以 InnoDB FULLTEXT BOOLEAN AND 查詢。這讓中文、emoji、標點的兩字以上搜尋不依賴 MariaDB 的自然語言斷詞與短詞規則；最後仍檢查真正的連續字串，而不是把 token 共現當作命中。參考 [MariaDB FULLTEXT 文件](https://mariadb.com/docs/server/ha-and-performance/optimization-and-tuning/optimization-and-indexes/full-text-indexes/full-text-index-overview)。

## 隱私與證據

- 索引只產生候選 ID。每次 API 都重新讀取當前文章與部落格，排除 seed、隱藏、rejected、moved、刪除與未來才發布的資料；沒有 result cache 或共享 in-flight promise。
- 正文需要目前 status=ok、post/blog owner 一致、取得時間不在未來、source/article/current URL 身分相符，以及目前全文 SHA-256 與索引相符。標題、公開短摘要、站名另有 metadata hash；資料修改但未重新索引時，舊命中會被排除。
- 公開結果只提供最長 240 字的短片段、原文連結、文章 ID、contextSource 和 `nfkc-bigram-whole-body-v1` 比對版本；不公開原始全文或索引 token。
- 隱藏交易 commit 後開始的新請求立即重新讀取；commit 前已完成讀取的 A 可以保留舊結果。隔離 fixture 用 barrier 卡住 A 的實際最後 SQL 結果，再 commit 撤下，B 完成後才釋放 A，沒有 sleep 或 TTL。
- no-store 與 Cloudflare 停用的快取規則維持不變。

## 範圍與資源

每篇可索引已保存的整份正文，上限 128 KiB（沿用正文採集上限），不再截在前 4,096 字。尚未取得正文、尚未建索引、oversize、partial 或無法驗證所有權的正文不在範圍內；metadata 仍可獨立命中。這不表示已抓齊原站所有歷史文章。

每個查詢最多兩個 SQL statement，每個 server timeout 1 秒；最多讀 200 個候選、候選上限固定公開，原始候選數／過期數／截斷狀態不對外提供，以免舊正文索引成為探測工具。公開 counts 只計當前驗證通過的結果。每頁最多 20 筆，只處理有界 ID 集合，沒有對全站歷史正文做 LIKE 掃描。

`tools/index-historical-search.ts --after <ID> --batches <N>` 每批 10 篇、批間五秒、pool size=1；每篇 upsert 後保留 cursor，可續跑、可重複，不發 HTTP。不把文章全文或金鑰寫進 stdout。worker 每五分鐘以獨立 high-water keyset 處理 5 個新文章，再循環核對 5 個歷史文章；hash／版本未變時跳過寫入，不持續重建 FULLTEXT。刪除文章透過 FK 同步清掉衍生 document，歷史核對會刪除已撤下文章的 document；正文 durable commit 後的既有 adoption job 可立即更新索引。只有一個 blog worker，不啟動第二個。

回滾關閉新旗標或切回 af0；保留 additive table 與索引，不需要 down migration。正式遷移前保留 streamed gzip 備份，既有備份不刪。建置、candidate 和正式截圖各自記錄 SHA／BUILD_ID；正式 DNT/傳輸層 Google 阻擋與 raw network 不拿 candidate review 代替。

source review：既有 Opus 5.5 指出公開候選計數側通道、反向 anti-join 成本、unchanged 重寫、adoption 旗標與空白比對。以上皆修正並加測試；GPT-6.1 Sol 對最後的全文讀寫／DDL／fixture source 審查 pass（沒有冒稱執行測試）。常見詞與長字串實際查詢成本須在資料補齊後量測；仍有 SQL timeout 與候選上限，不隱藏失敗為「沒有結果」。兩份初期 API Opus 回應遭截斷，不計成功 review。私人 logs 位於 `.reviews/f3-fulltext/`。

19:34 UTC 正式 overview 發生500，與建置／首次大量回填重疊；web log 沒有保留當時 DB driver error code，不能斷言唯一根因。19:42 停止回填後才繼續量測。CLI 已改10篇／五秒、pool1、nice19/ionice3；每批間用 DNT GET 正式首頁，非200或超過6.17秒便取消並保存cursor，沒有SIGSTOP或自動重試。worker 索引工作也先檢查首頁，並降至5+5篇／五分鐘，durable change job最多10篇；不把背景成本轉嫁給公開請求。
