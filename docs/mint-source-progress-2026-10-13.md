# Mint 排隊前的離線 source 批次

基底 `origin/main`：`dd289be357eb321386e24365eb8edefe64b0ef4d`；工作分支 `work/blog-mint-queue`，前一個乾淨 source 切點為 `016901f029fe85a369fd7cee694867db5af673d6`。本批沒有 SM build、capture、restore、新 release 或正式資料寫入。唯一建置交接來源是 `/tmp/babysit/mint-queue/blog.md`，不另建清單。

## F4：接上既有抓取輸入

先前正式 0 detected／260 unknown／53 not-observed 的原因與三個真實站的既有資料，見 [gen5 診斷](f4-gen5-diagnosis.md)。本次把 history、feed discovery 與 favicon 的**既有 HTML 回應**接到 passive batch，不新增 HTTP、排程或抓取預算。只留有界技術 DTO；文章須等原匯入 commit 後再匹配目前公開 post，homepage 仍由 writer 核對公開與 ownership。

每批最多 32 個輸入，SQL 用 `MIN(id) GROUP BY p.url LIMIT 32` 避免同 URL／不同 GUID 放大回傳；失敗、304、rollback 丟棄 pending，不能更新觀測時間。favicon 保留原 observer，啟用時隔離例外並組合 callback。2.5 秒只限制 metadata lookup 等待，不保證底層 pool acquisition／SQL 取消；每 pool 最多一個尚未結束的 lookup。

兩項獨立 review finding 均採納。GPT-6.1 Sol 的原始與複審紀錄：

- `/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/f4-passive-wiring-independent-review.json`
- `/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/f4-passive-wiring-independent-followup.json`

這些是 source／mock 證據，不代表 Alina、Carol、timdream 已新增正式技術觀測；沒有 HTML 證據時仍不猜 CMS 版本。

## F3：有界正文索引

新增一張 additive posting 表（0023），**尚未套用正式 DB**。NFKC／lowercase 三碼 gram 與最終 literal 驗證使用同一正規化，正文最多 64 KiB、前 4096 codepoints，索引候選最多 201（含 sentinel）、最終最多 200。public/date/ownership/current revision 與 raw text SHA 重驗，沒有 global body LIKE。CLI 只接受最多 10 個明確文章 ID，預設 dry-run，沒有 worker hook 或自動回填。詳見 [正文索引限制](search-body-index.md)。

非作者 source review：`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/f3-body-index-independent-review.json`。mock 之外，本輪既有隔離 MariaDB 18169 的 disposable schema 實跑六組整合、23 migrations；search 26 assertions／1002 個合成文章約 217 ms，驗證 server deadline、transaction DML、舊 ID 命中，以及 seed／rejected／moved／future／delete／owner／status／revision 排除。

測試 log：`/home/deck/.t3/projects/blog-observe-tw/.reviews/googlebot-audit/f3-f4-integration.log`。這是小型合成 SQL fixture，不是正式容量測試或 anise 真文驗收。正式正文搜尋旗標保持 off，直到 Mint 同產物候選、真實選定文章及成本／隱私驗收。

集中 focused 5 suites／58 mocks 與 app TypeScript no-emit 通過；追加 producer commit rejection／取得連線後 deadline destruction 測試。原 log：同目錄 `source-focused-tests.log`。底層 SQL deadline 不包含 public pool acquisition；超出部分只能 unavailable，不能假稱查遍歷史。

## Opus 安全審查的處理

有效 review：`/home/deck/.t3/projects/blog-observe-tw/.reviews/mint-source-review/opus-focused.json`，實際回應 model `claude-opus-5-5`、finish_reason `stop`。第一次沒有正文且被截斷的回應由工具拒絕，不算 review；檔案保留，不覆寫。

- 採納：reader 對非法 UTF-8 逐筆略過並記 `invalidUtf8`；producer 記錄 `invalid-utf8`，不讓該種壞輸入中止其他所選文章。
- 採納：明確 apply 在單篇 transaction 中清除其舊派生 postings，包含 overcap、non-ok、missing 或 ownership 不符。不刪原文章／正文；dry-run 仍零寫入。
- COMMIT 的 timer 不清除，維持有界執行。不同意放寬 deadline；改採文件明示逾時結果可能未知，前面文章也可能已個別提交，不可自動重試或聲稱整批 rollback。
- NFKC／大小寫的上下文差異只揭露為 literal 語意限制，不改成另一個未驗算法。
- homepage 入列本身不是公開輸出；writer 的 transaction 與公開 read 都重驗 verified／ownership，因此該假設不是已驗證的隱私缺陷。feed 的寫入與 lookup 使用同一 canonicalArticleUrl；尚未建立的搬家／http／www alias 不硬猜，只會漏採。

採納後的程式碼另交非作者 Sol 複審與既有隔離 SQL 驗證，不把最初 Opus 對舊 hash 的通過直接套到修訂版。

最終非作者修正複審：`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/f3-body-index-opus-fixes-independent-review.json`，37 mocks 通過。最後隔離 runner 已完成 **7 suites／23 migrations**，search 增至 33 assertions／1002 個合成文章約 200 ms（包含 overcap／non-ok 清除舊派生索引），tech-fetch-batch 另 10 checks，實際驗證重複 URL 最小 ID、32 筆上限与公開狀態／ownership 排除。最終 SQL log：`/home/deck/.t3/projects/blog-observe-tw/.reviews/mint-source-review/final-isolated-sql.log`。前面的六組結果保留為較早修訂的時序證據，不混稱同一版。

## 後續建置與回滾

Mint slot 順序 tag → YT → blog，取得 global flock 不等於 owner 許可；隔離 API／readiness 尚未具備就不能以正式 API 替代。native ELF 相容證明與隔離 SM smoke 尚待實際產物，不能把 Node ABI 相同當作通過。所有頁面仍須新 SHA／BUILD_ID 的實際獨立看圖 review，source tests 不會關閉 ledger 的 pending。

本批不切正式 slot；正式仍 green gen5 `4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8`。既有 blue 安全回滾、release、worktree 與備份保留，no-store／privacy predicate／Disabled Cloudflare 規則不變。解凍與 slot 交接後才可建置一次、candidate 審查、同產物藍綠部署；不因本文件宣布 ready。

功能 commit：F4 `64cbea3`、F3 `1af0b44`。最終 10 suites／147 unit tests、app TypeScript no-emit、diff check 通過；log `.reviews/mint-source-review/final-units.log`。本地延續 logical review ledger 為 Codex 18／Opus 6（3:1）；修正複審不重複計数，截斷回應不計有效 review，舊圖的離線 review 不等於現行 UI pass。私有計數：同目錄 `review-ledger.json`。
