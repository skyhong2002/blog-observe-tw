# 部落格來源探索設計

目前骨架已提供低頻、可關閉的 discovery worker：blogblog.club 每週抓取，Similarweb Similar Sites 本機旗標固定關閉，整合等待 tag 契約。候選資料和已收錄網站分開保存，並記錄發現網址、來源頁面、抓取時間與人工確認狀態；發現結果不會直接公開收錄。

## blogblog.club

`https://blogblog.club/blogrollroll` 是適合低頻讀取的候選來源，`/party` 文章投稿和 `/random` 也可能提供部落格連結。探索器應：

- 每週單執行緒抓取，先遵守 robots.txt，使用可辨識的 User-Agent 和聯絡資訊。
- 保存 ETag／Last-Modified，遇到未修改回應時不重解析。
- 只建立 `discovery_candidates` 與 `blog_links` 候選，不因一次發現直接公開收錄。
- 偵測 RSS／Atom 或 sitemap 後再進入人工確認或收錄佇列，並保留「哪個 blogroll 列出哪個網站」的推薦關係。

## Similarweb Similar Sites

Similarweb 的 Similar Sites 結果只能當候選站和相似關係，不能當作權威分類。它和 tag.observe.tw 的流量抓取共用同一台機器與對外 IP，不能在 blog 服務另開一套無協調的爬蟲。

方案一已獲使用者核准：由 tag 維護唯一的 Similarweb 供應商請求工作，blog 未來只提交探索需求並讀取 tag 結果。現在仍等待 tag 端提供正式 API、認證、資料格式、配額／退避與錯誤契約；尚未接通，也未猜測任何路由。

blog 原先直接請求供應商的 endpoint、模擬瀏覽器 headers、目錄鎖與本機 budget 已移除。`loadConfig().similarWeb.enabled` 固定為 `false`；舊 `BLOG_SIMILARWEB_*` 環境變數全部忽略。`discoverSimilarSites()` 預設或傳入 `enabled: false` 只回 `disabled`；明確傳入 `enabled: true` 只回 `awaiting-contract`。兩種狀態都回傳空候選、零網路請求、零檔案系統操作，因此不消耗 tag 的共用 IP 配額。

待契約明確後另行實作 tag client、安全驗證與整合測試，再接入候選保存；目前不接受注入的「成功」結果作為候選資料。未來候選需保存 `similarweb-similar-sites` 來源、探索網域、發現時間與相似關係 evidence，並經人工審核後才公開收錄。核准方案不代表現在已修改 tag 程式或排程。詳細依賴與回滾見 [跨服務協調提案](similarweb-coordination-proposal.md)。

## 資源隔離

blog 的資料庫、Redis namespace、佇列、cookie jar、Playwright profile 和快照目錄都必須獨立於 tag.observe.tw 與 youtube.observe.tw。抓取工作也應有單一排程器，避免同一個來源由多個服務重複請求。
