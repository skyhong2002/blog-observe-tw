# 部落格來源探索設計

目前骨架已提供低頻、可關閉的 discovery worker：blogblog.club 每週抓取，Similarweb 透過已核准的 tag loopback API，每六小時同步，預設旗標關閉。候選資料和已收錄網站分開保存，並記錄發現網址、來源頁面、抓取時間與人工確認狀態；發現結果不會直接公開收錄。

## blogblog.club

探索器每週從 `https://blogblog.club/blogrollroll` 的表格第一欄取得部落卷網址，再讀取各部落卷正文內的外站連結。這是一層有界展開：部落卷內的候選不會再遞迴抓取。`/party` 另外讀取同頁各月份明確標示的「回顧文章」，尚無回顧時讀「主題頁面」，再收集該頁的外站候選；`/random` 維持第一層連結。月份子頁的關係仍是 `party`，不會冒充部落卷；子頁和一般投稿都不會再遞迴。

- 所有頁面與轉址沿用 DNS 釘選、公開 IP／80/443 限制、robots.txt、含聯絡方式的 User-Agent、每站至少 1.5 秒間隔、10 秒 timeout 與 5 MiB 回應上限。
- 每輪最多 32 次頁面抓取（失敗、304、無條件重試都計入；robots／轉址另由共用 fetcher 限制）、每頁 1,000 個連結／700 KiB 解析快取、全輪 5,000 筆觀察。達上限回報 `truncated`。
- `/party` 根頁優先保留每月回顧／主題與非投稿資料，再保留月份主持站自己的投稿（其回顧頁會排除同站連結），最後收集其餘投稿；因此頁尾月份不會因根頁截斷而失去展開入口。每月最多選一個明確標示的來源，不猜分頁網址，不以候選網址作為抓取清單。
- `partyCoverage` 對新抓根頁回報去重後被排除的網址數、月份子頁實際補回數與剩餘數；只在本輪記憶體保存最多 5,000 個排除網址的 SHA-256，超量明示 `overflow`。304 根頁未保存排除清單，回報 `cached-unknown`，仍遍歷月份子頁，不宣稱覆蓋完整。根頁達上限仍維持 `truncated`。
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

## 2026-10-12 正式驗收

從 `origin/main` 的 `b179767` 開始修正，程式 release 為 `0882121`。正式探索未預置目標網址，實際取得 13 頁、新增 958 個候選、保存 2,088 筆來源觀察，其中 1,078 筆為部落卷關係。`skyhong.tw` 候選 ID 為 1229，由 Wiwi 與 JN 的部落卷各自發現；兩條路徑獨立存在 `discovery_edges`，候選仍待一般收錄流程驗證。

`/party` 觸及每頁 1,000 個連結上限，因此本輪 `truncated=true`；未宣稱已完整收盡該頁。兩張部落卷及 `/random` 在本輪解析到 0 個外站連結，仍屬後續來源覆蓋調查項目。這不影響上述兩條自然發現路徑的驗收。

204 項測試、TypeScript、Biome 與 production build 通過；隔離 MariaDB 還原驗證涵蓋鎖競爭、304 回放、跨來源同網址、UTC 時間往返、人工 evidence／拒絕狀態保護及交易失敗回滾。正式執行前後其他來源的候選 checksum 一致。Codex／Opus 審查與處理紀錄保留於忽略版控的 `.reviews/`。

切換後 `blog.observe.tw`、`/healthz`、目錄與來源頁均 200；Google OAuth 起始 302，S256 與 callback 正確；proxy SSRF 回歸請求回 400；tag／youtube 首頁仍 200。前一 release `9400b6a` 與 service drop-in 備份保留，可回滾。

## 同樂會月份覆蓋修正（parser v2）

2026-10-12 以禮貌抓取讀取根頁與 11 個官方回顧／主題來源（全部 200），未寫入正式資料庫。根頁有 1,044 個外站 anchor；正規化、排除及去重後為 1,011 個候選 URL，真正超出每頁上限的是 11 個 URL。新排序保留 1,000 個，再以月份頁補回其餘 11 個，這次快照的根頁剩餘數為 0；不表示未來來源也必然完整。含根頁的此項測量共 12 頁，2,000 以下觀察，未提高既有工作上限。私人證據保留於 `.reviews/party-coverage/`。

回歸涵蓋頁尾月份入口、回顧優先／主題備援、主持站投稿優先、精確 URL 覆蓋、304 重播、`party` 關係與完整來源路徑、禁止第三層展開、頁數上限及 403 不重試。解析器版本提升會重建舊快取；仍共用原 named lock、SSRF 防護和候選審核狀態保護。本節是修改後的研究／測試紀錄，正式執行結果另由部署驗收記錄。
