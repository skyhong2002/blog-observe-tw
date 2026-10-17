# 可續跑歷史匯入

歷史匯入使用既有 Node 24 / TypeScript、MariaDB / Drizzle 與 `politeFetch`，沿用新文易數固定版本 `afe0a65` 的來源佇列思路與本專案 RSS/Atom/XML/文章 parser；不沿用新聞的 14 天期限或四個 sitemap 分片限制。正常 worker 的單次最新文章抓取與歷史匯入分開，低頻部落格不因久未發文判 stale。WordPress REST 文章的 `source_type=wordpress` 僅供歷史 API writer 使用；一般 feed discovery 仍只接受 RSS／Atom／sitemap。

## 執行與續跑

先執行 Drizzle migration `0004_history_import.sql`。CLI 每次只執行一個有界批次，所有工作保存於 `history_runs` / `history_tasks`；重跑同指令會從 pending 工作繼續，並非清空重來。

```sh
node --env-file-if-exists=.env tools/crawl-history.ts --ids 1,2 --pages 5 --articles 30
node --env-file-if-exists=.env tools/crawl-history.ts --blogs 5 --duration-ms 60000
```

預設每站一批最多 5 個目錄／feed／API 請求、30 個文章或已序列化 entry、60 秒（正在進行的有界請求可在時間截止後結束）；HTTP 工作預算至多約 5 + 30，另有安全 redirect／robots 請求。總額預設每站 10,000 個 HTTP 成功工作、100,000 篇寫入、200,000 個唯一工作，可用 `--total-pages`、`--total-articles`、`--tasks` 調整。達總上限保持 `limited`，人工提高上限並指定 `--ids` 後續跑；不會截掉後面的 URL 再宣稱完成。無 `--ids` 時按最久未處理優先、公平挑選 verified 且 partial／冷卻到期 blocked 的站，不會永遠只選前幾站。

## 可發現的公開歷史

- RSS/Atom 的 `rel=next`（XML 與 HTTP Link）；Blogger OpenSearch 明確總量／游標。
- WordPress 首頁 API discovery 或 feed generator 所指示的公開 REST posts 分頁；只讀公開已發佈 `post`，不登入、不走管理 API。沒有總頁數 header 時逐頁走到空頁或明確 `rest_post_invalid_page_number`。
- Sitemap index 所有合法分片，再把每個 URL 存成獨立待辦。每個 HTML 都必須具有相符 `Article` / `BlogPosting` / `NewsArticle` 或 `og:type=article` 才寫入；商品、分類與推薦區塊不是文章。XML gzip 同樣受 5 MiB 解壓上限限制。
- WordPress oEmbed XML（含舊 feed_sources 遺留）不是 RSS，不抓取、不當歷史來源；已有待辦記錄 non-syndication-source 後繼續。錯誤僅保存 timeout、bodylimit、XML／JSON／gzip、已知 SQL code 等固定分類，不記錄原始錯誤中的 SQL／URL／憑證。

所有文章、子 sitemap、redirect 與下一頁都限制在同一出版者；Medium／vocus 等共用網域保留作者路徑，已登記的外部 feed 只允許在既有 feed 路徑調整 query。留言 feed 與 comment anchor 不會當文章。

未提供可列舉歷史的站只能收錄公開可發現的資料；不猜測私人 API 或日期 URL。網頁、來源不同格式可能提供同篇文章：共用 writer 在鎖定 blog row 的交易內依 canonical URL 找原有 GUID，避免 RSS GUID 與 sitemap URL 產生重複文章。空白日期、摘要、作者與圖片不覆蓋既有有效資料，預設「未命名文章」不覆蓋既有標題；content hash 由合併後實際內容重算。作者最後發文時間取較新值。資料庫以非唯一 `(blog_id,url(512))` prefix index 加速精確 URL 查找，不改 URL 相等語意。Sitemap lastmod 只作更新時間，絕不當發文時間。

## 一致性與狀態

metadata 工作完成代表所有子工作已持久化，並不代表文章已寫完。每個 transaction 同時提交 post／作者／標籤、子工作與工作游標；任何 SQL 失敗皆 rollback，原工作保持 pending。重新抓取可重放，來源 ownership 與 verified blog URL 每次交易重新鎖定檢查。正常 crawler 共用相同 writer 與 blog row lock。

