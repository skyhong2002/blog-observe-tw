# F3 凍結期間證據與限制

基底：fetch 後 `origin/main` 6f47dda。此次只改原始碼、mock 和既有隔離 MariaDB 18169 的 fixture，沒有正式讀取、publisher 抓取、build、capture 或資料回填。

## 變更

- parser semantic-links-v3：正文原始證據保留不同 URL／anchor／context；完全相同的重複錨點仍去重。統計使用不同文章 ID，同篇對同 target 只算一次。blogroll／側欄／留言分開，不計正文引用。
- 既存 body_html 重新解析，不被舊 page_links 的正文覆蓋。新資料每筆附 parserVersion，保留 JSON array 的舊形狀；legacy 非正文資料未經本版驗證不冒充 current，保留 DB 原件並標 truncated。這不是舊版程式實跑回滾證明。
- redirect alias 僅信任完整來源 URL，publication-prefix 須既有 ownership 類別；平台個人 owner 與 exact URL 不混用。Gamer `sn=1` 的證據不能套到 `sn=2`。已採納獨立 Sol blocker 並補回歸；helper 的 verified 是 caller 契約，不能用任意猜測產生它。
- profile 正文／非正文各最多20筆（查21筆判斷截斷），查詢各250ms SQL時限。每筆文章 ID、日期、anchor、240字上下文、觀測時間及比對版本；缺值不冒充已確認。
- native shared tags 用文章自己的標籤，兩側有日期及來源；旗標 `BLOG_SHARED_TAGS_ENABLED` 預設 false，未分析文字相似明示 not-analysed。共同標籤不表示引用或交流。
- 搜尋沿用 6f47dda 的 guarded 歷史 body recall，新增真 SQL fixture；不是新增 FULLTEXT index，不宣稱正式大資料成本已驗。`BLOG_SEARCH_HISTORICAL_BODY_ENABLED` 仍預設 false。

## 測試與 review

集中 runner `node tools/test-integration.mjs --env-file <既有隔離env> --suite f3-f4` 只允許 loopback 18169，隨機 fixture schema 不動既有 DB。最後輸出 `.reviews/f3-f4-isolated/boundary-fixes-sql.log`：20 migrations；search 15 checks（1,002 篇），profile 15 checks（含21筆截斷），shared-tags 14 checks，tech 34＋82＋12 checks，六組通過。

完整 backend unit 首次 862 pass／2 fail，兩個 fail 是舊 single-flight 期待；只更新測試契約，保留8個獨立讀取、第9拒絕、完成後新讀取，barrier 不用 sleep，runtime 未改回共用 promise。兩檔10 tests 複跑通過，原失敗 log 保留。identity／parser／tech-store 73 tests 通過。

獨立 GPT-6.1 Sol：`.reviews/f3-f4-independent/codex-alias-evidence-review.json` 與 `.reviews/b0-f4/f3-shared-tags-profile-independent-review.md`，包含模型原始 log／時間／source calls。精確 alias、SQL期限與截斷邊界建議全部採納；完全相同錨點去重經釐清保留，不需改為逐個重複計數。UI 作者為 Opus，另由 Sol 審查，UI 結果列於 ledger。

## 仍需真實驗收

- `gojp.tw → gogojp.tw`：尚未向正式 alias 表寫入新證據；需解凍後使用實際已抓取的 redirect／ownership 資料，不能將 Chrome 敘述或 synthetic fixture 假裝成 DB 已驗結果。雙向文章日期各自呈現。
- `anise.tw/290726` 的「蛤蜊絲瓜」：fixture 證明歷史召回邏輯，未讀正式 body／未完成正式搜尋驗收。
- relations coverage、failed 分類與 unknown targets 仍以先前盤點為歷史值，凍結期未重抓或查正式 DB，不能把185／18,747當最新統計。擴大採集須等待解除凍結與候選驗收。
- 本批未新增 byline/person 合併規則；作者與網站保持原有分離。未造相似度引擎或假相似結果。
