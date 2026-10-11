# 部落格來源探索設計

第一版先以四個已核對的 seed 網站提供可運行目錄；來源探索尚未啟用。後續新增來源時，候選資料和已收錄網站必須分開保存，並記錄發現網址、來源頁面、抓取時間與人工確認狀態。

## blogblog.club

\`https://blogblog.club/blogrollroll\` 是適合低頻讀取的候選來源，\`/party\` 文章投稿和 \`/random\` 也可能提供部落格連結。探索器應：

- 每日或每週單執行緒抓取，先遵守 robots.txt，使用可辨識的 User-Agent 和聯絡資訊。
- 保存 ETag／Last-Modified，遇到未修改回應時不重解析。
- 只建立 \`discovery_candidates\` 與 \`blog_links\` 候選，不因一次發現直接公開收錄。
- 偵測 RSS／Atom 或 sitemap 後再進入人工確認或收錄佇列，並保留「哪個 blogroll 列出哪個網站」的推薦關係。

## Similarweb Similar Sites

Similarweb 的 Similar Sites 結果只能當候選站和相似關係，不能當作權威分類。它和 tag.observe.tw 的流量抓取共用同一台機器與對外 IP，不能在 blog 服務另開一套無協調的爬蟲。

在決定啟用前，優先讀取 tag 已保存的資料；若必須補抓，應由主機層級的共用 token bucket／檔案鎖或 tag 既有工作統一排程，錯開每小時 \`:35\` 的流量工作，並將全域突發預算維持在 20 次以下。任何 403、429 或 401 都必須讓所有來源一起退避。這項協調不修改 tag.observe.tw 的程式或排程，先以提案和測試工具完成。

## 資源隔離

blog 的資料庫、Redis namespace、佇列、cookie jar、Playwright profile 和快照目錄都必須獨立於 tag.observe.tw 與 youtube.observe.tw。抓取工作也應有單一排程器，避免同一個來源由多個服務重複請求。