- `partial`：本批預算用完，仍有 pending 工作。
- `blocked`：robots（只在 `BLOG_CRAWL_OBEY_ROBOTS=true` 時發生）、401/403/429、其他抓取或 SQL 錯誤。停止本站本批，保存待辦並至少冷卻六小時；遵守較長 Retry-After（最多七日）。不換 UA、不繞過 robots。403/429/robots 不自動略過；其他錯誤逐任務累計 attempts，第三次失敗改為 `failed`、保留 last_error 與警告，才繼續其他工作。來源已移除也可記錄終態，不寫入失去歸屬的文章。可選來源回 200 HTML 軟404／無效 XML 直接記錄不可用後結束該探測。
- `limited`：總工作／文章／請求或巢狀深度達上限，保留待辦等待明確提高上限。分頁本身不累加 sitemap 巢狀深度。
- `exhausted`：公開可發現工作已走完，但僅有最新 feed 視窗，或有任何 warning（例如來源遺失、跨站排除、文章未解析、循環或失敗任務）。目前保守地要求零 warning 才可完成，即使另有 sitemap，也不會掩蓋 feed 視窗的限制。非文章／缺乏文章機器可讀證據的頁面會留下 `article-unparsed`，不當作已取得文章。
- `complete`：所有已發現的公開 archive 工作均已完成，且未遇上述缺口。僅此時寫入 `blogs.history_imported_at`；不是保證刪文或非公開文章也已取得。之後新增來源會重新開啟 queue 並清除完成時間。

初次建立 run 會清除舊 `--history` 單次重抓留下的完成時間，因舊模式沒有持久游標。新版 `crawl:once --history` 仍可略過 ETag 重抓，但不再自行宣告歷史匯入完成。回滾到舊 release 時必須停用其 `--history` CLI／排程，因舊實作可能寫入不可信的完成時間；新版 partial／blocked／exhausted 狀態均清除該時間，真正完成時直接寫本次驗證時間。

## 安全與姊妹站隔離

所有網路請求使用原有 DNS 公開 IP 驗證與連線釘選、每跳 redirect 安全驗證、robots.txt 讀取（預設不遵守）、可識別 UA、每 host 原子預約限速、回應大小與 timeout。它不呼叫 Similarweb、不共用 tag 資料庫或 Redis。單一 `blog_observe:history-import` MariaDB named lock 使用專用 connection，工作另用一條，pool size 2 足夠；lease 丟失即停止，不在交易裡做 HTTP。worker 排程由 blog 自己的佇列負責，與正常抓取共用每 host 限速 map。

測試涵蓋全 sitemap 分片與千筆 URL、Atom/Blogger/WordPress 分頁、平台作者隔離、comments exclusion、partial 續跑、403/429/robots 冷卻、SQL 失敗 rollback 不前移游標、總量上限與來源／GUID／日期保護。

## 背景排程與停止

`blogs-history` 每五分鐘取最久未處理的五站，各最多五頁、三十篇、四十五秒。`BLOG_HISTORY_ENABLED=false` 可停用並移除 repeat scheduler；既有游標保留。候選驗證每三十分鐘、缺漏圖示每十五分鐘，均在 blog 專屬 concurrency=1 的 worker 閒置後依序執行；上述為排程間隔，長批次會使實際開始時間延後。worker CPU 上限 35%、MemoryHigh 512 MiB／MemoryMax 768 MiB，避免歷史回補占用姊妹站資源。

SIGTERM 後不再啟動下一個一般抓取或歷史站點，等待目前有界批次清理 lease／圖示 lock；systemd `TimeoutStopSec=600` 容許清理完成。圖示鎖不自動搶占；非正常斷電／OOM 後須先確認鎖內 PID 已停止、沒有任何 cache writer，再移除持久目錄的 `app/data/.favicon-refresh.lock`。回滾先停止新版 worker，恢復前版 release drop-in，保留新增資料表與圖示檔，不執行舊版 `--history`。

回滾必須依序：

1. 在新版 `TimeoutStopSec=600` 仍生效時 `systemctl --user stop blog-observe-worker`，確認 active 工作已結束。
2. 用新版工具 `node --env-file="$HOME/.config/blog-observe.env" tools/pause-background.ts` 移除這三個新增 scheduler 及其 waiting/delayed jobs；工具發現 active jobs 會拒絕，保留原 feed/discovery/Similarweb 任務。
3. 恢復舊 release drop-in，daemon-reload 後 restart web/gateway/start worker；不可先恢復舊90秒設定再停止新版 worker。
4. 檢查 restart exit code、三服務狀態、healthz/首頁/API/OAuth/SSRF guard，以及 tag/youtube200；失敗必須明確回報，不把回滾當作已成功。

正式部署 drop-in 明確寫入三個 `BLOG_*_ENABLED=true`，可切為 false 停用。新版本保留舊 job 未知名稱直接 skipped 的相容行為，仍在回滾時清理多餘排程以免無意義喚醒。
