# 部落格來源探索設計

目前骨架已提供低頻、可關閉的 discovery worker：blogblog.club 每週抓取，Similarweb 透過已核准的 tag loopback API，每六小時同步，預設旗標關閉。候選資料和已收錄網站分開保存，並記錄發現網址、來源頁面、抓取時間與人工確認狀態；發現結果不會直接公開收錄。

## blogblog.club

探索器每週從 `https://blogblog.club/blogrollroll` 的表格第一欄取得部落卷網址，再讀取各部落卷正文內的外站連結。這是一層有界展開：部落卷內的候選不會再遞迴抓取。`/party`、`/random` 另外收集第一層投稿連結。

- 所有頁面與轉址沿用 DNS 釘選、公開 IP／80/443 限制、robots.txt、含聯絡方式的 User-Agent、每站至少 1.5 秒間隔、10 秒 timeout 與 5 MiB 回應上限。
- 每輪最多 32 次頁面抓取（失敗、304、無條件重試都計入；robots／轉址另由共用 fetcher 限制）、每頁 1,000 個連結／700 KiB 解析快取、全輪 5,000 筆觀察。達上限回報 `truncated`。
- `discovery_pages` 保存 ETag、Last-Modified、最終網址、正文 SHA-256、parser version 與解析後的連結。304 仍回放快取的連結與子頁；解析器版本、頁面類型或最終網址不相符時不用舊解析快取。
- `discovery_edges` 保存 root／source／target、原入口與轉址後來源、完整路徑、anchor、正文 hash、首次／末次觀察時間。同一站由不同部落卷發現的路徑分別保留；抓取去重與路徑去重獨立。
- 候選存入 `discovery_candidates`，不自動核准。已核准／拒絕狀態、人工 evidence 與已完成的 RSS 檢查不被覆寫。`blog_links` 的 ID 關係適用已收錄站點；尚無 blog ID 的探索關係保存在 URL 層級的 `discovery_edges`。
- blog 專屬 MariaDB named lock 使用同一條專用連線取得／釋放，每頁與每次觀察前確認仍持有鎖。手動 CLI 和 worker 不會同時執行此來源；pool 至少需要兩條連線。

驗收不預置特定候選：由根頁自然展開，應能重建 `blogblog.club/blogrollroll → wiwi.blog/blogroll → skyhong.tw` 與經 `blog.giveanornot.com/blogroll/` 的獨立路徑。測試另涵蓋任何表格欄位的連結、304、重複路徑、拒絕狀態保護、robots、私網／轉址、大小與工作預算。

Migration `0003_blogroll_discovery` 只新增兩張 InnoDB 表與索引。部署前備份並在隔離資料庫還原驗證；MariaDB DDL 會隱式 commit，不能靠 transaction rollback 撤銷 DDL。若 migration 中途失敗，先確認尚無新探索寫入，再移除本次新增的兩表並重新執行，勿直接標記已完成。程式回滾可切回前一 release 並保留新增表，舊程式不會使用它們。

## Similarweb Similar Sites

Similarweb 的 Similar Sites 結果只能當候選站和相似關係，不能當作權威分類。它和 tag.observe.tw 的流量抓取共用同一台機器與對外 IP，不能在 blog 服務另開一套無協調的爬蟲。

方案一已獲使用者核准，tag 的 `898f463` 提供唯一的供應商工作。blog 只透過固定 loopback API 提交已核准網域並讀取唯讀結果；每日最多 30 次提交、每六小時輪詢、blocked／認證或契約錯誤整輪退避，配額與時間持久化於 blog 自己的 DB。舊直接 provider client 與 mkdir 鎖已刪除。

候選保存來源 `similarweb-similar-sites`、查詢網域、抓取與發現時間、相似站關係，以及驗證並移除非契約欄位的 tag API evidence。待人工審核才收錄，不覆蓋人工標籤。沒有相似站資料時接受 no-data，不嘗試不存在的 Similar Sites endpoint。啟用、認證、測試與回滾詳見 [跨服務協調契約](similarweb-coordination-proposal.md)。

## 資源隔離

blog 的資料庫、Redis namespace、佇列、cookie jar、Playwright profile 和快照目錄都必須獨立於 tag.observe.tw 與 youtube.observe.tw。抓取工作也應有單一排程器，避免同一個來源由多個服務重複請求。

## 缺網址種子配對

使用者後續核准由程式與網路查證直接補齊，已實作獨立 seed resolution 工具、名稱／首頁／feed 證據與交易式綁定；不以任意部落卷連結直接覆蓋種子網址。已驗證 120 筆、2 筆搬家指向既有站點，9 筆保留 unresolved 與原因。操作與紀錄見 [種子網址配對](seed-url-matching-proposal.md)。

鎖連線若在檢查後斷線，已開始的一次請求仍可能完成；下一次檢查即中止。寫入以交易及完整路徑唯一鍵保持冪等。探索錯誤不會觸發無限制重試。
