# 部落格來源探索設計

目前骨架已提供低頻、可關閉的 discovery worker：blogblog.club 每週抓取，Similarweb 透過已核准的 tag loopback API，每六小時同步，預設旗標關閉。候選資料和已收錄網站分開保存，並記錄發現網址、來源頁面、抓取時間與人工確認狀態；發現結果不會直接公開收錄。

## blogblog.club

`https://blogblog.club/blogrollroll` 是適合低頻讀取的候選來源，`/party` 文章投稿和 `/random` 也可能提供部落格連結。探索器應：

- 每週單執行緒抓取，先遵守 robots.txt，使用可辨識的 User-Agent 和聯絡資訊。
- 保存 ETag／Last-Modified，遇到未修改回應時不重解析。
- 只建立 `discovery_candidates` 與 `blog_links` 候選，不因一次發現直接公開收錄。
- 偵測 RSS／Atom 或 sitemap 後再進入人工確認或收錄佇列，並保留「哪個 blogroll 列出哪個網站」的推薦關係。

## Similarweb Similar Sites

Similarweb 的 Similar Sites 結果只能當候選站和相似關係，不能當作權威分類。它和 tag.observe.tw 的流量抓取共用同一台機器與對外 IP，不能在 blog 服務另開一套無協調的爬蟲。

方案一已獲使用者核准，tag 的 `898f463` 提供唯一的供應商工作。blog 只透過固定 loopback API 提交已核准網域並讀取唯讀結果；每日最多 30 次提交、每六小時輪詢、blocked／認證或契約錯誤整輪退避，配額與時間持久化於 blog 自己的 DB。舊直接 provider client 與 mkdir 鎖已刪除。

候選保存來源 `similarweb-similar-sites`、查詢網域、抓取與發現時間、相似站關係，以及驗證並移除非契約欄位的 tag API evidence。待人工審核才收錄，不覆蓋人工標籤。沒有相似站資料時接受 no-data，不嘗試不存在的 Similar Sites endpoint。啟用、認證、測試與回滾詳見 [跨服務協調契約](similarweb-coordination-proposal.md)。

## 資源隔離

blog 的資料庫、Redis namespace、佇列、cookie jar、Playwright profile 和快照目錄都必須獨立於 tag.observe.tw 與 youtube.observe.tw。抓取工作也應有單一排程器，避免同一個來源由多個服務重複請求。
