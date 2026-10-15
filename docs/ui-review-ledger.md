# UI 逐頁審查紀錄

## Current state（UTC 2026-10-15T19:15Z，gen41）

正式站為 **green／gen41／`91ee7dad864fd92daffaeade66523b7cf2998a20`**，BUILD_ID `IckLDw5TLWeYzYIQ33NZp`，切換
UTC 2026-10-15T19:07:45.914Z（transition 41）。回滾點 blue／gen40 `d754031`／`Jz3ykfP-tbu-AKn9mRlHq`：

```bash
bash /home/deck/.cache/blog-home-cloud-b3-20261014/tools/deploy-blue-green.sh rollback blue
```

**Worker 改跑同一 release**（原為 `af0e73c`）：drop-in
`~/.config/systemd/user/blog-observe-worker.service.d/95-release-91ee7da.conf` 設定 WorkingDirectory 與 NODE_PATH。
回滾：刪除該檔、`systemctl --user daemon-reload`、`systemctl --user restart blog-observe-worker`。`af0e73c` 至 HEAD 間 worker
相關差異只有 `blogs-fulltext` 排程（`BLOG_SEARCH_FULLTEXT_ENABLED` 未設定，維持關閉）與新增資料表定義。

- **使用者問為何正文引用只有一篇**。查證原因：(1) 連結抓取每天上限 300 頁、每站 20 頁，10/12 起每天用滿，近 90 天
  6,153 篇只讀了 949 篇（15%）；(2) wiwi.blog 等 blogblog.club 社群部落格多在 2,181 筆候選中未核准；(3) 美食旅遊站的外連
  多為 Agoda／Klook／KKday 等。
- **B 加快連結抓取**（使用者同意）：每日 2,400 頁、6,000 次請求、每站 60 次；`blogs-relations` 每分鐘一次（每次最多 5 頁）。
  內容抓取共用同一頁數預算。
- **A blogblog.club 名單直接收錄**（使用者：在 blogblog.club blogroll 上就直接批准，不需人工篩選）：直接列在
  blogblog.club 頁面（blogrollroll、party）的候選，以該名單代替「個人首頁自我介紹／AI」證明。名單連的是 blogroll 頁或派對文章，
  所以先為其部落格首頁建立（或標記）候選；首頁、RSS／文章 sitemap、名稱一致、擁有權檢查不變。1,009 筆名單候選對應 311 個首頁，
  其中 29 個已收錄、282 個待驗證。名單收錄每日 100 個（獨立預算），候選審核 HTTP 每日 1,500 次；政策升為 v4，既有候選重新審核。
  新部落格狀態標示「BlogBlog.Club 名單自動收錄」。名單往外再一層（成員自己的 blogroll）仍是一般候選。
- 驗收：vitest 1363、tsc、biome（變更檔）、writer registry；隔離 18169 完整整合 46 套件全數通過（candidates 新增名單衍生、
  收錄、偽造名單在 writer 端被拒）。切換後 `x-blog-release` 91ee7da、generation 41、BUILD_ID 相符、no-store、DYNAMIC；首頁
  2.0–3.4 秒，`/topics/`、`/api/topics`、`/relations/` 200，`/admin/` 302，tag 200。
- 保留：刪除 gen39 `7791578` release 與 checkout（先停回填 run4，cursor 25462，node_modules 改連 gen41，以 run5 續跑）。
  `af0e73c` 暫留：worker 回滾目標，且多個停用 unit 的 drop-in 仍指向它。

## 現況（UTC 2026-10-15T17:10Z，gen40）

正式站為 **blue／gen40／`d75403167577538546599769d5af529e72c32446`**，BUILD_ID `Jz3ykfP-tbu-AKn9mRlHq`，切換
UTC 2026-10-15T17:06:04.426Z（transition 40）。回滾點 green／gen39 `7791578`／`gUY454KbQ44XAq8sDEB0U`：

```bash
bash /home/deck/.cache/blog-home-cloud-b3-20261014/tools/deploy-blue-green.sh rollback green
```

- **首頁正文引用只列真的用句子寫到對方的連結**（使用者：多數卡片沒有內文，看起來很怪）。規則（不使用詞或部落格名單）：
  連結文字在上下文中、上下文扣掉連結文字至少 12 字且含逗號句號等成句標點、同一篇文章連到同一部落格不超過 5 次。
  正式資料逐筆檢查：點子生活 → MiMi韓（同篇 60 條連結，轉載）、點子生活 → V妞（「原始文章：…」「©V妞的旅行」「台南住宿、
  台南親子飯店」）、福寶媽 → 寶寶溫（只有「阿蘇男孩」）皆不再列出；目前 90 天只剩 Shuo-jen Blog〈文字雜想〉一張卡（2 個部落格）。
  `/relations/` 仍計入全部正文連結。
- 引文改為「含連結的那一句」，前面有省略（較早的句子，或 parser 從段落中間起算 100 字）加「…」，後面有省略（較晚的句子，
  或達 320 字上限）加「…」；完整段落不加。頁尾方法區同步說明。
- 驗收：vitest 1360、topic-ui 176、web node 225、tsc、biome（變更檔）、writer registry 重新產生；隔離 18169 整合 home-display 群組
  （含 relation-visibility，fixture 改為句中連結）與 public-api 通過。正式資料試算查詢 93–113ms。切換後 `x-blog-release` d754031、
  generation 40、BUILD_ID 相符、no-store、DYNAMIC；切換後頭兩次首頁 5.4 秒為冷啟動，隨後新舊 slot 直連 1.7–2.1 秒、公開網址
  2.1–2.3 秒；`/topics/`、`/api/topics`、`/relations/`、tag 皆 200。截圖 `.reviews/gen40/blue40-1280.png`。
- 保留：刪除 gen38 `3c9905d` release 與 checkout。刪除前先停回填 run3（cursor 25427）、node_modules 改連 gen39，
  再以 `blog-fulltext-backfill-20261016-run4` 續跑；保留腳本也改為檢查回填 node_modules 的實際指向。
- 待決定：正文引用只剩一張卡，首頁中欄下方大片留白。

## 現況（UTC 2026-10-15T16:50Z，gen39）

正式站為 **green／gen39／`77915780fa24f51c9c5584189e489cd9a49d2d51`**，BUILD_ID `gUY454KbQ44XAq8sDEB0U`，切換
UTC 2026-10-15T16:39:20.709Z（transition 39）。回滾點 blue／gen38 `3c9905d`／`VT4lRLXSIPqMBqBDXUfxa`：

```bash
bash /home/deck/.cache/blog-home-cloud-b3-20261014/tools/deploy-blue-green.sh rollback blue
```

- **正文引用卡片再簡化**（使用者：不要展開、直接顯示約兩行提及內文、說明太多、同一行沒有上下對齊）：拿掉
  「核對連結證據」展開、每卡的「正文直接連結」標籤、網域／觀測時間／版本。每個被連到的部落格一列「→ 部落格」，
  下方直接引出原文在連結附近的文字（沒有上下文時用連結文字），兩行截斷。來源列與每列「→ 部落格」改為 flex
  置中對齊；正式站 390 量測箭頭與標籤的垂直中心逐列相同。頁尾方法區同步改寫該句。
- 驗收：topic-ui 176、node 225；切換後 `x-blog-release` 7791578、generation 39、HTML BUILD_ID 相符、no-store、DYNAMIC；
  首頁三次 2.19／2.13／2.03 秒、tag 200；`/topics/` 200、`/api/topics?days=7` 200、`/relations/` 200。實際瀏覽器 1280 dark、
  390 light 截圖於 `.reviews/gen39/`。
- 保留：刪除 gen37 `021c55c` release 與 checkout；保留 active、gen38 回滾、edge/code、worker。
- **回填**：run2 在 00:25（台北）通過健康複查後立即結束；當時回填 checkout 的 node_modules 仍連到已退休的 release
  （錯誤被工具統一吞為 `fulltext_batch_failed_or_homepage_guard_closed`）。已改連 gen38，以
  `blog-fulltext-backfill-20261016-run3` 從 cursor 25420 重啟，第一批成功。

## 現況（UTC 2026-10-15T16:00Z，gen38）

正式站為 **blue／gen38／`3c9905d7af7cae26d8b51599034ca9debe32b01f`**，BUILD_ID `VT4lRLXSIPqMBqBDXUfxa`，切換
UTC 2026-10-15T15:56:52.407Z。回滾點 green／gen37 `021c55c`／`f0elr8sZPR9MEHLH2Mp0X`：

```bash
bash /home/deck/.cache/blog-home-cloud-b3-20261014/tools/deploy-blue-green.sh rollback green
```

依使用者回饋（gen37 `021c55c`、gen38 `3c9905d`）：

- **共同話題改依熱度排序**（首頁列表、文字雲、`/topics/`）：熱度＝近 30 天篇數 ÷ 依 365 日基準占比推算的預期篇數（兩邊
  ＋5 平滑），排序鍵＝熱度 × log₂(1＋參與部落格數)。正式資料試算：前 8 名由 美食／景點／住宿／飯店… 變為
  桃園、Apple、吃到飽、台北大巨蛋、開箱、智慧家庭、大巨蛋、HomePod。話題集合、篇數、權重與門檻不變（整合測試逐筆比對）。
  純熱度會被單一事件（Apple 發表會，5–7 站）洗版，因此乘上參與廣度。Apple／HomePod 系列近義詞仍各自成項（詞庫層級問題）。
- 文字雲依排名決定字級（原依篇數，使美食最大）；畫上 tag 的代表圖片（地名輪廓等），以 `accent=22c55e` 染成本站綠色；
  圖片清單是 tag 公開資料、每個 process 快取 30 分鐘、1.5 秒逾時即純文字。目前排行中有圖的是桃園、中壢、新北、彰化。
- 「近 30 天；同站貢獻逐次遞減…」說明移到頁尾方法區，並加入熱度公式說明；`/topics/` 計算方式同步更新。
- **正文引用不再間歇消失**：原查詢在冷快取下撞 1 秒上限（一小時 9 次以上）。改從已解析到部落格的連結出發
  （90 天約 11,000 條正文連結中只有 74 條連到其他已收錄部落格），正式資料結果相同，冷快取 1,062ms → 8ms。
- 正文引用卡片改版：每張卡一個「正文直接連結 →」，連到的部落格以小標籤並列；網域、連結文字、上下文、觀測、版本收進
  單一「核對連結證據（N）」。一篇文章連到多個部落格時同一張卡列出全部（測試涵蓋 3 個）。卡片支援文章縮圖，
  但目前 6 筆中 4 筆無圖、2 筆 `image_url` 是 RSS 網址（`https://gogojp.tw/feed/`），故實際上沒有縮圖顯示。
- 驗收：vitest 1358、topic-ui 176、node 225；隔離 18169 整合 home-display、topic-policy-compat、relations、
  relation-visibility、relations-quality、topics、topics-ranking、topics-quality、home-ranking-freshness、content-topics、
  public-api 通過。gen38 切換後 `x-blog-release`／generation／BUILD_ID 相符、no-store、DYNAMIC；首頁 2.3–4.7 秒（load 12）。
  實際瀏覽器（允許外部圖片）1280 dark／390 light 確認雲圖與卡片版面。
- 保留：刪除 gen35 `8755f33`、gen36 `fb8e7db` 與 checkout；回填 checkout 的 node_modules 改連 gen37。

## 現況（UTC 2026-10-15T15:00Z，gen36）

正式站為 **blue／gen36／`fb8e7dbfd020b53e6c347f380f99076bcb50fc0d`**，BUILD_ID `wI_qqKqP1tan8lX5uvVUo`，切換
UTC 2026-10-15T14:56:13.779Z（transition 36）。回滾點 green／gen35 `8755f33`／`30mIp94X6T4kIQ3IrSNTQ`：

```bash
bash /home/deck/.cache/blog-home-cloud-b3-20261014/tools/deploy-blue-green.sh rollback green
```

- **登出修正**：帳號選單的「登出」是 HTML 表單（`application/x-www-form-urlencoded`），gateway 只解析 JSON/text，
  一律回 `415 FST_ERR_CTP_INVALID_MEDIA_TYPE`，也就是介面上登出從未成功（使用者回報）。改為只在 `/auth/logout`
  的獨立 scope 接受並忽略表單內容；同源檢查、刪 session、清 cookie 不變。新測試在舊程式上回 415。
  切換前 green（舊）415、blue（新）303；切換後公開網址表單登出 303 → `/`，跨站 Origin 403。
- 驗收：`x-blog-release` fb8e7db、generation 36、HTML BUILD_ID 相符、no-store、DYNAMIC；首頁五次 2.27／1.77／1.70／
  1.70／1.97 秒，`/topics/` 2.8–3.7 秒，load 8.4。vitest 1358（第一次完整執行 `runtime-icons.spec` 失敗一次，
  單獨重跑三次與完整重跑兩次皆通過，判為高負載下的偶發，與本次修改無關）。
- **主機記憶體**：使用者以 sudo 套用 [host-memory-2026-10-15.md](host-memory-2026-10-15.md) 的設定，已核對生效：
  `vm.swappiness=10`（含 `/etc/sysctl.d/90-observe-swappiness.conf`）、`system.slice` `memory.low=3G`、`tag-db`
  `memory.low=2500m`。套用後換出量為 0，`tag-db` swap 由 1.8–2.3 GB 降至 1.57 GB 並持續讀回；origin 首頁 1.1–1.8 秒。
- 保留：刪除 gen34 `5df6e62` release 與 checkout；保留 active、gen35 回滾（回填 checkout 的 node_modules 也連到它）、
  edge/code、worker。下一次換掉 green 前，要先把回填改從新 release 重啟。
- 登入後截圖：預覽工具開的分頁與使用者面板是不同瀏覽器環境、cookie 不共用（切換寬度也會重建環境），因此改由使用者
  在自己面板登入並擷取。`/my/`（0 追蹤、無 API 金鑰）與 `/admin/` 候選來源（管理員）桌機 dark 兩張，非作者 GPT-6.1 Sol
  `batch-M.json` 皆 pass-with-minor（RSS／OPML 入口重複、深色次要文字偏暗、管理區無導覽 active，皆 low），截圖
  `gen36-l2-loggedin-user/`。`/admin/discovery/` 是舊網址、直接導向 `/admin/` 候選來源，標為完整。登入後手機 390 仍 pending。
- OAuth：blog 與 tag 使用同一個 Google OAuth client（雜湊比對相同，設定檔自 2026-10-13 未變）；登入畫面顯示
  「chumei」或「observe.tw」是 Google 端的名稱，`client_id` 相同，伺服器沒有切換。

## 追加（UTC 2026-10-15T14:30Z，gen35）

正式站未變：green／gen35／`8755f33`／`30mIp94X6T4kIQ3IrSNTQ`，回滾 blue／gen34 `5df6e62`。本段只動測試、工具與文件，沒有發版。

- **測試全部通過**：先前列為「HEAD 既有失敗」的兩項已修（`public-post.spec` 與 web search fixture 用了 `1af0b44`
  改名前的 coverage type；`topic-writer-registry` 補記此後已審的寫入，皆不碰話題表）。整合測試執行器在不帶
  `--suite` 時改為每個套件各用新的拋棄式資料庫，因此第一次真正跑到後面的套件，又發現並修正三個過時測試
  （`public-routes` 游標、`topics-quality` 計數與 CTE 名稱、`content-topics` 的正文搜尋改走 F3 全文索引）。
  vitest 1357、node 225、topic-ui 174、隔離 18169 整合 46 套件全過（`8f8d894`；之後再以正式執行器從頭一次跑完 46／46，exit 0）。
- **回填**：gen35 那次在首頁探測逾時（>13 秒）時被當成致命錯誤結束於游標 25420；工具 `09b76ca` 改為探測逾時、
  啟動時首頁變慢、索引語句撞 DB 1 秒上限都走「冷卻 30 分鐘、恢復健康才以最慢節奏續跑」，非 200 才結束。
  目前 `blog-fulltext-backfill-20261015-run2.service`（工作目錄 `~/.cache/blog-backfill-run-09b76ca…`，
  node_modules 連到 gen35 release），首次探測三次中位數 8.6 秒，已進入冷卻。
- **主機記憶體**：量測與不提權下的限制見 [host-memory-2026-10-15.md](host-memory-2026-10-15.md)；需要 sudo 的
  `vm.swappiness` 與 `system.slice` 記憶體保護沒有執行，指令與還原方式已列出。沒有用 docker 特權容器繞過 sudo。
- **登入**：在 T3 協作瀏覽器以使用者本人已登入的 Google 帳號（只選帳號，未輸入任何帳密）登入成功，確認
  `/my/` 登入後空狀態與 `/admin/`（管理員，顯示「候選來源」）可載入；全程只瀏覽、沒有任何管理操作。之後預覽面板
  重建，網站與 Google 的登入狀態都消失，Google 改要求輸入帳號，因此停止。登入後的 1280／390 正式截圖仍 pending。
  唯一一張登入後 `/my/` 圖（`gen35-l1-loggedin/`）被 reviewer 判為右側溢出，但那是約 1402px 視窗裁成 1280 的
  預覽截圖，同次 DOM 量測所有元素都在 1261px 內；記錄為無效截圖，不是頁面問題。

## Current state（UTC 2026-10-15T12:05Z，gen35）

正式站為 **green／gen35／`8755f3336705a43ae4edf6910d9f77d6a5f5c6a9`**，BUILD_ID `30mIp94X6T4kIQ3IrSNTQ`，
切換 UTC 2026-10-15T11:57:00.353Z（transition 35）。回滾點 blue／gen34 `5df6e62c`／`X3fk3uqDpWjLXWCN18c0-`：

```bash
bash /home/deck/.cache/blog-home-cloud-b3-20261014/tools/deploy-blue-green.sh rollback blue
```

每次切換都驗過：`x-blog-release`／`x-blog-edge-generation` 相符、HTML 內 BUILD_ID 相符、`private, no-store`、
CF DYNAMIC、兩個 `/healthz`、tag 200、首頁話題 8 筆＋文字雲候選 60 筆。gen35 切換後公開首頁五次
1.85／1.81／3.03／1.61／1.83 秒，`/topics/` 2.3–3.0 秒（load 8.8）。原始 prepare／switch／active 紀錄在
`.reviews/gen29/`～`.reviews/gen35/`。

### 本輪版本（gen29–gen35）

| gen | slot／SHA | BUILD_ID | 內容 |
| --- | --- | --- | --- |
| 29 | green `5f0abf0` | `Mzo2u19r4TN2qfO-dZRoB` | 手機關係圖佈局後自動縮放置中（節點與標籤不出畫布、13px）；API 大綱路徑在斜線後換行；表格右緣加箭頭；作者表手機名稱上限；`/ranking/` 主導覽標示「標籤」；靜態頁 build 帶入 `BLOG_TECH_PUBLIC_ENABLED`（gen22 起 `/api/`、`/login/` 等靜態頁導覽缺「技術」） |
| 30 | blue `b2b1882` | `ra9Vzh0AxH4JEAgKH8pqw` | 表格漸隱層 z-10（仍被 thead 蓋住，見 gen31） |
| 31 | green `c8803e8` | `JnofJRBbaAaZcZWHnIRZG` | 漸隱層 z-[25]：在 thead（z-20）之上、網站標頭（z-30）之下；上線前在正式頁注入相同 z-index 驗證 |
| 32 | blue `ba40fc1` | `D8USHxAzrj_4ZSKdJAlQS` | 話題頁手機在文章列表上方加「看哪些部落格在寫（N 個）↓」（原本要滑過約 100 篇） |
| 33 | green `c47be34` | `Ilul-kHqqV9FT0RQUgW3F` | 錯誤／404 頁在話題路徑的方法區位置對齊；回填工具加 overview 紀錄調速與冷卻續跑 |
| 34 | blue `5df6e62` | `X3fk3uqDpWjLXWCN18c0-` | 頁尾起點再對齊（頁尾無方法區時 `mt-10` 與 `mt-14` 外距合併，只拉回 40px）；上線前在正式 404 頁量測模擬 |
| 35 | green `8755f33` | `30mIp94X6T4kIQ3IrSNTQ` | 首頁正文引用改為沿 `posts_published` 倒序找最新 9 篇有效文章即停；正式資料唯讀比對 now／7／30／60 天結果相同，冷快取 2.3→0.2 秒、暖 92→48ms |

測試：每版 web vitest 174（話題跳轉斷言加在既有話題頁測試內）／node 225 全過；後端 vitest 1355 過、2 個 HEAD 既有失敗
（`public-post.spec`、`topic-writer-audit`，未修改的 HEAD 上同樣失敗、輸出逐行相同）。隔離 18169 真 SQL：
`topics`、`topics-ranking`、`home-ranking-freshness`、`relation-visibility`（首頁 6 種隱私 barrier）通過。

### 第 4 輪逐頁 review（22 項全數有當版正式圖）

非作者 **GPT-6.1 Sol**（codex exec，read-only；作者為 Claude Opus 5.5），每批附 tag 現行 T-ref
`/home/deck/tag-analysis-private/ui-review/current-live-7dc-20261015/`。共 68 張圖審查紀錄，每張的 release、
viewport、主題、狀態、截圖路徑、SHA256、結論與 findings 逐筆寫在 [ledger JSON](ui-review-ledger.json)；
review 原始輸出 `.reviews/f4-round4/reviews/batch-A.json`～`batch-K.json`（D 首次因模型滿載失敗，保留並重跑
`batch-D-retry.json`）。截圖：`/home/deck/.t3/userdata/blog-f4-round4-20261015/`（`gen28-*`、`gen29-*`、`gen31-*`、`gen32-*`、`gen33-*`、`gen34-*`）。

capture 方式：公開頁用既有 `tools/ui-capture.mjs`（DNT=1、導航前阻擋 GA/GTM、每批 4 張）。工具刻意拒絕
`/admin`、`/login`、`/my` 與非 200 文件，因此未登入私人頁與 404 改用一次性無 cookie 腳本（DNT=1、只放行
本站 GET/HEAD；報告在各目錄 `report.json`）。錯誤頁無法在正式流量安全觸發，改在**非活躍** slot 暫停其
gateway 約 1 分鐘、直接對該 slot 的 web 拍攝後恢復（gen31、gen33、gen34 各一次，皆在切換前或回滾 slot 上）。
capture 工具會阻擋 `/me`、`/auth` 類請求，所以它拍的圖頂部沒有「登入」按鈕，這是工具限制、不是頁面缺陷。

| 結果 | 路由 |
| --- | --- |
| 完整（已審狀態全 pass，且無已知未驗狀態）9 項 | `/about/`、`/api/`、`/articles/`（有結果＋查無結果）、`/login/`、`/ranking/`、`/relations/`（90／7 天、手機）、`/topics/`（30／7 天）、(not-found)、(error) |
| 已審狀態 pass，仍有待驗狀態 13 項 | `/`（正文引用降級狀態）、`/admin/`、`/admin/discovery/`、`/my/`（登入後需真人 Google 登入）、`/api/status/`（degraded）、`/authors/`（作者篩選）、`/blogs/`（篩選排序）、`/blogs/[slug]/`（其他資料量）、`/observe/opt-out/`（切換後）、`/tags/`（搜尋）、`/tech/`（篩選分頁）、`/topics/[id]/`（歷史模式、撤銷）、`/traffic/`（月份排序） |
| issues | 0 |

本輪 review 發現並已修正上線：手機關係圖裁切（gen29）、API 大綱斷字（gen29）、表格看不出能橫捲（gen29–31）、
作者表名稱截斷（gen29）、`/ranking/` 導覽（gen29）、靜態頁缺「技術」導覽（gen29）、話題頁手機找不到部落格清單
（gen32）、錯誤頁間距（gen33–34）。保留的低等級意見：API 大綱路徑在斜線後換行（刻意，避免斷在字中）、
手機表格名稱省略（有完整名稱 title）。表格右緣箭頭、`overflow-wrap:anywhere` 為相對 T-ref 的刻意偏離。

### 回填、主機與保留

- 歷史全文索引 16,661／99,046 篇（本輪開始 15,948）。回填 A/B（關／開各 8 分鐘兩輪，開＝每 5 秒 10 篇）：origin
  首頁中位數 2.70／2.46／2.53／2.50 秒不變，p90 由 3.23 升到 5.2–5.4 秒，開啟期間 `home.mentions` 逾時 4 次。
  原始資料 `.reviews/gen27/backfill-ab-20261015.tsv`。據此工具改為：每批最多 5 篇、間隔 10–120 秒，每次探測同時
  讀活躍 gateway 近 2 分鐘的 overview 失敗紀錄，有就降速；首頁三次中位數 >6.17 秒則先停 30 分鐘，主機、首頁
  （<4.5 秒）與 overview 紀錄都健康才以最慢節奏續跑，最多 12 次；非 200 立即結束。目前由
  `blog-fulltext-backfill-20261015-gen35.service`（工作目錄 gen35 release）執行，log 同上。
- **主機記憶體／IO 是剩餘不穩的主因**：blog 與 tag 共用同一個 MariaDB 容器（`tag-db`，buffer pool 1 GB），
  它有約 1.9–2.3 GB 被換到 swap；主機 swap 20.8/25 GB、尖峰 iowait 75–80%。gen35 後仍見一次
  `home.mentions` 在連線池全空下 1002ms 逾時。首頁查詢已縮短（話題 2→1 秒、正文引用冷 2.3→0.2 秒），剩下的
  波動需要主機層決定。
- 滾動保留（UTC 11:35–12:00，三次，都在 `edge/deploy.lock` 內並在鎖內重驗引用）：刪除 10 個舊 release
  （58e551a、7590344、b8c1350、68a032b、b63e4cf、5f0abf0、b2b1882、c8803e8、ba40fc1、c47be34）、
  對應 prepared/build JSON、殘留 bc8998d JSON，與 9 個拋棄式 source checkout；第一次量到可用空間增加約 6.78 GiB。
  保留：active `8755f33`、回滾 `5df6e62`、`93060cc`（edge/code）、`af0e73c`（worker 與 unit drop-in）、
  `blog-release-source-76a90e7`（兩個工作目錄的 node_modules 仍指向它）。紀錄
  `.reviews/rolling-retention-20261015b|c|d/`。
- `releases/93060cc`（edge/code）在本輪之前已被某次清理刪掉，導致 slot 無法重啟；已用 `git archive 93060cc`
  原樣重建（見 gen27 段）。

## 現況（UTC 2026-10-15T10:00Z，gen28）

正式站為 **blue／gen28／`b63e4cf6f7a37cfc32d808a077179ac2b404b098`**，BUILD_ID
`DLfWJGW-CryeKQT2PLOq2`，切換 UTC 2026-10-15T09:54:24.857Z（transition 28）。green／gen27
`68a032b`／`QEgJ-tkNmRwTiStk11XqA` 在線，是回滾點：

```bash
bash /home/deck/.cache/blog-home-cloud-b3-20261014/tools/deploy-blue-green.sh rollback green
```

本版只改後端：`/api/topics`（`/topics/` 頁）改用與首頁相同的精簡排行取 100 筆，另以一條
(詞, 站) 閘門查詢計算 `matchedPosts`。舊 `ranking()` 的 `evidence` CTE 在 MariaDB 每次引用都重算
（一個請求算 4 次）。正式資料唯讀比對 7／30／90 天：items、truncated、matchedPosts 全部相同；
30 天 8.2→2.0 秒、90 天 16.3→3.5 秒。前端原始碼與 gen27 相同（重新 build，BUILD_ID 不同）。

驗收：單元測試同 gen27（只剩兩個 HEAD 既有失敗）；隔離 18169 真 SQL `topics`、`topics-ranking`、
`home-ranking-freshness`、`relation-visibility` 全通過（預設全跑在 `staged-scan-proof` 中止，因該套件
要求空語料庫、需單獨執行，與本版無關）。切換前 load 16 時 blue 完整排行 2.7／3.6 秒、green 10.5／12.6
秒，內容相同。切換後 `x-blog-release` b63e4cf、generation 28、HTML BUILD_ID 相符、no-store、DYNAMIC、
`/healthz` port 18174；公開首頁五次 5.4（首請求）／1.74／1.68／1.69／1.65 秒，`/topics/`
5.0／3.2／3.0／2.8／2.6 秒，load 12.6；tag 0.24–0.38 秒。

回填：以 `212daa8` 的自適應工具重新啟動（慢探測改取三次中位數、啟動前先等主機不忙），游標 24462 起，
log `.reviews/gen27/backfill-adaptive.log`。原始 release／switch 紀錄 `.reviews/gen28/`。

## 現況（UTC 2026-10-15T09:45Z，gen27）

正式站為 **green／gen27／`68a032bcb96733ec5e4a024a415ebd6622ea4987`**，BUILD_ID
`QEgJ-tkNmRwTiStk11XqA`，切換 UTC 2026-10-15T09:34:32.426Z（transition 27）。blue／gen26
`7590344a`／`Xm1Rp-cc1A9eW-NCT5lnf` 仍在線，是回滾點：

```bash
bash /home/deck/.cache/blog-home-cloud-b3-20261014/tools/deploy-blue-green.sh rollback blue
```

本版內容：

- 首頁話題排行：先以 (詞, 站) 彙總比對再查詞表／頻率表，查詢次數 12.2 萬→約 4.6 萬；
  `fresh_posts` 與 `native_labels` 以 STRAIGHT_JOIN 固定從期間內文章出發，避免忙碌時計畫翻轉。
  對正式資料（唯讀）7／30／90 天結果 hash 與舊版完全相同；30 天約 2.6→0.9 秒、90 天 4.5→1.7 秒。
  完整排行 `ranking()` 共用同一段 SQL，90 天逐欄比對 0 差異。
- 文字雲：首頁改取 60 筆排行候選、畫 30 個；本期文章標題提到該詞不到 1/3 的「正文順帶詞」
  不畫進雲但保留排行列（同背景詞閘門的 1/3，判斷的是篇數，不是詞名）。上線時 30 天雲已無
  Life、星巴克、西區、信義區、鮭魚、法國、德國；景點、美食保留。方法說明另更正：背景詞的
  原站分類豁免實際門檻是 1 個部落格（程式 `minimumNativeBlogs: 1`），不是先前寫的 2 個；
  若改為 2 會誤殺「景點」，因此維持程式、改正說明。
- `/api/` 手機：inline code 改 `overflow-wrap:anywhere`，短 token 不再被從中切斷（T-ref 仍是
  break-all，這是可讀性修正的刻意偏離）。`/relations/` 關係圖：節點字 11→12px、依寬度換行顯示
  完整名稱（不再 14 字截斷），窄螢幕縮短邊長。兩項尚待本版正式 390 capture 與非作者 review。

驗收：

- 測試：web vitest 174／node 225 全過；後端 vitest 1355 過、2 失敗（`public-post.spec`
  coverage type、`topic-writer-audit` 登記表），兩者在未修改的 HEAD 257bc01 同樣失敗、輸出逐行相同，
  非本版造成。隔離 18169 真 SQL `home-display` 套件（display gate、policy compat、
  home-ranking-freshness、relation-visibility 69 assertions 含 seed/rejected/moved/future/
  delete/owner barrier）全數通過。
- 切換後：`x-blog-release` 68a032b、`x-blog-edge-generation` 27、HTML 內 BUILD_ID 相符、
  `private, no-store`、CF DYNAMIC、`/healthz` port 18175；tag 200。green 直連話題 API
  0.99／1.01 秒（blue 同時 1.94／1.99 秒）。公開首頁五次 15.0（切換後首請求）／4.8／2.6／3.7／3.9 秒，
  當時 load 13–14。

已知問題與需要人決定：

- **主機記憶體不足**：UTC 09:41 時 iowait 75%、swap 20.8/25 GB；blog MariaDB RSS 956 MB 另有
  1.9 GB 在 swap（buffer pool 本身被換出）。首頁偶發 >10 秒與此同時出現；大量記憶體在 tag 的多個
  平行 release 服務。SQL 已縮短到約 1 秒，剩下的波動需要主機層處理（加 RAM、收斂其他服務、或讓
  blog DB 容器不被換出），未擅自更動。
- `edge/code` 指向的 `releases/93060cc…` 先前被清理刪除（早於本輪；執行中的 edge／blue 不受影響，
  但任何 slot 重啟都會失敗）。首次 prepare green 因此 `slot_start_timeout`；已以 `git archive 93060cc`
  原樣重建（edge 只用 Node 內建模組），第二次 prepare 成功。原始失敗 log：
  `.reviews/gen27/prepare-green-attempt1-edge-code-missing.log`。
- 回填：自適應版本（`--adaptive`，`b56facb`）首批後於 09:39:44 首頁 8.4 秒（>6.17）自動停止，
  游標 24462，未重試；當時 load 13、iowait 高，非回填量造成（只索引 1 篇）。待主機回穩後再續跑。
- Release、prepare、switch 原始紀錄：`/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/gen27/`。

## 現況（UTC 2026-10-15T02:11:40Z，gen26）

正式站目前為 **blue／gen26／`7590344a4accf3059fddaba07064b54ae193b49f`**，BUILD_ID
`Xm1Rp-cc1A9eW-NCT5lnf`；green／gen25 仍是回滾點。上一版首頁查詢修正已部署，
回填以一篇、兩分鐘間隔恢復，仍需持續觀察 overview 診斷。

本輪新增四頁正式 DNT=1 capture 與非作者 GPT-6.1 Sol review：
`/about/`（1280 light）、`/api/`（390 dark）、`/topics/`（1280 light）、`/relations/`
（390 dark）。原圖與 raw network 在
`/home/deck/.t3/userdata/blog-f4-round3-20261015/formal-batch1-about-api-topics-relations/`；
review transcript 為 `.reviews/f4-round3/batch1-gpt-review.json`，只代表提供的 viewport
與正常資料狀態。`/about/`、`/topics/` 為 pass-for-supplied-state；`/api/` 的手機長
inline code、`/relations/` 的手機節點標籤列為 issues；完整 route/state 仍 pending。

## 現況（UTC2026-10-14T22:28:02.034Z，gen22）

正式 **blue／gen22／58e551a79626681024bf47e70ab8e1eee2b2f073**，**BUILD_ID Xm1Rp-cc1A9eW-NCT5lnf**，SM 單次 build 後同產物 prepare-built／切換；green/b8 為在線回滾。`bash tools/deploy-blue-green.sh rollback green` 可立即切回。無 migration、無新完整備份、未改 Cloudflare/WAF 或 tag-backup；no-store／DYNAMIC、HSTS86400、DNT/GA guards 維持。

本輪 inventory：**20 個 page route＋error/not-found，共22個項目；完整 route/state pass 0／pending22**。當次看圖只提升下列已入鏡狀態，不拿正常或同元件的證據代替空／錯／權限／全部資料量狀態。舊版圖片保留原 SHA，不改標 gen22。

### F4 與 T-ref

[逐頁沿用／偏離及資料查核](f4-tref-alignment-2026-10-15.md)。TableScroller 與 table-styles 和 T-ref 逐位元相同；搜尋／篩選操作44px、可見 label、次要文字 zinc600/dark400。品牌綠色、部落格引用語意、方法說明既有 FooterMethod 接線，以及隱私 no-store 是刻意差異。Alina/timdream 現有片段沒有 generator，仍 unknown；Carol 已有 Blogger 證據、版本 unknown。未為填技術 coverage 額外對原站請求，F4 全站完整觀測仍 pending。

原作者：既有 **Claude Opus5.5** session6e17，`/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f4-round2/opus-author.json` 實際 modelUsage/success；非作者 source review GPT-6.1 Sol 的 `independent-source-review-final.json`。初審兩個可見性測量問題已採納；「表格文字顏色也必須完全不變」是 packet 歧義，已釐清 T-ref 本就要求修正已知對比問題，複審通過，不為保留低對比而拒絕修正。

Candidate 三個 route（home/tech/Carol）共8張1280/390，明暗／來源展開分開記錄，**不是正式畫面**；非作者實看8張＋4張當前 tag 參照，`candidate-independent-ui-review.json`，canDeploy=true。正式第一批四頁8張＋4張 tag 當前7dc參照，`formal-gen22-four-page-review.json`，UTC2026-10-14T22:32:17.626482，實際 GPT-6.1 Sol／finish_reason stop，無阻擋。所有絕對路徑/hash見 [本批證據索引](f4-gen22-evidence.md)。

| route／實例 | 正式桌機1280／手機390（子目錄內 page1/page2 或 page3/page4） | 受審狀態、tag偏離與結果 | 待驗 |
| --- | --- | --- | --- |
| `/topics/` | `/home/deck/.t3/userdata/blog-f4-round2-20261015/formal-tables-new/page-1-1280-light.png`、同目錄 `page-2-390-light.png` | GPT-6.1 Sol／APP58e551a／BUILD Xm1R；light 橫捲末端 limited pass。部落格期間與權重取代新聞標籤排行，元件相同。 | 排序／期間／中間捲動、dark／空／錯仍 pending。 |
| `/tech/` | 同上目錄 `page-3-1280-dark.png`、`page-4-390-dark.png` | 同 reviewer/SHA/BUILD；dark 橫捲末端 limited pass。主機/CDN 與軟體分開，列出觀測範圍與時間，非新聞流量。 | filter／分頁／loading／空／錯狀態仍 pending；額外原始完整來源觀測待自然取得。 |
| `/relations/` | `/home/deck/.t3/userdata/blog-f4-round2-20261015/formal-method-profile-new/page-1-1280-light.png`、`page-2-390-light.png` | 同 reviewer/SHA/BUILD；light 方法展開 limited pass，summary 已避開 sticky header。正文引用、共現、相似分開的語意差異有說明。 | 關係圖互動／時段切換／dark／空／錯仍 pending。 |
| `/blogs/carol-691/#content-source` | 同上目錄 `page-3-1280-dark.png`、`page-4-390-dark.png` | 同 reviewer/SHA/BUILD；dark 來源／技術區 limited pass，Blogger 證據與未知版本、成功／嘗試時間可核對。 | 其他資料量、鍵盤展開、整頁、錯誤仍 pending；舊 SourceProfile 說明曾測得4.10:1另列 issue。 |

每張圖 report 都有 actual release/BUILD、DNT1／navigatorDNT1、實際GPC=null、導航前 Google/GTM 與外部傳輸阻擋、network.requests；analytics allowed0。手機兩表首欄152→88px，header top57＝site header57，最右欄完整可見、nowrap、documentWidth390；桌機1280不溢出。第一版過寬推導的原始 artifact 保留，正式 gen22 已用修正後工具重拍。可見次要字126個 DOM 樣本，CSS Lab 由既有 LightningCSS 轉為sRGB後做 WCAG 計算，最低4.827:1、126pass／0fail／0unknown；只限入鏡樣本，**不是整頁 AA 認證**。Candidate 另一段舊 SourceProfile 說明4.10:1仍待修，不以 source 改動假定已修全部頁面。

### 第二批四頁：正常首屏（gen22）

`/blogs/`、`/authors/`、`/traffic/`、`/ranking/` 各1280/390 light，原圖與raw network分兩個子目錄，每個report四張：
`/home/deck/.t3/userdata/blog-f4-round2-20261015/formal-batch2-directory-authors/`（blogs=page1/page2；authors=page3/page4），
`/home/deck/.t3/userdata/blog-f4-round2-20261015/formal-batch2-traffic-ranking/`（traffic=page1/page2；ranking=page3/page4）。全部APP58／BUILD Xm1R，導航前DNT1/阻擋、GAallowed0，先後的uptime/三站time_total都在report。
非作者實看8張＋6張當前tag參照（含media目錄），GPT-6.1 Sol／stop、UTC2026-10-14T22:36:45.496144；transcript `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f4-round2/formal-gen22-batch2-review.json`。四頁首屏有限範圍無阻擋，但不宣稱完整pass。至此正式gen22實際review **8個不同route的部分狀態／14項尚無當版正式review**；完整route/state仍0完成／22pending。

| route | tag對齊與刻意差異 | issue／未驗狀態 |
| --- | --- | --- |
| `/blogs/` | 沿tag媒體目錄的tabs/KPI/chips/表格；母體改為部落格，低頻不失效。 | 首屏右欄在容器內非整頁溢出，但需補橫捲末端；有文章但時間缺值的「尚無紀錄」應區分；filter/sort/empty/error/dark pending。 |
| `/authors/` | 同表格與圖示，作者與站主分開且不跨站併名。 | 作者/網站/文章數的手機右欄需補橫捲；來源的泛稱或疑似評論署名需另查，不因看圖就自動刪站。 |
| `/traffic/` | 圖表、tabs、表格沿tag流量頁，估算不是品質；缺月不補0。 | 手機圖表legend分頁和表格在首屏下方；月份/排序/選站/空/錯/dark尚待互動。沒有拿tag資料讀取失敗當合法空狀態。 |
| `/ranking/` | 同rank/table tokens，但明示依原站標籤參與站數與篇數，非新聞熱度。 | 主導覽缺當前頁標示、dark次要字與排序/tie-breaking待驗；原始Uncategorized等與共同話題品質池分開，需標明來源差異，不能看圖直接刪詞庫。 |

第二批手機橫捲已另做實際補證，APP/BUILD不變；私有 `formal-batch2-mobile-tables/` 四張 page1=blogs、page2=authors、page3=traffic、page4=ranking（皆390 light），report有before/after rect、header、nowrap與DNT/網路。既有非作者 GPT-6.1 Sol於 UTC2026-10-14T22:40:49.998383 再看四張＋當前tag參照，原始log `formal-gen22-batch2-mobile-review.json`：無阻擋。目錄/作者/流量首欄152→88px且最右欄可見；排行三欄本來就全寬可見，不需要橫捲，首欄152px是正常。四頁documentWidth390、nowrap、sticky lead/header。這只解除「沒有實際看過最右欄」的缺口；排序／選月份／圖例／完整名稱／鍵盤／其他狀態仍pending，未刪先前finding。

對照每一頁的phase/model/SHA/BUILD、desktop/mobile路徑、transcript/hash、實際privacy欄位、偏離理由、fix scope和重驗，另有機器可讀 [ledger JSON](ui-review-ledger.json)；只有真實artifact的記錄才有review欄位，其他14項保留pending/missing，不把生成inventory當review。

### 技術驗收與回填

實際 runtime58 的53barrier＋60SSR/RSC（含精確SHA／BUILD／tree／隔離18169、HTTP18176/18177、事件順序）和28全文HTTP privacy皆通過。正式23項、4個實際RSC、三站閘門通過；切後三次中位 tag0.059／blog2.430／YT0.041秒；另五次公開首頁 HTML time_total 中位2.488秒（含edge/網路，不是純origin渲染）。所有HTML/RSC/API仍no-store/DYNAMIC，無恢復CF快取。Build artifact149MiB、1worker、nice19/IOidle；兩次 time 指令不可用均未進compiler，保留失敗log，實際compiler只跑一次；沒有量出整個process tree記憶體峰值，不虛報。

先前五篇／60秒回填只寫10筆，在24448因首頁500自動取消。檢查恢復健康後改一篇／120秒、pool1、nice19/IOidle，`blog-fulltext-backfill-20261014t2233.service`；每批首頁非200或>6.17秒即退出、不自動重試，worker producer仍關。這是小量歷史索引進行中，尚未全量完成。回滾與所有舊原始證據保留；af0仍是worker的WorkingDirectory，不能因滾動清理刪掉。

## 現況（UTC2026-10-14T21:35:12.257Z，gen21）

正式 **green／gen21／b8c1350e38a118c26a67fe67fc1336814e3685f0**，**Next BUILD_ID F_zSp1Bg_oZWzezesLRmQ**；blue af0在線回滾。gen19至gen21只是公開v1的未發布文章predicate修正，**n/a-ui**，web tree／兩份lockfile／data/openapi與同一份前端artifact完全相同。gen19正式看圖與gen17歷史證據保留原SHA，不改標成b8。

本批source：既有非作者Opus5.5通過，實際modelUsage/success位於 `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/public-title-future-opus-review.json`；其建議補真正body fixture已採納，18169真實SQL＋gateway inject regression位於同目錄 `public-title-future-integration-final.log`。此項不拿圖片代替API隐私测试。
B8實際runtime的53 barrier＋60 SSR/RSC在 `/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-final-barrier/b8c1350e38a118c26a67fe67fc1336814e3685f0/runner-result.json`；另28真正FT旗標HTTP隱私在 `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/isolated-api-future-result.json`，正式23項 `formal-acceptance-future.json`。no-store／DYNAMIC、HSTS86400與三站200不變；CF/WAF未改。

worker仍af0，避免新producer與CLI同時執行；只有一個Nice19／IO idle、pool1的小量CLI；先從cursor24418做20批一篇／60秒，全數首頁200且在閘門內，接著從24438以五篇／60秒繼續。逐批homepage guard非200／>6.17秒就取消，不自動重試。此仍是歷史索引coverage進行中，不宣稱全scope完成。rollback命令 `bash tools/deploy-blue-green.sh rollback blue`。

完整gen17/19/21收據、review、正式圖與raw network的絕對路徑/hash另列 [F3證據總索引](f3-evidence-index.md)。下方gen19的12張正式1280/390為目前同前端產物的實際看圖證據；完整頁、手機表格互動、深色/空/錯/權限及其他route仍pending。

## 現況（UTC2026-10-14T20:49:04.958Z，gen19）

正式 **green／gen19／46c074c1f7c0871ec7526c9b8e79559c0963602e**，Next **F_zSp1Bg_oZWzezesLRmQ**；blue af0保留在線回滾。F3歷史搜尋已恢復。worker仍是af0，新的全文producer保持停用，回填以一篇／60秒方式另做小量驗證，尚未宣稱歷史coverage全部完成。
首頁作者SQL在正式DB readonly transaction中三次rows/hash相同，median221.24→3.67ms；正式首頁五次median1.968656s，candidate1.895654s。公開網址時間含網路／edge，不當成純origin rendering時間。正式23項HTTP、53 barrier＋60 SSR/RSC、28全文HTTPprivacy仍通過；header/private/no-store、DNT及CF Disabled不变。

Candidate raw看圖review：`/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/candidate-budget-independent-review.json`；實際非作者GPT-6.1 Sol、4圖＋2tag參照，入鏡無阻擋。
正式同模型獨立review：`/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/formal-gen19-independent-review.json`，12圖＋6參照，actual model、UTC、逐圖hash與raw transcript在原檔。沒有把gen17 review改標gen19。
六模板每一組有 `capture-report.json`（raw network在network.requests、導航前Google/GTM阻擋、DNT1/GPCnull、allowed0）及四張圖，依序 `page-1-1280-light.png`／`page-2-390-light.png`、另一route `page-3-1280-light.png`／`page-4-390-light.png`：

| route／實際範例 | 正式1280／390目錄（repo外私有） | review狀態與待驗 |
| --- | --- | --- |
| `/`、`/topics/` | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-home-topics/` | pending／issues；首屏無阻擋，topics手機表格最右欄需橫捲互動驗證。 |
| `/tech/`、`/relations/` | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-tech-relations/` | pending；入鏡正常，版本省略資訊、graph互動／完整名稱、下方資料尚未驗。 |
| `/blogs/anise-tw-534/`、`/articles/?q=蛤蜊絲瓜` | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-blog-search-correct/` | pending；桌機與手機都見2009歷史結果；方法展開／其他搜尋狀態未驗。 |

品牌綠色、部落格正文引用、tech被動觀測與短片段搜尋為既有產品目標的差異；其餘視覺基準沿tag。T-ref `ff511870` 已讀，後續F4依 `/home/deck/Projects/tag-sm-f1-release/docs/cross-site-consistency.md` 對齊，不宣稱本批已完成全面F4重驗。所有非入鏡狀態及既有其他route pending保留。

## 現況更正（UTC2026-10-14T20:27:33.445Z）

目前正式是 **blue／gen18／af0e73c**，worker也恢復af0。gen17的回填guard取得500，取消後正式首頁仍逾時／超閘門，因此回滾；沒有移除任何隱私或資源斷言。F3新功能目前暫時退回inactive green，後續需修好索引寫入與公開查詢資源競爭再上線。
下列gen17正式截圖／review為當時真實版本，不能當成gen18的驗收。
完整絕對路徑與SHA256見 [F3 gen17證據](f3-gen17-evidence.md)，其中保留切換／回滾原始transition、source與隱私review、12張正式首屏、手機歷史結果捲動圖及raw network。

## 目前狀態（2026-10-14 UTC20:00正式切換後）

- 正式 **green／gen17／APP 7ffd036fd7a968f228e0f8ebf7539d2dd94edc63**，切換 UTC20:00:27.606Z；Next **BUILD_ID F_zSp1Bg_oZWzezesLRmQ**。blue af0e73c 維持在線回滾。建置在 **SM**，不是 Mint；沿用單次建好的同一份前端產物，新 backend SHA 另有完整 B0／全文 HTTP barrier 證據。
- no-store／DYNAMIC、HSTS86400、Cloudflare 兩條快取規則 Disabled 維持。F3 網站歷史正文搜尋已上線；公開 v1 `q` 仍是既有標題＋時間窗口搜尋，不稱為全文 API。
- 正式六模板各 1280／390 light，共12張圖，由自己的 Playwright 工具取得；實際 HTTP DNT1、navigator DNT1、GPC=null、導航前傳輸層阻擋 Google／GTM、analytics allowed=0，raw network 在各 manifest。candidate 與正式兩次獨立看圖 review 分開；沒有把 candidate 圖改標成正式圖。
- 本批首屏 reviewer 是非作者 **GPT-6.1 Sol**，UTC20:14:56.433920，原始 transcript：`/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/formal-ui-independent-review.json`。actual model／finish_reason、逐圖 SHA256、APP／BUILD_ID 與參照圖路徑在原檔。結論只限入鏡，不能取代完整頁面、互動／空／錯／权限／深色／全部動態 route 的驗收。
- 首屏搜尋的桌機已見2009歷史文章；手機首屏只見較新結果，歷史文章在下方。另拍手機捲動證據並獨立 review；原始首屏保留、不回寫。手機話題表格局部橫捲屬預期容器行為，但最右欄、表頭／首欄固定與縮小仍待互動驗收。
- 全部 scope **仍未完成**：未建索引的歷史文章回填、各頁完整逐頁／狀態 review、F1專項正式證據、真人Google登入及其他既有 ledger pending 都保留。不以此批6模板的首屏 review 宣稱全站 pass。

### 本批正式畫面（與 candidate 分開）

各列受審 APP／BUILD_ID 都是上列 gen17；每個截圖目录都有 `capture-report.json`。

| route／正式範例 | 桌機1280截圖（repo外私有） | 手機390截圖（repo外私有） | reviewer／狀態與待驗 | tag偏離與理由 |
| --- | --- | --- | --- | --- |
| https://blog.observe.tw/ | /home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-home-topics/page-1-1280-light.png | /home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-home-topics/page-2-390-light.png | GPT-6.1 Sol；pending（首屏pass；下方／menu／theme互動未驗） | 綠色品牌與部落格正文引用取代新聞焦點，首頁品牌由hero承擔。 |
| https://blog.observe.tw/topics/ | /home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-home-topics/page-3-1280-light.png | /home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-home-topics/page-4-390-light.png | GPT-6.1 Sol；issues（手機右欄未操作；並非整頁溢出） | 沿用tag表格容器，統計母體為部落格；橫捲仍需實際驗收。 |
| https://blog.observe.tw/tech/ | /home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-tech-relations/page-1-1280-light.png | /home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-tech-relations/page-2-390-light.png | GPT-6.1 Sol；pending（首屏pass；版本完整值／下方列表未驗） | 被動技術觀測無新聞流量月份口徑，卡片層次沿用。 |
| https://blog.observe.tw/relations/ | /home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-tech-relations/page-3-1280-light.png | /home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-tech-relations/page-4-390-light.png | GPT-6.1 Sol；pending（首屏pass；graph互動／下方證據未驗） | 只顯示正文直接連結，不作新聞相似或抄襲推論。 |
| https://blog.observe.tw/blogs/anise-tw-534/ | /home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-blog-search/retry-correct-published-slug/page-1-1280-light.png | /home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-blog-search/retry-correct-published-slug/page-2-390-light.png | GPT-6.1 Sol；pending（首屏pass；手機來源展開未驗） | 站名與作者獨立，已取得內文狀態不等於本站展示全文。 |
| https://blog.observe.tw/articles/?q=蛤蜊絲瓜 | /home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-blog-search/retry-correct-published-slug/page-3-1280-light.png | /home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-blog-search/retry-correct-published-slug/page-4-390-light.png | GPT-6.1 Sol；issues（首屏手機未含歷史文章；另有捲動證據） | 正文片段、文章ID與版本為全文搜尋必要證據；全文連回原站。 |

Candidate 非作者實圖 review：`/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/candidate-ui-independent-review.json`；
candidate 圖 `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/candidate-final/`，同 APP／BUILD_ID；四張1280／390 home/search，無阻擋。
正式捲動圖与manifest：`/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-search-history-mobile/history-card/`；
其 review transcript（實際GPT-6.1 Sol，UTC2026-10-14T20:21，入鏡歷史卡無阻擋；僅該捲動範圍）:`/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/formal-history-mobile-independent-review.json`。
首次scroll800只見歷史卡尾端，保留在上層目錄，不當成完整歷史卡通過證據。

## 歷史紀錄（以下保留原文；版本、Mint與資源狀態以各段當時時間為準）

## 2026-10-14：gen13正式接受／f77下一批候選（實圖pending）

babysit UTC14:01正式驗收green/gen13/76a90e7，BUILD_ID 1VV772sbyYBRdL9ur6l9f：
1280/390首頁三區塊已移除、正文article→domain／日期／核對連結呈現、GA0 opt-out，
無Uncategorized／未分類／每天。人類回報沒有截圖路徑，僅記human receipt，不捏造model review。

下一批APP f77a1fe43ccd5110e7982bfec07e997af4cb0e27、tree f44b394074f03f8dc148483b0c08a05e46a930e8，
BUILD_ID LdOP5yqOhKdYbIlHZVfoN；base origin/main b5e20b86d9250f83014a5a84e4e236e2f2582ea8。
同產物inactive blue 18174／18172，正式green76a不動。首30詞、同文多網域合卡、
F1上位分類／相關／別名與圖示空狀態。使用者決定native label門檻1站，保留景點，
人氣／傳承body-dominant無native佐證時退出排行。詳細規則見home-cloud-and-shared-labels-2026-10-14.md。

前端作者既有Opus5.5 session6e17，實際成功author transcripts：
/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/home-cloud-b3/opus-ui-author.jsonl、
opus-ui-author-fix.jsonl、opus-ui-author-background.jsonl；root Codex backend。
非作者gpt-6.1-sol source review（不是看圖pass）：
/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/home-cloud-b3-independent-source-review.json
及home-cloud-b3-independent-source-delta-review.json，原始finding／model／UTC／逐檔SHA在receipt，
三項P2均採納。native grouping後改SHA256索引JOIN與同existing topicID精確規則一致。
非作者Opus backend review finish stop：
/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/home-cloud-b3/backend-opus-short-review.json、
backend-opus-delta-review.json，採納與不適用建議理由在設計文件。首次truncated檔原樣保留、不計次數。

同runtime/BID的B0 53 barrier＋60 sequence全部通過，沒有拿掉privacy/fresh-read/cap断言：
/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-final-barrier/f77a1fe43ccd5110e7982bfec07e997af4cb0e27/runner-result.json
以及同目錄barrier-result.json／sequence-result.json，DB18169／HTTP18176、18177。

本批home、topics、shared-topic三模板各1280／390 light/dark已實際review，共12圖＋6個tag參照：
/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/f77-home-cloud-independent-actual-ui-review.json
SHA256 bed9535ccad0dd16f8151d3b8ff18646d1858a476c2fc0d8f5a156ba6cb3478a，
actual model gpt-6.1-sol，逐圖工具input／UTC／SHA／viewport與原始transcript在receipt。
圖片/home/deck/.t3/userdata/blog-home-cloud-f77-20261014/home/attempt5、shared、topics；
各有capture-report.json與4PNG，actualDNT1／navigatorDNT1／GPCnull／GAallowed0。
入鏡範圍無blocker；展開、belowfold、表格右欄互動、空／錯／權限狀態與精確對比仍pending。
原attempt1–4全部保留，不把失敗擷取算pass。拍攝用OPS5a65c83修正三次中位數與較長transport timeout，
所有HTTP錯誤仍fail，原54個capture測試通過；APP/build沒有改動或重建。

正式曾於UTC2026-10-14T15:43:51.029Z切blue/gen14，同產物f77；21項HTTP驗收通過，
/no-store/DYNAMIC/HSTS86400、30詞/8排行、品質規則、shared parent與空狀態、OAuth302、SSRF400、404、三站200。
/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/home-cloud-b3/formal-acceptance-f77.json
後續首頁5次中位6.421920秒；確認3次9.475220/6.188152/4.702862，中位6.188152超過6.17，
UTC15:49:10.762Z立即rollback green/gen15/76a，f77留inactive blue，不宣稱此批持續正式上線。
同目錄formal-performance-parts-f77.json／f77-performance-followup-gate.json／rollback-performance-f77.log。
當時SQL拆量topics home中位3.000882秒、overview home0.185990秒，繼續查排行重複彙總。
F1 worker實際read-only選取遇250ms SQL cap，因此producer旗標仍false，不把queue實作當已排程生效。
其他全route／F3全文仍pending。沒有CF/WAF調整、正式migration或新全庫備份；所有release與rollback保留。

---

# UI 逐頁審查紀錄

## 2026-10-14 UTC12:05：人類gen12有限正式驗收與下一批source

使用者代轉babysit：正式blue/gen12/43d、BUILD_ID zwqhLTfWMBRUuDn6YP5Tr，
1280／390首頁版面正常，共同話題8筆非空、entity顯示正常，opt-out GA0。
這是人類明確回報，沒有提供截圖/log絕對路徑；不捏造capture或model transcript，
也不將有限首屏檢查升為全部route/狀態pass。下方12:00技術receipt維持原樣。

下一批本分支基底origin/main43d：首頁正文article→domain、移除三個區塊、
文字雲改tag-vocabulary排行源、rank displayGate（tagbroad＋既有2%），
作者為既有Opus5.5 session6e17，backend rootCodex。原始author logs：
/home/deck/.cache/blog-display-noise-20261014/.reviews/display-noise/opus-home-author.jsonl
及opus-home-author-followup.jsonl、opus-home-author-dn2.jsonl，三次actual5.5/success；原作者沒有自審。
獨立Sol初審原檔：
/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/display-noise-home-independent-source-review.json
UTC2026-10-14T13:07:19Z，base43d，actual model gpt-6.1-sol，原始transcript/逐檔hash在JSON。
初審DN1/DN2與fixture兩項finding已修，修後GO：
/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/display-noise-home-independent-source-followup.json
SHAfea3bc9f9b2430806a8278f5c4e22cbe4cc94858c0a4473f0cf87312e0e607fc，49逐檔hash、model/UTC/raw log。
新增guard test獨立GO：
/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/display-noise-home-guard-delta-review.json
SHA4270c309c484c3ad149856751c70f9a8fc46a3859e16fcb312bfb4377fce9d5a。actualImagesViewed=0，
不能把source review列作頁面pass。Opus只審root backend、finishstop原檔：
/home/deck/.cache/blog-display-noise-20261014/.reviews/display-noise/opus-backend-review-short.json
及同目錄opus-backend-review-resolution.json（條件式建議的採納／不採納理由）。首次truncated review未計入。
本批未有BUILD_ID或新截圖，桌機1280／手機390 light/dark全部待重拍；
不能用gen12舊圖當新UI已通過。完整scope/F3fulltext仍pending。新首頁、
部落格profile cloud、/topics方法說明需實際candidate看圖後更新，來源與
readonly前後20名見 [本批設計](home-citations-and-topic-quality-2026-10-14.md)。

---


## 2026-10-14 UTC11:58：43d 同產物正式 blue/gen12（瀏覽器複驗待 babysit）

正式 APP `43d17900c24efae6879bf075d1c576ba74d6a3e8`、
BUILD_ID `zwqhLTfWMBRUuDn6YP5Tr`（primary/standalone 相同）；
transition12 的 UTC `2026-10-14T11:58:57.687Z`；核准流程驗證完成
UTC `2026-10-14T12:00:33.529273+00:00`。原 built43d 與 origin/main不變、沒有重建。
文件 OPS commit 不作為 APP/build identity。active.json 為 blue／gen12／43d；
green4cc仍在線可立即 `rollback green`，兩slot/所有release/backup/worktree保留。

原 packet `/tmp/babysit/mint-queue/blog43-blue-switch-command.json` SHA009bacea...
未覆寫。第一次 UTC11:52:09.553Z切blue/gen10，postSwitch19項通過但後續YT
探針exit28/5.002344s/0bytes（UTC11:53:02.498–11:53:07.509）而立即回滾
green/gen11，UTC11:53:17.862Z。Babysit告知YT也在部署，核准等待3min後重切；
第二次preflight從11:58:35.718Z開始，超過notBefore11:57:52.552Z。只expected
generation9/10改11/12；必需的output paths分開以保存原failedfiles；其餘所有
斷言、APP/runtime/flag/CF均不改。exactargv與diff於
`/home/deck/.t3/projects/blog-observe-tw/.reviews/sm-build-9888ebf/approved-reswitch43-gen12-command-proof.json`
和同目錄 `approved-reswitch43-gen12-command.diff`，不是重寫成功的舊紀錄。

技術HTTP檢查19項通過：正式話題100筆與green完整ordereditems／policy一致，
home8為前8；HTML/API/RSC current43d/build/gen12、private no-store／DYNAMIC、
HSTS精確max-age=86400、404、SSRF400、OAuth起始302/S256/正確callback；
static favicon200/image/png/HSTS，但不將cached immutable header當runtime版本。
正式19項log `/home/deck/.t3/projects/blog-observe-tw/.reviews/sm-build-9888ebf/approved-reswitch43-gen12/formal-http-acceptance.json`；原始部署receipt
`/home/deck/.t3/projects/blog-observe-tw/.reviews/sm-build-9888ebf/approved-reswitch43-gen12/deployment-receipt.json`。原同artifactB0的53barrier/60sequence未被
拿掉；沒有再次改runtime、正式migration、worker或cache/privacy規則。

效能原始紀錄 `/home/deck/.t3/projects/blog-observe-tw/.reviews/sm-build-9888ebf/approved-reswitch43-gen12/formal-performance.json`：首頁五次完整HTML回應
時間[2.522866, 2.69502, 2.560887, 2.649546, 2.451865]秒，中位
2.560887秒；不是TTFB、origin純渲染或瀏覽器load。
三站各3次median blog3.112564s／
tag0.351371s／YT0.250446s，
皆200/exit0且在6.17/2/2s門檻內。Load1 4.48，
/home 48.14GiB、MemAvailable 3.18GiB。
DNT1，只HTML/JSON與manualredirect，不執行GA、JS或真人OAuth，不是Realtime驗收。

**正式實際畫面仍待 babysit：**本節只有正式HTTP/SSR/RSC與同產物候選28張
actualmodelreview，沒有新正式1280/390截圖，不填不存在路徑。首頁話題與
`&#038;` 正常顯示需由human指定正式瀏覽器複驗後補證。整頁UI、互動、
對比unknown與F3歷史全文仍pending；歷史正文旗標關閉，蛤蜊絲瓜未命中，
本批不宣稱全部scope完成。

先前所稱07:56green首頁500，existingjournal確認 `PublicGatewayError:
Public gateway read failed: /api/topics?days=30 (network)`，cause為
`TimeoutError`；發生在改inactiveblue／切換前。只確認舊green讀取話題API
逾時，不推論未量到的DB/CPU深層原因。去識別原始摘要
`/home/deck/.t3/projects/blog-observe-tw/.reviews/sm-build-9888ebf/approved-reswitch43-gen12/green500-confirmed-cause.json`。

---


## 2026-10-14：43d 修正版候選實際看圖（正式仍 green/gen9）

APP `43d17900c24efae6879bf075d1c576ba74d6a3e8`、tree `a335ed943d4b7682394be43a1db14a2e7cf05aaa`，
primary/standalone BUILD_ID `zwqhLTfWMBRUuDn6YP5Tr`。本節為同產物 candidate
實際看圖紀錄，OPS 文件 commit 不會變更 APP、build 或正式 active。
記錄 UTC `2026-10-14T08:35:40.777994+00:00`；28 張／7 個模板（1280、390，各 light/dark）由既有
非作者 GPT-6.1 Sol `/root/home_perf` 逐張 actual view，另看 10 張 tag 參考。
未增加 agent，沒有把捕圖、source review 或 Done 訊息當看圖證據。

唯一 actual manifest：`/home/deck/.t3/userdata/blog-release-43d1790-candidate-20261014/submission-manifest.json`
SHA-256 `6f162fec3303e6c3ae8efb0087b13c1b293d85d83dfe5d4724ef9828fb13d1a3`。每張含 viewport、PNG hash、image UTC、SHA/build/tree、
實際 DNT=1、navigator DNT=1、GPC=null（沒有改寫為 true）、網路計數；
GA/GTM 路由放行 0，before-navigation guard installed；每批 browser closed。

獨立 reviewer 原始 JSON：`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/43d1790-candidate-actual-ui-review.json`
SHA-256 `e75dbe31cd73f0bafd56f24651587e7bbc1b3c9f1eccda20f718d092d9c3c062`；逐圖 actual model／工具輸入／UTC／raw line 在 JSON；
log：`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/43d1790-candidate-actual-ui-review.log`；完整原始 transcript：
`/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T13-12-51-01a133ad-8034-7e81-a619-c9d28bd4ff5f.jsonl`。同目錄 first8／first16／original24 歷史保留。

| route／真實 candidate URL | 桌機／手機／兩色圖片目錄 | 跟 tag 的偏離與理由 | 發現、修正與重驗 | 本批狀態 |
| --- | --- | --- | --- | --- |
| `/` | `/home/deck/.t3/userdata/blog-release-43d1790-candidate-20261014/home/` | tag新聞焦點卡/橙色 vs blog綠色生活/公開文章/共同話題，沒有新聞專用charts。 | `&` 顯示正常、排行非空；修正 43d／5ae7；100 筆 exact parity。 未驗：phone共同話題sidebar belowframe；empty/pending/lateerror/menu/search/theme interactions；completebelowfold/methodopened/third+article states | fixed 部分問題／整頁 pending |
| `/topics/` | `/home/deck/.t3/userdata/blog-release-43d1790-candidate-20261014/topics/` | tagtraffic serves dense tablelayoutreference only; blogtopics counts/weightedcontribution/lift notmedia monthlytraffic. | `&` 顯示正常、排行非空；修正 43d／5ae7；100 筆 exact parity。 未驗：390weighted/lift rightcolumns/horizontal scrolling notviewed；rowclick/tabperiod/select/frequency/details/methodopened notoperated；full100rows/footer notvisible | fixed 部分問題／整頁 pending |
| `/tech/` | `/home/deck/.t3/userdata/blog-release-43d1790-candidate-20261014/tech/` | tagtraffic reference for dense borderedtable/search only, not monthlytraffic/sparkline functionparity. | 入鏡未見重大視覺 blocker。 未驗：390listing andplugins/CDNbelowframe；desktoprightmostsuccessdates clipped bytablecontainer; horizontalscroll nottested；filter/search/methodopened/notviewedrestofpage；WCAGcontrastunknown LAB | fixed 部分問題／整頁 pending |
| `/relations/` | `/home/deck/.t3/userdata/blog-release-43d1790-candidate-20261014/relations/` | tagmultikindnewsgraph/zoom/ranking vs blogonlybodydirectlinks/fewobservednodes intentionaldifferentdata/controlscope. | 入鏡未見重大視覺 blocker。 未驗：graphhover/click/periodcontrols notoperated；390reciprocallistbelowframe andremainingrows；darkfineprintcontrast unknown/nodarktagreference；allbodyevidencecorrectness notprovedbyraster | fixed 部分問題／整頁 pending |
| `/blogs/gogojp-tw-535/` | `/home/deck/.t3/userdata/blog-release-43d1790-candidate-20261014/blog-profile-canonical-attempt3/` | tagmediaprofile orange/news/reportkeywords vs bloggreen/travel+verifiedwebsite/contentcollectionevidence. Canonicalslug fromrealAPI, notguessedname. | 入鏡未見重大視覺 blocker。 未驗：mobile metadataaccordionopened/provenance/tech andfollow/tabs/searchoperations；full50articlelist/footer/methodopened unseen；darkfineprint/WCAGunknown andnodarktagreference | fixed 部分問題／整頁 pending |
| `/blogs/gogojp-tw-535/#relations` | `/home/deck/.t3/userdata/blog-release-43d1790-candidate-20261014/blog-exchanges-canonical-attempt3/` | tagnewsreference relationtypes notidentical; blogdirectbodyproof/nonbodyseparated. DisabledcomparisonnotpopulatedB2acceptance. | 入鏡未見重大視覺 blocker。 未驗：body/nonbodyevidencedetailsclosed notactualviewed；390textsimilarity/method/topiclist below900frame partlyunseen；anchorintroaboveframe/stickyoffset notcompletelyseen；alllink/expand/graphactions/WCAGunknown | fixed 部分問題／整頁 pending |
| `/articles/?q=蛤蜊絲瓜` | `/home/deck/.t3/userdata/blog-release-43d1790-candidate-20261014/articles-search/` | tagarticlesref shows populatednewsfocuscards/periods; blogsearch uses metadataform andboundedempty state, notsameeventfeatures or samequeryfixture. | 只限最近 1,000 metadata、歷史正文關閉、搜尋 0 筆；F3 全文未驗收。 未驗：actualhistorical/bodyhit/fullindexedcorpus/readiness/coverage claims；nonempty results/snippets/id/version/evidence/perhitURL/malformedfailurestates；formsubmit/keyboard/tabs/menu/methodopened notoperated；darkfineprint/contrastunknown | fixed 部分問題／整頁 pending |

各目錄固定 `page-1-1280-light.png`、`page-2-390-light.png`、
`page-3-1280-dark.png`、`page-4-390-dark.png`；`capture-report.json` 附實際
resource gate 前後三站 3 樣本、load、private guard 與 PID/socket/build identity。
原 guessed slug `/blogs/gogojp.tw/` 為 404：0 圖，保持 missing／失敗證據；
canonical-attempt2 的 probe adapter 錯把 array 當 `.probes`，9 筆實測皆合格但
未啟動 browser，0 圖；後改同工具的測試接線，原檔保留。canonical-attempt3
採 API 已發布 `gogojp-tw-535` 200，沒有改產品程式或重建。

全文旗標仍關閉，F3 full-text 不因 bounded/off 空態可讀而通過；共同標籤與
文字相似亦維持關閉。344 個 contrast sample unknown，不稱 WCAG pass；
手機表格右欄／下方、展開方法與證據、hover／鍵盤／期間／權限／空與錯誤
狀態仍 pending。主要圖通過僅符合人類「先部署、逐頁 review 之後補」的
有限 candidate 視覺條件。原權威 24 項 pass0／fixed2／issues9／pending11／n/a-ui2
不變；不是全部 UI scope 完成。正式仍 green/gen9，切換需 babysit 核對 exact
command／fresh probe，本文件不授權切換。

B0 同 BUILD_ID 的 53 barrier／60 sequence 已通過；17 個 HTML/RSC/API/XML
200/no-store。100/100 排序、score、posts、blogs、matchingPolicy 相同，首頁
8 筆等於前 8 筆，原始證據 `.reviews/sm-build-9888ebf/blue43-http-parity-recheck-1791965198079.json`。
舊 9888 空排行先前審查及回滾紀錄一律保留，不冒称已完成正式重新驗收。

---


## 2026-10-14 標題顯示 source 修正：待同產物重拍

同一既有 Opus 5.5 作者 session `6e17a454-0623-4006-8aa4-f733dcde31a9` 完成
`&#038;` 等合法 numeric／hex 與常見 named entity 的單次顯示解碼；原始
Post／API title、文章 hash、搜尋／比對證據、列 ID／URL 皆不變。SSR/client
共用純 helper，React 繼續 escape 文字；未知、不合法與原型名稱保留原文，
不使用 HTML sink。版型、CSS、summary、privacy predicate 和 no-store 未改。

覆蓋首頁 lead／其他文章／右側最新文章及圖片 aria、ArticleListItem 共用列表、
TopicDetail 文章、BlogRelations 引用／共同標籤／文字相似的文章標題。
220 Node／140 SSR／web tsc 通過，包括真 HomePage、TopicDetailView 及圖片
aria 的合成 render oracle；這些不是 browser 或正式實際畫面。

作者原始 log：`/home/deck/.t3/projects/blog-observe-tw/.reviews/sm-build-9888ebf/title-entities-existing-opus-author.jsonl`
與同目錄 `title-entities-existing-opus-{followup,assertion-followup,format-test-followup}.jsonl`。
四份皆為相同 session、actual model `claude-opus-5-5`、success。
非作者 GPT-6.1 Sol 原始 source review／UTC／檔案 hashes：
`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/title-entities-independent-source-review.json`。
TE1 prototype 名稱、TE2 真 consumer／強制 aria oracle、TE3 格式空白測試均已關閉。

新 candidate 的首頁、文章列表、話題頁與引用明細需要以新 SHA／BUILD_ID 的
1280／390 畫面確認 `&` 正常顯示，並驗非空話題與 green 相符。沒有新增 capture，
不補造截圖、不提升任何整頁 pass；下方 gen8 regression／24項 pending scope 仍有效。


## 2026-10-14 gen8 功能回歸：已撤回部署，待修正版驗收

正式驗收（使用者代轉，UTC06:27）發現首頁共同話題與 `/topics/` 全部變空，
blue `/api/topics?days=30` 回 0 筆，green 同資料回 100 筆。已回滾 green／gen9，
正式 BUILD_ID `2ZIfs00KopZi_HHl8ahLU`；復原 HTTP receipt（UTC06:29）：
`/home/deck/.t3/projects/blog-observe-tw/.reviews/sm-build-9888ebf/topics-regression-rollback-1791959382159.json`。

9888 候選的 20 張圖／8 張 tag 參照與 GPT-6.1 Sol 原始看圖紀錄仍保留在下方，
但其 visible-pass **不能代表排行資料相容**。本次沒有新 capture，不能補造新圖或
稱修正版已通過 UI。首頁目前應列 issues；`/topics/` 維持 issues。最新權威 24 項為
**pass0／fixed2／issues9／pending11／n/a-ui2**，取代下方歷史的 fixed3／issues8；
舊 fixed 僅描述當時指定修正，不表示整頁功能通過。其他頁的全狀態仍未完成。

| route／狀態 | 發現／原因 | source 修正 | 正式／candidate 重驗狀態 |
| --- | --- | --- | --- |
| `/` 最近共同話題 | 9888 新 namespace 無法讀取既有證據，空狀態被誤當成正常；原圖不足以證明非空內容相容 | `5ae7ae8b5dc818a877fdc70c6d7036e670adb39b`；default 恢復實際舊 algorithm/version pair | rollback green 後 100 筆及首頁恢復；新 source 唯讀 home8 與 green 逐筆相同，仍待新 BUILD_ID 的 1280／390 圖與非作者 review，issues |
| `/topics/` 排行 | 同一回歸；HTTP200 不能代表既有話題可見 | 同上；未放寬 hash/predicate/no-store、未改正式資料 | source 同一 READ ONLY 交易 100／100 exact rows；新候選多筆／空／error／期間與手機仍待重驗，issues |

source reviewer：既有 GPT-6.1 Sol，原始 review／UTC／檔案 hashes：
`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/topics-policy-compat-independent-source-review.json`。
Opus 5.5 計畫採 immutable profile、production 新 namespace opt-in 拒啟，
完整 stop 回應：`/home/deck/.t3/projects/blog-observe-tw/.reviews/sm-build-9888ebf/topics-policy-regression-plan-opus-short.json`。
這兩項皆為 source review，**不算新的逐頁看圖完成數**。


## F3 搜尋資訊補齊：仍待新產物畫面

0a8e6f3之後的離線source補上歷史正文索引的partial／unavailable／short-query／off／未提供狀態、文章ID／比對版本／片段來源。UI仍只顯示240字內片段，不外送raw body/hash/token；metadata命中改為「公開資料相符」，不把blog名稱或tag誤稱title/summary。既有Opus作者與非作者Sol source複審原始證據在 `/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/search-coverage-opus-independent-final-review.json`；212 web node／128 SSR只驗原始碼與合成資料，不升route。

Mint重拍增加：`/articles/?q=蛤蜊絲瓜` 的indexed partial、off、short query、unavailable、舊gateway缺coverage／version、截斷與metadata／body分開，以及方法展開；新BUILD_ID與實際1280／390／dark圖仍missing。原24項權威狀態不變。其他source缺口與依賴見 [剩餘scope](remaining-scope-2026-10-13.md)。

## 最新 source 修正：待 Mint 重拍，既有狀態不提升

基底 `b96ef9b` 的離線品質批次：話題／歷史頁、話題排行及 BlogTopics 深色次要文字已由既有 Opus 5.5 session 修正，Sol 獨立 source 複審；舊 gen5 指定色對比約 4.10:1，新 zinc-400 同底預估 7.55:1。這不是新版全頁 contrast 或 WCAG pass。首頁 compact／Suspense 的新畫面、晚失敗 error boundary、舊圖缺 DNT/GPC、F4 新觀測、F3 真正文與 B2 狀態都待同產物重拍。

原始 source review 路徑：`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/frontend-opus-final-source-followup.json`（actual model／UTC／受審檔 hash），contrast 證據為同目錄 `dark-secondary-contrast-audit.json`；source-only 不填不存在的新 BUILD_ID、桌機／手機路徑，也不冒充看圖 review。前端 author 與 reviewer 是不同 instance。capture 新欄位只會在下次實際操作時生成，不回填舊 manifest。

權威24項仍 **pass0／fixed3／issues8／pending11／n/a-ui2**；全scope pending。完整重拍 route、1280／390、深淺色、資料量與 empty／error／權限狀態見 [Mint capture plan](mint-capture-plan.md)；方法、guard、私有資料與效能測試限制見 [本批 source 報告](mint-offline-quality-2026-10-13.md)。正式維持 green gen5，SM沒有建置或截圖。

## Mint 排隊：source 修正不等於新畫面通過

2026-10-13 本批 F4 passive fetch 接線、F3 partial body posting 索引及 B3 文件時序補正只有 source／mock／隔離 SQL 證據，沒有新的 BUILD_ID 或 capture；正式仍為 gen5 `4cc7bcd`。24 項的既有狀態不因這批程式碼變動而提升，缺少 DNT/GPC 或手機圖的舊證據仍缺件。

下一份 Mint 同產物候選須重拍：`/tech/` 多筆／少筆／unknown／failed／blocked／未觀測／空篩選／error、三個指定部落格的技術區塊、`/relations/` 與單站引用明細、`/articles/?q=蛤蜊絲瓜`、三個歷史 fallback 話題及 dark contrast。方法說明的收合、上下文來源、match version 及每個方向的文章／日期要分別看圖，不能以共享 component review 替代。

每批預估四張 PNG（1280／390、light／dark）合計約 1–8 MiB；這只是排程估計，實際以 manifest bytes 記錄。SM 不新增 capture；Mint 須先取得名額與隔離 readiness，再保存真實 DNT、GA/GTM network、SHA／BUILD_ID、截圖 hashes 和非作者 reviewer 原始 transcript。完整 route／重要狀態仍見下方權威表，不縮小 scope。

### 既有圖的真正離線複審（不提升現行版本狀態）

`/ranking/`、`/about/` 的 1280／390 圖與四張對應 tag 參考已由非作者 GPT-6.1 Sol 實際檢視（共八張）。受審舊 source SHA `b011873255f9bbf30c252df2ca65ead0ef1c306e`；review UTC `2026-10-13T08:32:05.437Z`，實際 image tool UTC `08:30:31.785Z`。原始 model receipt、圖片路徑／目前 hashes、raw transcript 及 11 項 pending inventory 都在 `/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/pending-ranking-about-offline-review.json`，不是只有模板或 Done 訊息。

可見首屏無新 blocker；手機 about 只見到作者與標籤區開頭，不能代替完整文件與互動檢查。舊 manifest 沒有 BUILD_ID、DNT/GPC 或 capture-time PNG hash；本次計算的檔案 hash 只能確認現在輸入，不能補造當時完整性。dark、現行／新 candidate、權限狀態仍待重拍，`error.tsx`／500 缺圖。兩個 route 保持 pending。

同一非作者另外實際看過 `/tags/`、`/api/`、`/api/status`、`/login/`、`/observe/opt-out/` 的五頁、20 張既有桌機／手機及 tag 參考圖。證據 `/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/pending-tags-api-login-optout-offline-review.json`，SHA-256 `24a1520465b2259aab890271de3d23871703dfabc580c0aa3bcc1e51e3a07c52`；model receipt UTC `08:33:27.082Z`，實際 view calls `08:33:40Z`／`08:33:52Z`。仍是 b011 舊圖與缺欄，沒有提升 route。舊 API status 手機的 path／用途截斷符合歷史 UI-B001，不能拿它當新候選修正的重驗；API inline code 斷字為 minor，其他可見首屏沒有新 blocker。`/my/`、admin／discovery 缺合法權限證據，沒有開圖或建立帳號；500 仍缺圖。

## 2026-10-13：root 獨立 gen5 驗收與 babysit 正式抽查（scope仍pending）

收到的外部原始 review：`/home/deck/.cache/youtube-ui-review/root-blog-candidate-review-1430.json`，22,758 bytes，SHA-256 `4dfc1549b1f10cb9949c7c6c2754349e7a9ca14c9d1da36d262837482de76374`（本輪再次核對相符）。原檔 auditUTC `2026-10-13T06:31:48.104984Z`，root 於台北14:44另核對 runtime green/gen5/4cc、切換UTC06:28:04.914、BUILD_ID `2ZIfs00KopZi_HHl8ahLU`；兩種時間分開，不改原檔。review model依外部原檔為 GPT-6.1 Sol，實際看過16張home/articles/topic/history fixture圖及6張tag參考，首屏沒有blocking；`candidateApproval=false`、`routeComplete=false`、`productionContentAccepted=false`。原檔未附本機可讀的raw model session，本ledger引用已交付JSON與人類轉達，不冒充本thread親自看圖。

- **當時P2仍待量測：**topic/history深色次要來源、日期、統計與同步文字偏暗；當時尚無數值contrast證據，不把這段歷史紀錄寫成已確認WCAG失敗或已修復。後續指定色的離線數值與source修正見本文件最新段落，現版畫面仍待重拍。
- **舊網路證據缺件：**既有capture counters為零GA/GTM，但原manifest沒有DNT／GPC觀測欄位；舊圖這兩欄仍unverified，不能由現在工具設定補造歷史。新的runner只讀實際document DNT／Sec-GPC與navigator值，DNT不足拒絕存圖；GPC true／false／null如實記錄。此工具修正只完成source review與mocks，尚未新增capture，也不關閉P2。
- **正式抽查（使用者轉達，不冒稱本thread執行）：**babysit UTC06:45，以內建opt-out檢查，GA請求0、ga-disable=true。首頁與`/tech/`桌機1280正常且HTML帶同BUILD_ID；no-store／DYNAMIC。首頁三次完整時間3.04／2.72／2.39s，在6.17s內。手機390的preview調寬逾時、沒有截圖，保持missing。使用者未提供該批截圖／網路artifact的絕對路徑，不捏造路徑或新增pass。
- **worker補證已存在：**獨立設定review `/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/worker-node-path-4cc7bcd-review.json`（model gpt-6.1-sol與raw session receipt於檔內）；最終交接 `/home/deck/.t3/projects/blog-observe-tw/.reviews/thaw-candidate/worker-runtime-final.json`，UTC06:42:26–06:43:26，PID1512645同cwd、7次至少60秒、NRestarts0。首次sharp失敗24次重啟與恢復檔均保留。UTC06:47本輪再查仍running／同PID／0restart，這是運行補證，不是UIpass。
- **F4仍未完成：**313站0detected／260unknown／53not-observed。已查出正文片段缺少技術線索與部分既有抓取入口未接observer；三站與完整HTML離線對照、source review詳見 [gen5診斷](f4-gen5-diagnosis.md)。不把offline detected寫成正式觀測，也不猜版本。

權威24項仍pass0／fixed3／issues8／pending11／n/a-ui2。全scope pending，正式桌機少量抽查與fixture首屏review均不能取代每route／狀態驗收。


## 2026-10-13 UTC06:28：同產物正式切換與補圖驗收

正式 green generation5，release `4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8`，BUILD_ID `2ZIfs00KopZi_HHl8ahLU`；切換 UTC `2026-10-13T06:28:04.914Z`。同產物未重建；blue427 保留。正式切換後 babysit 瀏覽器驗收尚待，不宣稱全部 UI 完成。權威 24 項的狀態仍為 pass0／fixed3／issues8／pending11／n/a-ui2。

交付索引 `/home/deck/.t3/projects/blog-observe-tw/.reviews/thaw-candidate/submission-manifest.json` 包含 **14 批／56 張 PNG／9 份獨立 review** 的絕對路徑、hash、1280/390 與深淺色、release SHA／BUILD_ID；索引本身不是 review。每份 reviewer JSON 的原始 model receipt／圖片工具呼叫／transcript 才是實際看圖證據。所有 capture 的 GA/GTM=0；API error 的四筆503明記 synthetic，非正式故障。最新的 green 真資料截圖已不只使用合成資料。

|補驗範圍|實際圖片與 manifest 目錄|獨立 review 證據|本批判定與限制|
|---|---|---|---|
|tech 橫捲終點|`/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech-table-right/attempt-4/`|同目錄 `independent-gpt61-table-review.json`；GPT-6.1 Sol，model receipt3100 UTC06:18:30.948，image call3129 UTC06:20:33.477|四圖無阻擋；sticky首欄仍可見、縮小、無page overflow。尚未實測長頁垂直sticky；不能把儲存格118px誤稱內容盒5.5rem實測。|
|tech 篩選零筆與API錯誤|`/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech-empty/`、`/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech-error/`|`/home/deck/.t3/userdata/blog-sprint-4cc7bcd/independent-gpt61-tech-empty-error-review.json`；GPT-6.1 Sol，model3185 UTC06:24:06.921，image3192 UTC06:24:20.317|八圖無阻擋；空篩選不冒充全站零筆；synthetic error顯示alert/retry而非零筆。未驗retry實際互動。|
|tech 313站真實資料首50筆|`/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech-green-production-data/`|同目錄 `independent-gpt61-green-publicdata-review.json`；GPT-6.1 Sol，model3185、image3229 UTC06:25:47.769|四圖無阻擋，可支持已審範圍有限公開。unknown不推測CMS、部分正文來源標示清楚；完整統計cards／分页footer不在這次捲動截圖範圍，不能冒稱看圖核對260/53。|

上述各目錄四圖固定為 `page-1-1280-light.png`、`page-2-390-light.png`、`page-3-1280-dark.png`、`page-4-390-dark.png`，manifest為 `capture-report.json`。共同原始 reviewer transcript：`/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T02-58-05-01a1317a-acd8-7ef1-b839-527ac8086981.jsonl`。已使用的 tag 參考仍見下文；dark tag reference未補，不宣稱精確dark parity。

刻意不同：本頁使用部落格被動技術觀測、部分覆蓋與unknown語意，非新聞流量排行；沿用 tag 的導航、TableScroller、zinc與已授權綠色重點色。failed/blocked保留上次成功、infra-only、全站零筆、完整鍵盤、方法展開、正式切換後瀏覽器與其他route全部重要狀態仍 pending。下方之前的「table-right待review」保留為時序記錄，以本節補證為準，不回寫舊artifact。


## 2026-10-13：4cc7bcd 候選圖片獨立審查（原始批次）

候選來源 SHA `4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8`、BUILD_ID `2ZIfs00KopZi_HHl8ahLU`、source tree `de1ca738a2e351895b4f354908142351e917b6f7`；畫面來自 repo 外隔離合成資料，並非正式資料驗收。各組皆 1280×900／390×900、light／dark 四張；本節只整合已完成的實際圖片審查，不把 capture 成功、source review 或 HTTP 200 當作 UI pass。權威主表仍是 **24 項：pass 0／fixed 3／issues 8／pending 11／n/a-ui 2**；`visible-pass` 只代表已看首屏，未提升任何整 route 狀態。正式部署與正式瀏覽器重驗由後續部署紀錄另行確認。

**目前 gate 取代下方歷史凍結語氣：**使用者核准的整頁 HTML baseline 為 UTC `2026-10-13T05:47:30Z–05:48:30Z`，每站五次、間隔三秒、DNT=1、無 cookie／cache-busting；median blog `3.085s`、tag `0.256s`、youtube `0.289s`，採 `max(2s, 2×median)`，故新 build／capture 門檻為 **blog 6.17s、tag 2s、youtube 2s**。這是公開 URL 的端到端 HTML response，包含 origin rendering、Cloudflare edge 與網路；不是精確的 origin render／SQL 單獨耗時，也不是 TTFB、瀏覽器完整資源載入時間或任意等待。原始核准收據 `/tmp/babysit/gate-baseline-receipt.md`；程式來源 `/home/deck/.t3/projects/blog-observe-tw/tools/homepage-gate-baseline.mjs`。全站含遠端 youtube **最多一個 build**；本站 single slot 0 與 `/proc` 不能證明遠端 idle，啟動前仍需 root 人工協調。load1≤12，build／capture 起始磁碟扣預算後≥40GiB、執行停止線30GiB；browser 全機最多兩個。已執行的舊批次保留原始 gate，不改寫成新 baseline。缺件只在最新 gate 與授權成立時小批重拍；沒有自動重拍或重新建置既有 4cc 產物。

### Reviewer、raw model 與逐圖證據

以下 JSON 是各 reviewer 即時 notes，文字 transcript 不是 raw model receipt；實際模型與圖片工具呼叫另連 raw session。文件整理者只親自讀了 home／articles／topic／history 的 16 張候選與六張 tag 參考，**其餘 F3／F4 結論引用另一 reviewer 的已驗 notes，未冒稱親自讀圖**。

| 範圍 | 實際 reviewer / UTC | Raw model 與圖片呼叫 | 即時結果／完整輸入 hash |
|---|---|---|---|
| home、articles、topic、history | gpt-6.1-sol；讀圖 UTC05:52:05.842Z、05:53:38.525Z；notes UTC05:55:26.384Z | `/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T13-12-51-01a133ad-8034-7e81-a619-c9d28bd4ff5f.jsonl`：turn_context line595 UTC05:45:18.448Z=`gpt-6.1-sol`；候選 view_image calls691/727；tag references call475 UTC05:29:31.700Z（前置model receipt460）。以這些實際路徑確認為本人，不以名字提及核模型。 | `/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/review-4cc7bcd.json`；`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/review-4cc7bcd.transcript.txt`（可見審查文字備忘）；16 PNG hash 與 manifest 全相符。初寫 JSON 的泛稱 inherited model，由本列 raw receipt 核正為 gpt-6.1-sol。SQL 不在本人 UI review 範圍。 |
| F4 `/tech/` | gpt-6.1-sol；UTC05:34:59.071055Z | `/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T02-58-05-01a1317a-acd8-7ef1-b839-527ac8086981.jsonl`：model receipt2834 UTC05:33:47.437Z；view call2843 UTC05:34:00.879Z。 | `/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech/attempt-2/independent-gpt61-tech-review.json`；四張候選與 tag 來源表參考，visible main state 無 blocker，完整狀態仍 pending。 |
| profile／profile 技術區 | gpt-6.1-sol；UTC05:37:12.670756Z | 同一絕對 raw session `/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T02-58-05-01a1317a-acd8-7ef1-b839-527ac8086981.jsonl`，model receipt2834；view call2898 UTC05:36:02.059Z。 | `/home/deck/.t3/userdata/blog-sprint-4cc7bcd/blog/attempt-2/independent-gpt61-profile-review.json`；八張輸入。profile 首屏 visible-pass；名稱含 blog-tech 的圖沒有呈現完整技術卡，**此初批技術區當時 missing-visible-tech-section**；後續 profile-tech-open/attempt-2 完整卡片補證見下節。 |
| F3 profile／引用摘要 | gpt-6.1-sol；UTC05:38:05.940854Z | `/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl`：model receipt3316 UTC05:36:46.005Z；view calls3333/3342 UTC05:37:08.104Z／05:37:14.444Z。 | `/home/deck/.t3/userdata/blog-sprint-4cc7bcd/f3-independent-sol-review/review.json`；八張輸入。雙向引用日期與非正文／未開啟狀態可見；details 未展開，原文 URL／anchor／版本／脈絡仍待驗。 |
| F3 `/relations/` graph | gpt-6.1-sol；UTC05:52:19.488803Z | `/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl`：model receipt3587 UTC05:50:32.313Z；view call3599 UTC05:50:56.536Z。 | `/home/deck/.t3/userdata/blog-sprint-4cc7bcd/relations/independent-sol-review/review.json`；四張 candidate＋兩張 tag graph 參考。可見三節點／正文箭頭與期間控制；1280淺色兩節點標籤相接屬 nonblocking，方法／下方排行／互動仍待。 |

### 畫面範圍與待補狀態

| route／模板 | 4cc 可見範圍 | 尚待補證 | 權威整 route 狀態 |
|---|---|---|---|
| `/` | 四圖 visible-pass：桌面三欄、手機文章優先，卡片／長 fixture 標籤未見溢出；稀疏 word cloud 與空排行照實。 | 正式真內容、多筆／empty／error／登入、導覽與互動回歸；合成四文不能代表正式資料密度。 | fixed，原指定修正範圍不擴大 |
| `/articles/` | 四圖 visible-pass：搜尋列與四筆文章可讀、手機 URL 換行；方法初始收合。 | 真實搜尋／歷史正文召回、matchVersion、無結果／error／撤下後下一讀、送出與鍵盤。 | fixed，新增搜尋狀態仍待補 |
| `/topics/[id]/` 近期與歷史 fallback | 兩模板八圖 visible-pass：390 文章先於站卡；歷史文章及「不代表目前命中」可見；兩寬兩色方法皆初始收合，不搶文章首屏。 | 方法展開／鍵盤、時間切換、更多／空／error／404、共享標籤與代表圖、正式內容；舊 UI-H01 的初始收合範圍已有候選圖，整 route 不升 pass。 | issues |
| `/blogs/[slug]/` 首屏及引用區 | profile／F3摘要及後續正文、Blogroll展開四圖各有非作者可見審查；方向／日期／短脈絡／ID／fixture版本可見。 | 多連結截斷、sidebar／comment、ready／unavailable／missing、文字相似／empty／error、方法／鍵盤／正式真資料。 | issues |
| `/blogs/[slug]/` 技術區 | 初批 blog-tech 未見完整卡保留為歷史缺件；新 profile-tech-open/attempt-2 四圖有完整卡與非作者可見審查。 | failed／blocked 保留舊成功、unknown／not-observed／503／flag-off、optional error、真實來源證據及完整互動。 | issues，全狀態仍待補 |
| `/tech/` | 初批四圖主狀態已有可見審查；tech-table-right/attempt-4 另四圖 captured-unreviewed，獨立 review待提交。 | 新表右側／390橫捲圖的實際審查、sticky與操作、方法區、篩選／分頁／empty／error／flag-off／歷史失敗／正式重驗。 | pending |
| `/relations/` | 其他 reviewer 已實看四張 candidate＋兩張 tag graph。三節點正文圖可見，1280淺色兩節點標籤相接屬 nonblocking；只限 visible scope。 | 首屏下方排行／雙向日期／方法、節點／期間／鍵盤／控制互動、多節點／empty／error；舊 manifest 缺新baseline欄不回填。 | issues |
| 其餘 route／權限／錯誤模板 | 沿用權威主表歷史證據；本輪沒有補圖。 | 與主表及歷史缺件清單相同；登入／my／admin 需既有合法授權，不以匿名 redirect 或裸429代替。 | 原狀 |

### 06:04 profile 展開狀態補證與 06:19 tech 表待審

本補證只引用其他獨立 reviewer 已實際讀圖的記錄，文件整理者未重新冒稱親讀這12張圖。來源／BUILD_ID 仍為 `4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8`／`2ZIfs00KopZi_HHl8ahLU`；1280×900／390×900、light／dark，各狀態四張。完整輸入／PNG hash／DOM與interaction metrics：`/home/deck/.t3/userdata/blog-sprint-4cc7bcd/independent-gpt61-profile-states-review.json`，notes UTC `2026-10-13T06:04:14.752208Z`；12張 hash 均核對實檔一致。

實際模型 `gpt-6.1-sol`，raw `/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T02-58-05-01a1317a-acd8-7ef1-b839-527ac8086981.jsonl`：model receipt line3044、UTC `2026-10-13T06:02:36.721Z`；actual image calls3056/3066、UTC `06:03:01.464Z`／`06:03:11.587Z`。這份 JSON 是可見審查 notes，並非 raw model transcript；產品 UI 作者 Opus 與此 reviewer 不同。三份 capture report 均 closed=true、GA=0、GTM=0，合成隔離資料不等於正式 publisher 證據。

| 狀態 | 已驗可見範圍 | 仍待補（不提升整 route） |
|---|---|---|
| profile-tech-open/attempt-2 | 四圖完整技術卡可見：WordPress7.1.3 有 generator 證據，Jetpack 版本 unknown 有原因；首頁／文章 HTML partial scope、成功／嘗試／觀測日期分開。390 sidebar 的 visible button 展開有 interaction metrics；文字在寬度內換行。初批 blog-tech 未看到卡片的缺件只在此狀態補上。 | 歷史 failed／blocked 保留舊結果、unknown／not-observed／503／flag-off、收合返回、低信心基礎設施與方法連結、正式真資料。 |
| profile-evidence-open | 四圖可見兩筆正文 proof：方向、來源文章／target link、article ID、各自發文與觀測日期、fixture matchVersion、正文位置與短脈絡。兩方向日期不同，不冒充同時互動；沒有全文／私人身份。 | 多連結／20筆截斷、error／legacy 缺 provenance、shared tags ready／unavailable、正式原站證據與完整操作。 |
| profile-non-body-open | 四圖可見單筆 Blogroll：ID／來源／目標／日期／版本／位置，明說不計正文引用；shared tags off 不代表無資料、文字相似尚未分析不補0分。下方單一方法區初始收合可見。 | sidebar／comment 位置、多連結與截斷、方法展開／鍵盤、shared tags ready／unavailable、正式資料。 |
| tech-table-right/attempt-4 | 四圖 capture 完成，UTC `06:18:50.821Z–06:19:06.952Z`、closed=true、GA/GTM=0；page／presave 真 inventory 為 browserRoots=1、chromiumProcesses=6，after回0。**captured-unreviewed，獨立讀圖結果待另一 reviewer 提交。** | 表右側內容／mobile橫捲／sticky／viewport顯示與操作必須以其實際圖片 review 判定，不先填 visible-pass；`/tech/` 仍 pending。 |

**Browser inventory 證據限制與修正：**較早含上述 profile 三批的 page／presave 記 browserRoots=0、chromiumProcesses=0，是 headless shell argv／basename 漏計，不能單憑這個0宣稱全機 browser 配額已證明；原始 report 與既有圖保留，不回填數字，也不抹掉實際可見審查。後續先核 `/proc/<pid>/exe`，真診斷顯示六個同 PPID 樹程序都 argCount=1／hasType=false，因此改依已驗 candidate 祖先樹計 topmost root。有 type 卻缺父仍保守另算 root；duplicate PID、cycle、父 startTicks 晚於子或缺時間證據 fail closed，診斷不含完整參數或 env。Root 回報 PPID 邏輯獨立 review 與52項工具測試通過；這是工具證據，不是 UI pass。最新 baseline **6.17／2／2 秒**保留。

失敗 attempts 保留但不計 pass：`/home/deck/.t3/userdata/blog-sprint-4cc7bcd/profile-tech-open/capture-report.json`（view_state_not_visible、1圖）；`/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech-table-right/capture-report.json`（同錯誤、2圖）；`/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech-table-right/attempt-2/capture-report.json` 與 `/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech-table-right/attempt-3/capture-report.json`（ambiguous_browser_roots、各0圖、closed=true；attempt-3有真安全程序診斷）。新 attempt-4 不替失敗批次補造成功。

### 本輪 candidate artifacts（全部絕對路徑）

四圖列順序固定為桌面淺色／手機淺色／桌面深色／手機深色；各 manifest 含 capture UTC、真 SHA／BUILD_ID、PNG SHA-256、gate、observed theme 與 browser close。圖片仍保留 `captured-unreviewed` 原值；審查結論記在 reviewer notes，不覆寫 capture 原檔。

| scope | 1280 light | 390 light | 1280 dark | 390 dark | 原 capture manifest |
|---|---|---|---|---|---|
| home | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/home/attempt-2/page-1-1280-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/home/attempt-2/page-2-390-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/home/attempt-2/page-3-1280-dark.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/home/attempt-2/page-4-390-dark.png) | [manifest](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/home/attempt-2/capture-report.json) |
| articles | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/articles/attempt-2/page-1-1280-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/articles/attempt-2/page-2-390-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/articles/attempt-2/page-3-1280-dark.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/articles/attempt-2/page-4-390-dark.png) | [manifest](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/articles/attempt-2/capture-report.json) |
| topic | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/topic/attempt-2/page-1-1280-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/topic/attempt-2/page-2-390-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/topic/attempt-2/page-3-1280-dark.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/topic/attempt-2/page-4-390-dark.png) | [manifest](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/topic/attempt-2/capture-report.json) |
| history | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/history/attempt-2/page-1-1280-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/history/attempt-2/page-2-390-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/history/attempt-2/page-3-1280-dark.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/history/attempt-2/page-4-390-dark.png) | [manifest](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/history/attempt-2/capture-report.json) |
| profile | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/blog/attempt-2/page-1-1280-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/blog/attempt-2/page-2-390-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/blog/attempt-2/page-3-1280-dark.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/blog/attempt-2/page-4-390-dark.png) | [manifest](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/blog/attempt-2/capture-report.json) |
| profile-F3 | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/blog-relations/page-1-1280-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/blog-relations/page-2-390-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/blog-relations/page-3-1280-dark.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/blog-relations/page-4-390-dark.png) | [manifest](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/blog-relations/capture-report.json) |
| tech | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech/attempt-2/page-1-1280-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech/attempt-2/page-2-390-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech/attempt-2/page-3-1280-dark.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech/attempt-2/page-4-390-dark.png) | [manifest](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech/attempt-2/capture-report.json) |
| profile-tech-missing | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/blog-tech/page-1-1280-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/blog-tech/page-2-390-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/blog-tech/page-3-1280-dark.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/blog-tech/page-4-390-dark.png) | [manifest](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/blog-tech/capture-report.json) |
| relations-visible-scope | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/relations/attempt-2/page-1-1280-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/relations/attempt-2/page-2-390-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/relations/attempt-2/page-3-1280-dark.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/relations/attempt-2/page-4-390-dark.png) | [manifest](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/relations/attempt-2/capture-report.json) |
| profile-tech-open-visible | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/profile-tech-open/attempt-2/page-1-1280-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/profile-tech-open/attempt-2/page-2-390-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/profile-tech-open/attempt-2/page-3-1280-dark.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/profile-tech-open/attempt-2/page-4-390-dark.png) | [manifest](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/profile-tech-open/attempt-2/capture-report.json) |
| profile-evidence-open-visible | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/profile-evidence-open/page-1-1280-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/profile-evidence-open/page-2-390-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/profile-evidence-open/page-3-1280-dark.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/profile-evidence-open/page-4-390-dark.png) | [manifest](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/profile-evidence-open/capture-report.json) |
| profile-non-body-open-visible | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/profile-non-body-open/page-1-1280-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/profile-non-body-open/page-2-390-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/profile-non-body-open/page-3-1280-dark.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/profile-non-body-open/page-4-390-dark.png) | [manifest](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/profile-non-body-open/capture-report.json) |
| tech-table-right-captured-review-pending | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech-table-right/attempt-4/page-1-1280-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech-table-right/attempt-4/page-2-390-light.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech-table-right/attempt-4/page-3-1280-dark.png) | [PNG](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech-table-right/attempt-4/page-4-390-dark.png) | [manifest](/home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech-table-right/attempt-4/capture-report.json) |

Tag 原始參考（capture SHA 未保留則 unknown；本輪只有 light tag 圖，不宣稱 dark parity）：

- `/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/tag-home-1280.png`
- `/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/tag-home-390.png`
- `/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/tag-articles-1280.png`
- `/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/tag-articles-390.png`
- `/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/tag-topic-detail-1280.png`
- `/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/tag-topic-detail-390.png`
- `/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/tag-blog-detail-1280.png`
- `/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/tag-blog-detail-390.png`
- `/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/tag-blogs-1280.png`
- `/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/tag-blogs-390.png`
- `/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/tag-relations-1280.png`
- `/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/tag-relations-390.png`

非畫面附證（不計入 UI pass）：baseline 工具 source review `/home/deck/.t3/userdata/blog-sprint-4cc7bcd/relations/independent-sol-review/gate-source-review.json`；production／candidate五次測量的獨立證據 review `/home/deck/.t3/userdata/blog-sprint-4cc7bcd/performance-independent-sol-review/review.json`，原 artifact `/home/deck/.t3/projects/blog-observe-tw/.reviews/thaw-candidate/performance-1791870920092.json`。其 median 只描述 production CDN/TLS 與 candidate loopback 的觀測耗時，不是隔離 SQL speedup／population p95，也不證明 UI、正式部署或 collector／B3 on 狀態。

外部圖片／字體／script 被 capture default-deny 阻擋；favicon fallback 或無外圖不能直接判產品缺陷。可見審查不證明 WCAG 數值對比、sticky／橫捲、方法展開、全部長頁與所有重要狀態。以下舊凍結與舊 SHA 記錄保留作歷史，不作當前禁止 capture 的依據。

**權威盤點：24 項＝22 個 UI route／錯誤模板＋2 個 n/a-ui端點。pass 0；fixed 3（final candidate已驗且已部署，正式瀏覽器重驗待）；issues 8；pending 11；n/a-ui 2。** 下方「權威route主表」是唯一目前狀態；附錄批次表只保留證據與歷史，不能作另一套通過清單。

歷史基底／首次完整正式browser已review SHA：`b011873255f9bbf30c252df2ca65ead0ef1c306e`（git fetch origin後確認）。GPT-6.1 Sol 已由本thread raw harness turn_context核驗（A line330、B line8，皆model=gpt-6.1-sol）；review-a實際讀圖UTC `2026-10-12T19:23:04Z`；review-b UTC `2026-10-12T19:23:27Z`；獨立Opus actual stream model `claude-opus-5-5`，Read16張來源圖，UTC `2026-10-12T19:23:49Z`。最終候選 `42711cf18c452b406904af6000ccbf88a1ff6102`、BUILDID `GOv8HpPOwOSxlwvjwd6FB` 已完成三scope獨立本機實際讀圖review；2026-10-12T20:19:52.889Z已切blue generation4。前次正式瀏覽器capture因當時TTFB>2秒暫停；本輪只離線review，沒有新HTTP測量，不能把舊數字當作目前負載。正式HTTP verification由root進行；HTTP檢查不代替browserretest。7a89候選敘述僅歷史。

獨立 Playwright：DNT HTTP/navigator=1、導航前route阻擋GA/GTM/doubleclick，兩站localStorage optout=1，serviceWorkers block。正式blog favicon正常載入，GA完成外送=0；完整逐頁UTC/inputScreens/SHA/model/參考圖/findings皆在[batch-a review](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/review-a.json)及[batch-b review](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/review-gpt.json)，[Opus模型及讀圖證據](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/opus-evidence.json)。截圖全repo外私有目錄、無個資，未操作OAuth／新增帳號／權限。

精確viewport補證：captureJSON僅存width而沒有height；A runner `capture.mjs`設定1280×800／390×844，B `capture.cjs`設定1280×900／390×900；本次以既有PNG IHDR核對pass1/issues7全部相關截圖相符。各批次高度不同；使用者硬規格僅指定寬1280/390，沒有指定高度800，故高度不同不算違反要求；如實記錄、不誤標800。原始log只抽本agent/model/讀圖calls，不輸出raw全文或secret。

## 歷史：2026-10-13 凍結批次待重拍清單（已由頂端4cc實際圖片證據接續）

本輪 base `origin/main`＝`6f47dda9204656a7d291bbdb699dd7560b9a0b88`。仍為 **24 項，pass 0／fixed 3／issues 8／pending 11／n/a-ui 2**；本段沒有替任何 route 升級狀態。所有新增畫面只有實際 React SSR 與 source review，沒有當版 desktop/mobile 截圖或 BUILD_ID。正式版本沒有切換。缺少適用圖片的狀態一律 missing／待重拍，不能引用舊 SHA 圖片宣稱修正已驗。

| route / state | 原始碼與離線證據 | 解凍後待重拍（1280／390、淺／深色） | 目前狀態 |
|---|---|---|---|
| `/tech/` | Opus 作者 `.reviews/f4-offline-ui/opus.jsonl`；獨立 Sol `.reviews/b0-f4/f4-independent-source-review.md`。後端 `1fe9ec8`；UI SHA `35780254df64ff396884263f28dd898f3802bf9a`（source review，非 build）。 | detected／unknown／failed／blocked／not-observed；旗標 off 404、gateway 503、過濾無結果、多／少筆、截斷與分頁；橫捲固定首欄／表頭與縮欄。 | pending，missing 新圖 |
| `/blogs/[slug]/` 技術區 | 同 F4 reviewer；optional 錯誤不拖垮 profile，失敗後的最後成功分開顯示。 | 無觀測、上次成功＋本次失敗、unknown 版本、有明確版本；來源 Alina／Carol／timdream 需真實既有輸入，fixture 不能冒充。 | issues，待重拍 |
| `/blogs/[slug]/` 引用區 | Opus 作者 `.reviews/f3-offline-ui/opus.jsonl`；獨立 Sol `.reviews/b0-f4/f3-independent-ui-source-review.md`；修訂另保留 `revision-opus.jsonl`／`final-opus.jsonl`；最後 source SHA `35780254df64ff396884263f28dd898f3802bf9a`。 | 正文與非正文各多／少／空，雙向不同日期；共標籤 off／unavailable／empty／ready；畸形回應局部錯誤；展開文章 ID／版本／脈絡。 | issues，待重拍 |
| `/relations/` | 同一份 F3 source review；圖只畫正文連結，不畫共詞／相似。 | 多／少／空、graph error、雙向不同年代與方法收合；不得用 source review 推論 canvas/手機呈現。 | pending，待重拍 |
| `/articles/` 搜尋 | 歷史正文 guarded recall `6f47dda`；18169 fixture 1,002 篇／15 checks，未測正式成本。 | 蛤蜊絲瓜真實文章／短片段／matchVersion；無結果、錯誤、舊文章召回。 | fixed 的舊範圍不擴大；新狀態待重拍 |
| `/topics/[id]/` | 方法區移入 details 的 `ae5f5f3` 與 25 SSR tests；既有歷史 fallback 圖只證舊 SHA。 | 多／少／歷史 fallback／無證據／錯誤；方法預設收合、首屏文章優先。 | issues，待重拍 |
| 其他既有 pending route / 重要狀態 | 權威主表的各自原始 log／缺圖原因保留。 | 導覽全頁回歸；登入／my／admin 僅既有合法帳號，無 session 即 missing；錯誤頁不以裸 429 代替。 | 維持原狀，沒有抽樣豁免 |

原始 log 均位於 gitignore 私有目錄；獨立 reviewer 的 raw harness model receipt、UTC、讀取 calls 寫在上述 review 記錄，不以文件作者自述替代模型證據。截圖仍必須放 repo 外；本輪沒有 capture、正式 probe、合成 GA、建置或新增大檔。解除凍結後依 `docs/f3-f4-thaw-release-plan.md` 一次候選建置驗收；若未過，不切正式流量。

## B3 話題接線的 source review 補充（2026-10-13；非畫面通過）

範例仍為 `/topics/旅行/` 及歷史 fallback 模板；使用 mock，不產生新話題或截圖。前端作者 **claude-opus-5-5**：`/home/deck/.t3/projects/blog-observe-tw/.reviews/b3-topic-wiring/ui-opus.jsonl`，修訂為 `ui-fix-opus.jsonl`／`ui-types-opus.jsonl`。獨立 reviewer **GPT-6.1 Sol**：`/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-f4/b3-topic-ui-independent-review.md`（含 UTC、來源雜湊、實際 model receipt、原始 transcript 路徑）。受審基底 `104da1f`，前端修正 commit `ee81c9d`、後端接線 `3bfc5f6`；改動檔案 hash 另見該紀錄。未有 build／BUILD_ID。

採納 URL dot-segment identity 驗證、區分 JSON 與瀏覽器圖片請求，以及型別縮窄修正。保留 tag component 風格與品牌綠色；上位／相關／別名是部落格頁補充資料，不改已存在文章的優先順序或建立話題頁。代表圖固定 64px、lazy 原生 img，避免額外經 Next optimizer 回源；Biome 的 noImgElement 是已評估保留的警告，不代表完成影像效能實测。沒有新的桌機／手機／深色截图，當前頁面狀態仍 **issues／待重拍**，不可升成 pass。

## 歷史：接續 104da1f 的解凍後重拍與磁碟預算

本批只做 source review 與 mock／既有隔離 DB 測試。**凍結尚未解除，以下均未執行**，即使估算低於 500 MB 也不能開始 capture。route 主表狀態不因 source 通過而升級；仍須當版 SHA／BUILD_ID 的桌機1280、手機390、淺色／深色截圖與非作者 reviewer transcript。

| 順序／route | 當版必拍的重要狀態 | 預算狀態數（每狀態4張） | 來源與差異核對 |
|---|---|---|---|
| 1 `/tech/` | 五種coverage狀態、多筆／少筆、篩選空、旗標off、API錯誤／截斷；狀態可同一fixture涵蓋 | 8 | tag來源／流量列表參考；首欄固定縮小、表頭、nowrap、內部橫捲 |
| 2 `/blogs/<slug>/` 技術區 | 有證據、unknown版本、blocked保留舊成功、optional錯誤 | 4 | tag來源頁sidebar；Alina/Carol/timdream需真實可追溯輸入 |
| 3 `/blogs/<slug>/` 引用區 | 雙向不同日期、同篇多URL、blogroll另列、共標籤off／empty／ready／unavailable、局部錯誤 | 5 | tag來源頁；合成樣本不可當正式gojp ownership驗收 |
| 4 `/relations/` | 多／少／空或error，雙向日期與圖例 | 3 | tag關係圖；只畫正文直接連結，不把共詞叫交流 |
| 5 `/topics/<label>/` | 共用標籤off、分類／相關詞／alias、無圖／有授權圖、獨立missing／unavailable、歷史fallback與malformed DTO | 6 | tag話題頁；手機文章優先，一份方法details；上游關係不是blog文章證據 |
| 6 `/articles/?q=…` | 蛤蜊絲瓜／歷史召回、無結果、錯誤、撤下後下一讀 | 4 | tag文章列表；顯示上下文來源與matchVersion |

首批共 **30個狀態、最多120張**（同一fixture覆蓋多狀態時可減張數，但每項仍記錄對應input）。`/topics` 的既有薄頁、歷史及所有其他 pending route／權限／錯誤狀態仍依主表全部 review，不因首批結束免驗。完整22個 UI 模板暫編列最多90個狀態＝360張；實際case manifest若增加狀態，先更新預算，不擅自降覆蓋率。

估算依據：只對既有 repo 外 `batch-a`、`batch-b`、`batch-final-42711cf` 的 PNG 做檔案大小統計，沒有開瀏覽器。113張合計11.8MiB，中位88.5KiB，最大0.509MiB。採保守每張0.6MiB，另留JSON/transcript與50%餘裕：

- 首批：120×0.6＋16＝88MiB，再×1.5，向上預留 **160MiB**。
- 完整清單：360×0.6＋32＝248MiB，再×1.5，向上預留 **384MiB**（已含首批，不相加）。
- 不錄影、不存 HAR response body／trace zip；沒有必要不產生這些大檔。超過估算時停止並重算，不能刪舊截圖／review／backup來換空間。
- 這是 screenshot／review artifact 預算，**不包含 Next建置、release拷貝、資料庫或備份**；那些仍須解凍後單獨盤點，而且完成後保留10GiB以上。不得用384MiB估計冒充整個部署容量。

解凍通知前不產生任何新capture；解凍後仍先核對全站最多2個browser、最多1個build、load≤12及正式首頁TTFB≤2秒，優先candidate，DNT=1且啟動前阻擋GA/GTM。若load或任何guard不符，停止capture，繼續source工作。所有真實事件與gate測量當下記錄，不補造歷史時間或不存在的檔案。

## 權威 route 主表

|route|example URL / state|reviewer/model + UTC|viewport（實際）|原始reviewer log provenance|reviewedSHA|desktop1280 screenshotPath|mobile390 screenshotPath|state/log/referenceScreens|tag偏離/理由|issues/未驗狀態|fixCommit|retestSHA/screenshots|status|
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| / | https://blog.observe.tw/ | gpt-6.1-sol（raw receipt1194 UTC2026-10-12T20:16:09.312Z）；actual image review20:18:04–20:18:22Z | 1280×900；390×900 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl:1194) actualmodel=gpt-6.1-sol；tag讀圖1252，candidate讀圖1269/1284/1293；[即時notes](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/reviewer-original-notes.json)非model response JSON。歷史b011/7a89原始log保留附錄。 | 42711cf18c452b406904af6000ccbf88a1ff6102（candidate實際review；目前正式已部署同SHA） | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/home-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/home-390.png | [最終候選逐頁notes](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/reviewer-original-notes.json)；tag referenceScreens與所有state inputScreens在notes；[capture+viewport+network](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/capture.json) | 綠色、部落格標籤與文章資訊是授權品牌實體差異；tag新聞圖示字雲不套用blog一般標籤。 | 字雲兩寬沒有重疊或頁面溢出。首頁初載等待5秒：RSC/Next-Router-Prefetch=0；點可見全部文章連結，發生1筆RSC（?_rsc）且0 document navigation，client navigation有效。 只涵蓋指定prefetch/client-nav、header搜尋、status文檔表修正；其他empty/error/authenticated/deepstate未齊，不算整route pass。正式瀏覽器retest尚待；前次因TTFB>2秒停止，本輪只離線review。  4cc：四張初始首屏 visible-pass；正式／多筆／empty／error／互動仍待。 | 7a89af2d2bec4f4246d606a3f84291f8f3a21744（修正）；最終release 42711cf18c452b406904af6000ccbf88a1ff6102 | final candidate 42711cf18c452b406904af6000ccbf88a1ff6102；BUILDID GOv8HpPOwOSxlwvjwd6FB；UTC20:17:43–20:18:15Z；/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/home-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/home-390.png；2026-10-12T20:19:52.889Z blue generation4已部署；正式HTTP verification由root進行，無正式browserretest。  4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8／BUILD_ID2ZIfs00KopZi_HHl8ahLU；完整四寬色图、rawmodel與UTC見頂端4cc節（非正式重驗）。 | issues（gen8 話題功能回歸；待新 candidate） |
| /articles/ | https://blog.observe.tw/articles/ | gpt-6.1-sol（raw receipt1194 UTC2026-10-12T20:16:09.312Z）；actual image review20:18:04–20:18:22Z | 1280×900；390×900 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl:1194) actualmodel=gpt-6.1-sol；tag讀圖1252，candidate讀圖1269/1284/1293；[即時notes](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/reviewer-original-notes.json)非model response JSON。歷史b011/7a89原始log保留附錄。 | 42711cf18c452b406904af6000ccbf88a1ff6102（candidate實際review；目前正式已部署同SHA） | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/articles-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/articles-390.png | [最終候選逐頁notes](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/reviewer-original-notes.json)；tag referenceScreens與所有state inputScreens在notes；[capture+viewport+network](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/capture.json) | blog本頁有搜尋表單，手機header預設icon合理，tag新聞事件卡與blog文章列表是實體差異。 | 390 header正常顯示wordmark+搜尋icon。點搜尋icon後wordmark收起，搜尋輸入框可填完整Playwright readonly review且focus=true；寬度可用，沒有整頁溢出。1280導覽與文章正常。未submit，故實際搜尋結果不在此範圍。 只涵蓋指定prefetch/client-nav、header搜尋、status文檔表修正；其他empty/error/authenticated/deepstate未齊，不算整route pass。正式瀏覽器retest尚待；前次因TTFB>2秒停止，本輪只離線review。  4cc：四張列表首屏 visible-pass、方法收合；真搜尋／歷史召回／error／互動仍待。 | 7a89af2d2bec4f4246d606a3f84291f8f3a21744（修正）；最終release 42711cf18c452b406904af6000ccbf88a1ff6102 | final candidate 42711cf18c452b406904af6000ccbf88a1ff6102；BUILDID GOv8HpPOwOSxlwvjwd6FB；UTC20:17:43–20:18:15Z；/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/articles-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/articles-search-open-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/articles-1280.png；2026-10-12T20:19:52.889Z blue generation4已部署；正式HTTP verification由root進行，無正式browserretest。  4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8／BUILD_ID2ZIfs00KopZi_HHl8ahLU；完整四寬色图、rawmodel與UTC見頂端4cc節（非正式重驗）。 | fixed |
| /blogs/ | https://blog.observe.tw/blogs/ | GPT-6.1 Sol / 19:23:04Z  本輪獨立claude-opus-5-5，證據整理UTC2026-10-12T21:39:31Z；| 1280×800；390×844 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T02-58-05-01a1317a-acd8-7ef1-b839-527ac8086981.jsonl:330)；turn_context model=gpt-6.1-sol，讀圖call lines615/631/639/661/692/718/744/753。review-a.json為即時人工紀錄，非raw transcript。  [本輪實際Read收據](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-a/opus-review-verified.json)／[原始Opus transcript](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-a/opus-review.jsonl)；20個image blocks，result line103 success/end_turn。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-blogs-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-blogs-390.png | batch-a cases blogs,blogs-empty,blogs-few：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/review-a.json) | 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | 1280四統計卡、390兩欄統計；filter wrap、nowrap表內捲動，favicon可見。首欄/sticky scroll互動待驗。；真實q無結果，明確0筆與沒有符合條件；不誤顯預設313筆。；真實herbert查詢1筆，手機首欄縮略仍有名稱；無橫溢出。  離線Opus發現390短名Herbert Lui仍截斷、首屏僅兩欄；欄寬隨多/少/空資料改變。舊b011觀察，待新candidate確認；不得用第二行修正。 | — | — | issues |
| /blogs/[slug]/ | https://blog.observe.tw/blogs/herbertlui.net/ | GPT-6.1 Sol / 19:23:04Z  本輪獨立claude-opus-5-5，證據整理UTC2026-10-12T21:39:31Z；| 1280×800；390×844 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T02-58-05-01a1317a-acd8-7ef1-b839-527ac8086981.jsonl:330)；turn_context model=gpt-6.1-sol，讀圖call lines615/631/639/661/692/718/744/753。review-a.json為即時人工紀錄，非raw transcript。  [本輪實際Read收據](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-a/opus-review-verified.json)／[原始Opus transcript](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-a/opus-review.jsonl)；20個image blocks，result line103 success/end_turn。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-blog-many-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-blog-many-390.png | batch-a cases blog-many：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/review-a.json) | 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | Herbert Lui50篇，1280來源/內文卡置右、390details收合；文字雲不重疊、原站與作者來源清楚。少筆detail/empty搜尋/denied尚待驗。  離線Opus的舊圖P3：少詞文字雲字級偏大、文章meta重複、顯示50篇與總數91篇的範圍文案待釐清；不宣稱現行回歸。  4cc profile與F3摘要依其他 reviewer notes可見；技術完整卡missing、evidence details與互動待補。  後續profile技術／正文／Blogroll展開12圖可見範圍已審（非本人讀圖）；多資料/error/正式與互動仍待，完整notes見頂端06:04補證。 | — | —  4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8／BUILD_ID2ZIfs00KopZi_HHl8ahLU；完整四寬色图、rawmodel與UTC見頂端4cc節（非正式重驗）。  /home/deck/.t3/userdata/blog-sprint-4cc7bcd/independent-gpt61-profile-states-review.json；model3044/view3056/3066。 | issues |
| /authors/ | https://blog.observe.tw/authors/ | GPT-6.1 Sol / 19:23:27Z | 1280×900；390×900 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl:8)；turn_context UTC19:13:02.645Z model=gpt-6.1-sol verified；實際讀圖calls：tag authors184、tag about/status256、tag404306、blog authors404、blog about424/442、blog status442、blog404487（UTC19:21:35.569Z）。review-gpt.json為reviewer即時紀錄，非raw transcript。  本輪[offline-B2逐圖notes](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-b2/reviewer-original-notes.json) raw receipt1845/view1855–1923；SHA b011873。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-authors-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-authors-390.png | batch-b states authors,authors-missing：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/review-gpt.json) | 對照tag /byline/，blog按來源分署名且無新聞首報/相似度指標，資料實體與功能範圍合理差異。 | 正常425位作者的列表清楚，手機first作者欄固定且表內捲動，favicon正常；missing請求遭429，未驗少筆/empty/error。；UI-001：合法範圍不存在id文件429，missing未驗。 | — | — | issues |
| /tags/ | https://blog.observe.tw/tags/ | GPT-6.1 Sol / 19:23:27Z | 1280×900；390×900 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl:8)；turn_context UTC19:13:02.645Z model=gpt-6.1-sol verified；實際讀圖calls：tag authors184、tag about/status256、tag404306、blog authors404、blog about424/442、blog status442、blog404487（UTC19:21:35.569Z）。review-gpt.json為reviewer即時紀錄，非raw transcript。  本輪[offline-B2逐圖notes](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-b2/reviewer-original-notes.json) raw receipt1845/view1855–1923；SHA b011873。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-tags-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-tags-390.png | batch-b states tags,tags-missing：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/review-gpt.json) | 對照tag /ranking/，tag無/tag/索引只有/tag/[tag]；blog保留人工/社群标签以chip探索，不套用新闻升溫wordcloud。 | chip列表正常換行，390无頁面溢出；missing選擇頁仍在首屏顯示完整總表，詳細狀態在下方未實際inspect，不算missing通過。；首屏只見完整chip列表，missing內容位於下面未inspect，未驗missing通過。 | — | — | pending |
| /topics/ | https://blog.observe.tw/topics/ | GPT-6.1 Sol / 19:23:04Z | 1280×800；390×844 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T02-58-05-01a1317a-acd8-7ef1-b839-527ac8086981.jsonl:330)；turn_context model=gpt-6.1-sol，讀圖call lines615/631/639/661/692/718/744/753。review-a.json為即時人工紀錄，非raw transcript。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-topics-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-topics-390.png | batch-a cases topics：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/review-a.json) | 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | HTTP500；顯示錯誤非empty，有reload；正常列表未驗。 | — | — | issues |
| /topics/[id]/ | https://blog.observe.tw/topics/美食/ | GPT-6.1 Sol / 19:23:04Z | 1280×800；390×844 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T02-58-05-01a1317a-acd8-7ef1-b839-527ac8086981.jsonl:330)；turn_context model=gpt-6.1-sol，讀圖call lines615/631/639/661/692/718/744/753。review-a.json為即時人工紀錄，非raw transcript。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-topic-many-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-topic-many-390.png | batch-a cases topic-many,topic-risk-history,topic-durian-history,topic-historical：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/review-a.json) | 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | HTTP429裸JSON，失去本站導覽/復原UI-A02，未完成正常多筆。；HTTP429裸JSON UI-A02，B0歷史正常狀態未驗。；HTTP429，截圖僅原始JSON viewer片段；不足正式viewport驗證，pending。；90天自然歷史fallback兩筆；共2已確認2/待確認0、發文與觀測時間區分；說明不代表目前命中，390正常換行無overflow。  UI-H01（本輪使用者回饋）：390寬方法／上游窗口／詞庫容量過長；需收進既有資料來源展開區塊，文章優先。修正後須新SHA candidate逐頁review；本批僅歷史fallback實例通過。  4cc 近期＋history 共八張：方法初始收合與手機文章優先可見；展開／error／404／共享標籤等仍待。 | — | —  4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8／BUILD_ID2ZIfs00KopZi_HHl8ahLU；完整四寬色图、rawmodel與UTC見頂端4cc節（非正式重驗）。 | issues |
| /ranking/ | https://blog.observe.tw/ranking/ | GPT-6.1 Sol / 19:23:27Z | 1280×900；390×900 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl:8)；turn_context UTC19:13:02.645Z model=gpt-6.1-sol verified；實際讀圖calls：tag authors184、tag about/status256、tag404306、blog authors404、blog about424/442、blog status442、blog404487（UTC19:21:35.569Z）。review-gpt.json為reviewer即時紀錄，非raw transcript。  本輪[offline-B2逐圖notes](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-b2/reviewer-original-notes.json) raw receipt1845/view1855–1923；SHA b011873。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-ranking-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-ranking-390.png | batch-b states ranking：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/review-gpt.json) | tag是新聞score/升溫與wordcloud，blog是參與部落格/收錄篇數橫條圖，指標明确，合理产品差異。 | 收錄排行說明不混淆人氣、品質、升溫；橫條圖與3欄表格390完整可讀；empty/error未驗。 | — | — | pending |
| /traffic/ | https://blog.observe.tw/traffic/ | GPT-6.1 Sol / 19:23:04Z  本輪獨立claude-opus-5-5，證據整理UTC2026-10-12T21:39:31Z；| 1280×800；390×844 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T02-58-05-01a1317a-acd8-7ef1-b839-527ac8086981.jsonl:330)；turn_context model=gpt-6.1-sol，讀圖call lines615/631/639/661/692/718/744/753。review-a.json為即時人工紀錄，非raw transcript。  [本輪實際Read收據](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-a/opus-review-verified.json)／[原始Opus transcript](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-a/opus-review.jsonl)；20個image blocks，result line103 success/end_turn。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-traffic-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-traffic-390.png | batch-a cases traffic：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/review-a.json) | 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | 月趨勢3線與不可補零說明、手機legend分頁；新增比較圖為功能差異，表格scroll/filter empty待驗。  離線Opus的舊圖P3：390圖例截斷、排名表在首屏下方；圖表留白與name含URL待目前資料確認。未看表格不能宣稱整頁通過。 | — | — | issues |
| /relations/ | https://blog.observe.tw/relations/ | GPT-6.1 Sol / 19:23:04Z  本輪獨立claude-opus-5-5，證據整理UTC2026-10-12T21:39:31Z；| 1280×800；390×844 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T02-58-05-01a1317a-acd8-7ef1-b839-527ac8086981.jsonl:330)；turn_context model=gpt-6.1-sol，讀圖call lines615/631/639/661/692/718/744/753。review-a.json為即時人工紀錄，非raw transcript。  [本輪實際Read收據](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-a/opus-review-verified.json)／[原始Opus transcript](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-a/opus-review.jsonl)；20個image blocks，result line103 success/end_turn。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-relations-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-relations-390.png | batch-a cases relations：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/review-a.json) | 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | 90天2節點1連線，箭頭與標籤辨識正常；文案明說正文提及、不判抄襲，empty/error/互動待驗。  離線Opus的舊圖P3：少節點時留白較多、節點標籤截斷；coverage未在首屏。缺縮放/橫捲/不同資料量驗證，不能推論功能不存在。  4cc 四張已由非作者gpt-6.1-sol實際graph圖片review；visible scope無blocking，1280淺色標籤相接nonblocking；下方／互動／empty／error仍待，不提升status。 | — | —  4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8／BUILD_ID2ZIfs00KopZi_HHl8ahLU；完整四寬色图、rawmodel與UTC見頂端4cc節（非正式重驗）。 | issues |
| /about/ | https://blog.observe.tw/about/ | GPT-6.1 Sol / 19:23:27Z | 1280×900；390×900 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl:8)；turn_context UTC19:13:02.645Z model=gpt-6.1-sol verified；實際讀圖calls：tag authors184、tag about/status256、tag404306、blog authors404、blog about424/442、blog status442、blog404487（UTC19:21:35.569Z）。review-gpt.json為reviewer即時紀錄，非raw transcript。  本輪[offline-B2逐圖notes](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-b2/reviewer-original-notes.json) raw receipt1845/view1855–1923；SHA b011873。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-about-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-about-390.png | batch-b states about：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/review-gpt.json) | tag實際資料方法頁是/method/；blog/about較少功能所以短文件無大綱可接受。 | 資料來源、收錄方式、作者與標籤、隱私等文字層級清楚、手機段落換行正常；多/少/空/error資料狀態N/A。  本輪重新核對：390只到作者與標籤開頭，文件後半/隱私/更正/footer未截到，撤回整頁pass，保留已看靜態範圍。 | — | — | pending |
| /api/ | https://blog.observe.tw/api/ | GPT-6.1 Sol / 19:23:27Z | 1280×900；390×900 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl:8)；turn_context UTC19:13:02.645Z model=gpt-6.1-sol verified；實際讀圖calls：tag authors184、tag about/status256、tag404306、blog authors404、blog about424/442、blog status442、blog404487（UTC19:21:35.569Z）。review-gpt.json為reviewer即時紀錄，非raw transcript。  本輪離線逐圖review另見[offline-B notes](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-b/reviewer-original-notes.json)，raw receipt1749／view1759–1791；仍為舊b011圖。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-api-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-api-390.png | batch-b states api：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/review-gpt.json) | 品牌綠色、部落格實體與API端點內容差異授權；一般字型/導航/頁籤/頁尾對照tag。 | 文件雙頁籤與桌機大綱清楚，手機chips換行正常；長inline code中間斷字是兩站共同低優先可讀性問題。資料量多/少N/A，深部端點區未inspect。 | — | — | pending |
| /api/status/ | https://blog.observe.tw/api/status/ | gpt-6.1-sol（raw receipt1194 UTC2026-10-12T20:16:09.312Z）；actual image review20:18:04–20:18:22Z | 1280×900；390×900；status fullPage截圖，viewport仍900高 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl:1194) actualmodel=gpt-6.1-sol；tag讀圖1252，candidate讀圖1269/1284/1293；[即時notes](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/reviewer-original-notes.json)非model response JSON。歷史b011/7a89原始log保留附錄。 | 42711cf18c452b406904af6000ccbf88a1ff6102（candidate實際review；目前正式已部署同SHA） | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/status-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/status-390.png | [最終候選逐頁notes](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/reviewer-original-notes.json)；tag referenceScreens與所有state inputScreens在notes；[capture+viewport+network](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/capture.json) | 比照tag文件型table-stack例外，維持一般數值表nowrap/sticky；blog只一公開API且全部GET所以省略tag方法欄合理。 | 完整fullPage截圖actual inspect：9個端點及用途均完整可見，三個blogs/{slug}端點清楚區分，手機使用端點/用途stack；沒有ellipsis、沒有橫向頁面溢出；桌機9列正常，UI-B001最終42711cf本機candidate已修正。 只涵蓋指定prefetch/client-nav、header搜尋、status文檔表修正；其他empty/error/authenticated/deepstate未齊，不算整route pass。正式瀏覽器retest尚待；前次因TTFB>2秒停止，本輪只離線review。 | 7a89af2d2bec4f4246d606a3f84291f8f3a21744（修正）；最終release 42711cf18c452b406904af6000ccbf88a1ff6102 | final candidate 42711cf18c452b406904af6000ccbf88a1ff6102；BUILDID GOv8HpPOwOSxlwvjwd6FB；UTC20:17:43–20:18:15Z；/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/status-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/status-390.png；2026-10-12T20:19:52.889Z blue generation4已部署；正式HTTP verification由root進行，無正式browserretest。 | fixed |
| /login/ | https://blog.observe.tw/login/ | GPT-6.1 Sol / 19:23:27Z | 1280×900；390×900 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl:8)；turn_context UTC19:13:02.645Z model=gpt-6.1-sol verified；實際讀圖calls：tag authors184、tag about/status256、tag404306、blog authors404、blog about424/442、blog status442、blog404487（UTC19:21:35.569Z）。review-gpt.json為reviewer即時紀錄，非raw transcript。  本輪離線逐圖review另見[offline-B notes](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-b/reviewer-original-notes.json)，raw receipt1749／view1759–1791；仍為舊b011圖。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-login-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-login-390.png | batch-b states login,login-cancelled：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/review-gpt.json) | blog綠色CTA/reading文案是品牌實體差異；與tag白框G icon不同，無截圖阻擋問題。 | 桌機與390CTA可讀無溢出；cancelled狀態提示清楚且可重試，未操作Google OAuth。；cancelled提示兩寬清楚，retry CTA未操作OAuth。 | — | — | pending |
| /my/ | https://blog.observe.tw/my/ | GPT-6.1 Sol；UTC2026-10-12T21:31:25.640Z actual圖片review | 1280×900；390×900 | [本輪model receipt](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl:1749)；view_image line1767；[逐頁notes](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-b/reviewer-original-notes.json) | b011873255f9bbf30c252df2ca65ead0ef1c306e（舊版離線圖，不是427重驗） | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-my-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-my-390.png | 兩張匿名HTTP200；tag同名參考圖與hash見offline-20261013-b/image-provenance.json | blog閱讀追蹤、私人RSS/OPML與API金鑰集中同頁；tag另有收藏/閱讀報告/設定，合理功能差異。綠色品牌授權。 | 匿名靜態兩寬已實際view_image review，主要內容可讀無新blocking；缺合法隔離帳號的登入後多/少/empty/error/denied與key狀態、RSS/OPML/tab/CTA互動；mobilefooter不完整，details closed未驗。 | — | — | pending |
| /observe/opt-out/ | https://blog.observe.tw/observe/opt-out/ | GPT-6.1 Sol / 19:23:27Z | 1280×900；390×900 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl:8)；turn_context UTC19:13:02.645Z model=gpt-6.1-sol verified；實際讀圖calls：tag authors184、tag about/status256、tag404306、blog authors404、blog about424/442、blog status442、blog404487（UTC19:21:35.569Z）。review-gpt.json為reviewer即時紀錄，非raw transcript。  本輪離線逐圖review另見[offline-B notes](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-b/reviewer-original-notes.json)，raw receipt1749／view1759–1791；仍為舊b011圖。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-optout-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-optout-390.png | batch-b states optout：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/review-gpt.json) | 新增DNT/GPC/private query說明合理；其餘狀態卡/條列設計同tag。 | 顯示不計入統計與automation/DNT說明正確，390條列換行正常；未操作恢复按钮。 | — | — | pending |
| /admin/ | https://blog.observe.tw/login?next=%2Fadmin%2F | GPT-6.1 Sol / 19:23:27Z | 1280×900；390×900 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl:8)；turn_context UTC19:13:02.645Z model=gpt-6.1-sol verified；實際讀圖calls：tag authors184、tag about/status256、tag404306、blog authors404、blog about424/442、blog status442、blog404487（UTC19:21:35.569Z）。review-gpt.json為reviewer即時紀錄，非raw transcript。  本輪[offline-B2逐圖notes](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-b2/reviewer-original-notes.json) raw receipt1845/view1855–1923；SHA b011873。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-admin-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-admin-390.png | batch-b states admin：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/review-gpt.json) | 品牌綠色、部落格實體與API端點內容差異授權；一般字型/導航/頁籤/頁尾對照tag。 | UI-001：匿名頁導航被原始JSON429遮蔽，未驗redirect/403或合法帳號admin。；合法admin session不存在，authenticated/403未驗，整頁保持pending。 | — | — | pending |
| /admin/discovery/ | https://blog.observe.tw/login?next=%2Fadmin%2Fdiscovery%2F | GPT-6.1 Sol / 19:23:27Z | 1280×900；390×900 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl:8)；turn_context UTC19:13:02.645Z model=gpt-6.1-sol verified；實際讀圖calls：tag authors184、tag about/status256、tag404306、blog authors404、blog about424/442、blog status442、blog404487（UTC19:21:35.569Z）。review-gpt.json為reviewer即時紀錄，非raw transcript。  本輪[offline-B2逐圖notes](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-b2/reviewer-original-notes.json) raw receipt1845/view1855–1923；SHA b011873。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-admin-discovery-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-admin-discovery-390.png | batch-b states admin-discovery：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/review-gpt.json) | 品牌綠色、部落格實體與API端點內容差異授權；一般字型/導航/頁籤/頁尾對照tag。 | UI-001：匿名頁導航被原始JSON429遮蔽，未驗redirect/403或合法帳號admin。；合法admin session不存在，authenticated/403未驗，整頁保持pending。 | — | — | pending |
| 404 (not-found.tsx) | https://blog.observe.tw/ui-review-missing/ | GPT-6.1 Sol / 19:23:27Z | 1280×900；390×900 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl:8)；turn_context UTC19:13:02.645Z model=gpt-6.1-sol verified；實際讀圖calls：tag authors184、tag about/status256、tag404306、blog authors404、blog about424/442、blog status442、blog404487（UTC19:21:35.569Z）。review-gpt.json為reviewer即時紀錄，非raw transcript。  本輪[offline-B2逐圖notes](/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-b2/reviewer-original-notes.json) raw receipt1845/view1855–1923；SHA b011873。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-404-1280.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-404-390.png | batch-b states 404：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/review-gpt.json) | 品牌綠色、部落格實體與API端點內容差異授權；一般字型/導航/頁籤/頁尾對照tag。 | UI-001：未知URL文件429，未見404模板，不能宣稱404通過。 | — | — | issues |
| 500 (error.tsx) | 500 (error.tsx) | GPT-6.1 Sol / 19:23:27Z | 1280×900；390×900 | [原始harness rollout](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl:8)；turn_context UTC19:13:02.645Z model=gpt-6.1-sol verified；實際讀圖calls：tag authors184、tag about/status256、tag404306、blog authors404、blog about424/442、blog status442、blog404487（UTC19:21:35.569Z）。review-gpt.json為reviewer即時紀錄，非raw transcript。 | b011873255f9bbf30c252df2ca65ead0ef1c306e | — | — | batch-b states 500：[完整log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/review-gpt.json) |  | 無安全fixture，未觸發500，不宣稱通過 | — | — | pending |
| /tech/ | /tech/ | gpt-6.1-sol（raw receipt2834）；UTC2026-10-13T05:34:59.071055Z | 1280×900；390×900，淺／深 | /home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T02-58-05-01a1317a-acd8-7ef1-b839-527ac8086981.jsonl：model2834、view2843 | 4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8 | /home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech/attempt-2/page-1-1280-light.png | /home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech/attempt-2/page-2-390-light.png | /home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech/attempt-2/independent-gpt61-tech-review.json；其餘深色PNG與manifest見頂端4cc節 | tag來源表為layout參考，無同款tech頁；darktag缺，僅candidatedark自身可讀性。 | 4cc四張主狀態visible無blocker；mobile表在900px下方，完整表／橫捲／sticky／方法區／篩選／error／flagoff／歷史失敗／正式重驗待補。  tech-table-right/attempt-4四圖已capture，獨立review尚待，不提升狀態。 | — | —  4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8／BUILD_ID2ZIfs00KopZi_HHl8ahLU；完整四寬色图、rawmodel與UTC見頂端4cc節（非正式重驗）。  /home/deck/.t3/userdata/blog-sprint-4cc7bcd/tech-table-right/attempt-4/capture-report.json。 | pending |
| /healthz/ | /healthz/ | GPT-6.1 Sol / — | N/A，非UI未capture | 無視覺review raw；既有non-ui.test.mjs與test.log為原始endpoint測試證據 | b011873255f9bbf30c252df2ca65ead0ef1c306e | — | — | 真實endpoint測試，非UI pass | N/A，非視覺頁面 | 非UI；實際HTTP/metadata測試檔[non-ui.test.mjs](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/non-ui.test.mjs)，結果[non-ui-test.log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/non-ui-test.log)。health另有repo web/test/public-cache.test.ts:56。 | — | — | n/a-ui |
| /manifest.webmanifest | /manifest.webmanifest | GPT-6.1 Sol / — | N/A，非UI未capture | 無視覺review raw；既有non-ui.test.mjs與test.log為原始endpoint測試證據 | b011873255f9bbf30c252df2ca65ead0ef1c306e | — | — | 真實endpoint測試，非UI pass | N/A，非視覺頁面 | 非UI；實際HTTP/metadata測試檔[non-ui.test.mjs](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/non-ui.test.mjs)，結果[non-ui-test.log](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/non-ui-test.log)。health另有repo web/test/public-cache.test.ts:56。 | — | — | n/a-ui |

UI-A01首頁/topics真實500；UI-A02/舊UI-001文件429裸JSON；UI-A03 articles390header搜尋欄只有一字空間；UI-B001 APIstatus390端點ellipsis/用途截斷（獨立Opus Major）。目前fixCommit均未完成retest，因此保持issues。

多/少/empty/error狀態依功能：about靜態文字N/A；API文件資料量N/A但深部內容未inspect故pending；登入/optout資料量N/A而互動未齊pending。admin不因匿名redirect算通過。n/a-ui不納入UI pass。





歷史候選7a89三scope補證（已由42711cf最終候選review取代）：本機 `http://127.0.0.1:18174`，runtime procCwd核對7a89 release。首頁等待5秒0自動RSC/prefetch；點可見文章連結1筆RSC、0 document navigation。手機搜尋預設icon、展開輸入focus且完整填值。status fullPage實際inspect9完整端點/用途，mobile table-stack無ellipsis。原始harness actual gpt-6.1-sol receipt line688、view_image823（articles390）/839（三scope全圖）；UTC19:49:23.373Z。[即時逐頁notes](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-candidate-7a89/reviewer-original-notes.json)非modelresponseJSON，[capture原始請求及viewport](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-candidate-7a89/attempt2/capture.json)、[before loadgate](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-candidate-7a89/gate-candidate-before.json)/[after gate](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-candidate-7a89/gate-candidate-after.json)、[ownedbrowser正常close](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-candidate-7a89/attempt2/browser-closed.json)。本次僅整合B reviewer已完成證據，未新開browser。**fixed只表示指定candidate修正已驗，不是route全state或正式環境pass；topics/歷史兩案例/其他pending不變。**




最終候選42711cf證據：runtime gateway/web procCwd核對release SHA，BUILDID `GOv8HpPOwOSxlwvjwd6FB`；[實際review notes](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/reviewer-original-notes.json)明確是reviewer即時紀錄，不冒充原始modelresponse。原始model receipt1194=`gpt-6.1-sol`，tag實際讀圖call1252（6張），candidate1269/1284/1293（7張）；UTC20:18:04.374Z、20:18:18.003Z、20:18:22.635Z。零自動prefetch／GA／429；可見連結clientnav1 RSC、0 document。捕捉前後gate及ownedbrowser close在[gate-before](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/gate-before.json)/[gate-after](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/gate-after.json)/[browser-closed](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/browser-closed.json)。正式TTFB前2.559秒/後4.616秒，因此無formalbrowser導航。三scope fixed僅指candidate修正review通過且同SHA部署；保留其餘state pending/issues。



## 附錄：批次及superseded歷史證據


## 新版 batch-b reviewer交付整合

來源 `/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/review-gpt.json`，GPT-6.1 Sol，UTC 2026-10-12T19:23:27.638281+00:00，SHA b011873255f9bbf30c252df2ca65ead0ef1c306e。由獨立reviewer逐張view_image實際inspect60圖（15狀態×blog/tag×1280/390），整合者未假稱再次inspect。privacy DNT/optout/route前置阻擋/正常favicon、全部GA resource=0。

|route/state|inputScreens（blog/tag1280/390）|findings/tag deviation|status|
|---|---|---|---|
| authors | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-authors-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-authors-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-authors-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-authors-390.png | 正常425位作者的列表清楚，手機first作者欄固定且表內捲動，favicon正常；missing請求遭429，未驗少筆/empty/error。 對照tag /byline/，blog按來源分署名且無新聞首報/相似度指標，資料實體與功能範圍合理差異。 | pending |
| tags | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-tags-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-tags-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-tags-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-tags-390.png | chip列表正常換行，390无頁面溢出；missing選擇頁仍在首屏顯示完整總表，詳細狀態在下方未實際inspect，不算missing通過。 對照tag /ranking/，tag無/tag/索引只有/tag/[tag]；blog保留人工/社群标签以chip探索，不套用新闻升溫wordcloud。 | pending |
| ranking | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-ranking-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-ranking-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-ranking-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-ranking-390.png | 收錄排行說明不混淆人氣、品質、升溫；橫條圖與3欄表格390完整可讀；empty/error未驗。 tag是新聞score/升溫與wordcloud，blog是參與部落格/收錄篇數橫條圖，指標明确，合理产品差異。 | pending |
| about | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-about-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-about-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-about-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-about-390.png | 資料來源、收錄方式、作者與標籤、隱私等文字層級清楚、手機段落換行正常；多/少/空/error資料狀態N/A。 tag實際資料方法頁是/method/；blog/about較少功能所以短文件無大綱可接受。 | pass |
| api | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-api-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-api-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-api-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-api-390.png | 文件雙頁籤與桌機大綱清楚，手機chips換行正常；長inline code中間斷字是兩站共同低優先可讀性問題。資料量多/少N/A，深部端點區未inspect。 品牌綠色、部落格實體與API端點內容差異授權；一般字型/導航/頁籤/頁尾對照tag。 | pending |
| status | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-status-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-status-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-status-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-status-390.png | UI-B001：手機端點path ellipsis令三筆/api/v1/blogs/{slu…無法區分，且用途右緣截斷；tag手機table-stack完整顯示端點/用途。正常API badge與時間可讀；degraded/error與重新整理尚待。 API端點/用途文檔型表格可考慮table-stack例外；不是所有數值表取消nowrap/sticky。手機長path隱藏無合理內容差異理由。 | issues |
| login | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-login-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-login-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-login-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-login-390.png | 桌機與390CTA可讀無溢出；cancelled狀態提示清楚且可重試，未操作Google OAuth。 blog綠色CTA/reading文案是品牌實體差異；與tag白框G icon不同，無截圖阻擋問題。 | pending |
| my | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-my-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-my-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-my-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-my-390.png | 匿名login提示和API key說明兩寬正常，reader頁籤清楚；authenticated/empty/error/denied缺合法session未驗。 品牌綠色、部落格實體與API端點內容差異授權；一般字型/導航/頁籤/頁尾對照tag。 | pending |
| optout | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-optout-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-optout-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-optout-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-optout-390.png | 顯示不計入統計與automation/DNT說明正確，390條列換行正常；未操作恢复按钮。 新增DNT/GPC/private query說明合理；其餘狀態卡/條列設計同tag。 | pending |
| admin | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-admin-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-admin-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-admin-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-admin-390.png | UI-001：匿名頁導航被原始JSON429遮蔽，未驗redirect/403或合法帳號admin。 品牌綠色、部落格實體與API端點內容差異授權；一般字型/導航/頁籤/頁尾對照tag。 | pending（429另列issue；authenticated未驗） |
| admin-discovery | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-admin-discovery-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-admin-discovery-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-admin-discovery-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-admin-discovery-390.png | UI-001：匿名頁導航被原始JSON429遮蔽，未驗redirect/403或合法帳號admin。 品牌綠色、部落格實體與API端點內容差異授權；一般字型/導航/頁籤/頁尾對照tag。 | pending（429另列issue；authenticated未驗） |
| 404 | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-404-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-404-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-404-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-404-390.png | UI-001：未知URL文件429，未見404模板，不能宣稱404通過。 品牌綠色、部落格實體與API端點內容差異授權；一般字型/導航/頁籤/頁尾對照tag。 | issues |
| authors-missing | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-authors-missing-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-authors-missing-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-authors-missing-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-authors-missing-390.png | UI-001：合法範圍不存在id文件429，missing未驗。 品牌綠色、部落格實體與API端點內容差異授權；一般字型/導航/頁籤/頁尾對照tag。 | issues |
| tags-missing | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-tags-missing-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-tags-missing-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-tags-missing-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-tags-missing-390.png | 首屏只見完整chip列表，missing內容位於下面未inspect，未驗missing通過。 品牌綠色、部落格實體與API端點內容差異授權；一般字型/導航/頁籤/頁尾對照tag。 | pending |
| login-cancelled | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-login-cancelled-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/blog-login-cancelled-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-login-cancelled-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/tag-login-cancelled-390.png | cancelled提示兩寬清楚，retry CTA未操作OAuth。 品牌綠色、部落格實體與API端點內容差異授權；一般字型/導航/頁籤/頁尾對照tag。 | pending |
| 500 |  | 無安全fixture，未觸發500，不宣稱通過  | pending |

batch-b 500 fixture pending；但batch-a首頁/topics真實500框架已有1280/390實際inspect，只涵蓋那兩次自然錯誤。about資料量多/少/empty/error=N/A，靜態visual pass，不擴張為其他頁通過。

獨立Opus審查log：`/home/deck/.t3/userdata/ui-review-blog-20261013/batch-b/opus-evidence.json`核驗actual assistant.message.model=`claude-opus-5-5`，API/login/optout12圖＋status4圖均Read input path，UTC 2026-10-12T19:23:49Z，reviewedSHA b011873；原stream `opus-review.jsonl`、`opus-status-review.jsonl`。UI-B001：status390端點path ellipsis讓blogs/slug子端點無法區分，用途截斷；獨立Opus評Major，待修/retest。fixCommit尚無。


## 新版 batch-a 正式逐頁review（唯一有效方法）

SHA `b011873255f9bbf30c252df2ca65ead0ef1c306e`；GPT-6.1 Sol；實際inspect UTC `2026-10-12T19:23:04Z`。完整每頁inputScreens、tag referenceScreens與findings位於私有 `/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/review-a.json`。14個狀態皆已實際讀圖；仍有issues/pending，不宣稱pass。首頁單頁重驗200不能抵消批次限流。

|case/route|blog1280/390 inputScreens|tag1280/390 referenceScreens|findings/deviation|status|
|---|---|---|---|---|
| home / | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-home-initial500-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-home-initial500-390.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-home-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-home-390.png |  | 初次HTTP500；框架/導覽/重新載入存在，非empty。单頁retest200後首頁文字雲無重疊、手機最新文章優先；仍需恢復button及批次限流retest。 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | issues |
| blogs /blogs/ | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-blogs-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-blogs-390.png |  | 1280四統計卡、390兩欄統計；filter wrap、nowrap表內捲動，favicon可見。首欄/sticky scroll互動待驗。 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | pending |
| blogs-empty /blogs/?q=ui-review-no-result-20261013 | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-blogs-empty-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-blogs-empty-390.png |  | 真實q無結果，明確0筆與沒有符合條件；不誤顯預設313筆。 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | pending |
| blogs-few /blogs/?q=herbert | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-blogs-few-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-blogs-few-390.png |  | 真實herbert查詢1筆，手機首欄縮略仍有名稱；無橫溢出。 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | pending |
| blog-many /blogs/herbertlui.net/ | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-blog-many-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-blog-many-390.png |  | Herbert Lui50篇，1280來源/內文卡置右、390details收合；文字雲不重疊、原站與作者來源清楚。少筆detail/empty搜尋/denied尚待驗。 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | pending |
| articles /articles/ | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-articles-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-articles-390.png |  | 列表排版清晰、原站網址可換行、圖片不壓文字；390header搜尋僅剩一字左右輸入空間UI-A03。 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。blog使用純列表，tag有新聞事件卡，不要求跨實體假造事件。 | issues |
| articles-empty /articles/?q=ui-review-no-result-20261013 | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-articles-empty-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-articles-empty-390.png |  | 真實搜尋無結果；有範圍1000篇限制及較早文章可能不在範圍說明；390header UI-A03。 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。blog使用純列表，tag有新聞事件卡，不要求跨實體假造事件。 | issues |
| topics /topics/ | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-topics-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-topics-390.png |  | HTTP500；顯示錯誤非empty，有reload；正常列表未驗。 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | issues |
| topic-many /topics/美食/ | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-topic-many-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-topic-many-390.png |  | HTTP429裸JSON，失去本站導覽/復原UI-A02，未完成正常多筆。 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | issues |
| topic-risk-history /topics/風險管理/?days=90 | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-topic-risk-history-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-topic-risk-history-390.png |  | HTTP429裸JSON UI-A02，B0歷史正常狀態未驗。 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | issues |
| topic-durian-history /topics/榴槤/?days=90 | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-topic-durian-history-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-topic-durian-history-390.png |  | HTTP429，截圖僅原始JSON viewer片段；不足正式viewport驗證，pending。 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | pending |
| topic-historical /topics/國際市場/?days=90 | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-topic-historical-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-topic-historical-390.png |  | 90天自然歷史fallback兩筆；共2已確認2/待確認0、發文與觀測時間區分；說明不代表目前命中，390正常換行無overflow。 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | pending |
| relations /relations/ | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-relations-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-relations-390.png | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/tag-relations-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/tag-relations-390.png | 90天2節點1連線，箭頭與標籤辨識正常；文案明說正文提及、不判抄襲，empty/error/互動待驗。 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | pending |
| traffic /traffic/ | /home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-traffic-1280.png<br>/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/blog-traffic-390.png |  | 月趨勢3線與不可補零說明、手機legend分頁；新增比較圖為功能差異，表格scroll/filter empty待驗。 綠色accent與部落格/文章/作者實體授權；不同期間及歷史fallback是產品資料語意；共同字型、navigation、卡片/表格spacing對照。 | pending |

UI-A01：首頁/topics初次500；UI-A02：三話題文件429裸JSON。UI-A03：articles390header搜尋欄只有一字左右可讀空間，與tag icon-only header不同且妨礙輸入。已回報root，fixCommit/retest待補。單首頁58請求含25個Next-Router-Prefetch=1，24×200＋個人feed×401；favicon14×200/Next資產12×200，動態prefetch實際放大量。root要求暫停大量capture等待修正，未調降安全限流。


新版 batch-a 進度（2026-10-12T19:17Z UTC）：獨立 Playwright／Chromium1243 已取得並由 GPT-6.1 Sol 實際 inspect 16 張 tag 參考圖（首頁、/media、/media/pts、/article、/ranking、/tag/國際市場、/similarity、/media/traffic；各1280/390）。metadata 與安全證據 `/home/deck/.t3/userdata/ui-review-blog-20261013/batch-a/tag-reference-final.json`。GA/GTM route 在任何導航前設定；DNT HTTP與navigator皆1，initScript設定兩站optout=1，serviceWorker阻擋。零GA嘗試／零完成外送；favicon暫時阻擋避免舊版資源瀑布，故不對favicon正確性下結論。tag國際市場趨勢自然出現歷史載入失敗提示，列作參考error呈現。待root通知b011873部署後重拍blog比對；尚無新版pass。


最新審查規格：獨立 Playwright、DNT=1、導航前 GA/GTM transport route 阻擋及 localStorage opt-out；每頁須實際 inspect blog 1280/390 與 tag 對應參考截圖。以下所有 T3 preview 舊審查均為 **superseded**，不能當成新版驗收，全部回到 pending；舊 issues 僅為歷史發現。新基底 origin/main `b011873255f9bbf30c252df2ca65ead0ef1c306e`（已 git fetch origin），正式部署 SHA 等 root 通知。


第四批 log：2026-10-13 03:07–03:09 Taiwan，GPT-6.1 Sol，reviewedSHA a45b06a8816e8388c463173f6b7c43da81aeb51b。動態 `/blogs/herbertlui.net/` 50篇正常資料，390 documentWidth=390，來源/原站閱讀說明清楚；`/topics/美食/` 正常呈現高頻詞說明、標題/僅正文區分，390 documentWidth=390。兩模板少資料/empty/error/denied均待驗證。`/observe/opt-out/` 正常顯示已不計入統計，不操作恢復按钮。404導航工具失敗，snapshot曾about:blank且URL仍為topics，所以不得當404已驗證或保存為404證據。GA resource檢查=0。

/blogs/herbertlui.net/ desktop1280 `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mehau-9199bf4a.png`；mobile390 `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5meity-861b6d36.png`。status=pending（重要狀態未齊）。
/topics/美食/ desktop1280 `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mem0e-174530eb.png`；mobile390 `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5menhu-1f8de438.png`。status=pending（重要狀態未齊）。
/observe/opt-out/ desktop1280 `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mg34x-faded943.png`；mobile390 `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mg4o9-765bc12f.png`。status=pending（重要狀態未齊）。

第三批 log：2026-10-13 03:05 Taiwan，GPT-6.1 Sol，reviewedSHA a45b06a8816e8388c463173f6b7c43da81aeb51b。/api、/api/status、/login、/my正常狀態完成1280/390截圖；/admin未登入導向 `/login?next=%2Fadmin%2F`；/admin/discovery未登入導向 `/login?next=%2Fadmin%2Fdiscovery%2F`，但登入頁遭429。兩個admin頁仍pending：僅驗匿名導向，沒有隔離授權帳號實際頁面。所有上述 GA resources=0；未操作Google登入。

第二批實際審查 log（表格狀態後續整合）：

- 2026-10-13 03:03 Taiwan，/authors/；GPT-6.1 Sol；SHA a45b06a8816e8388c463173f6b7c43da81aeb51b；desktop1280 `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mbdee-0b688e38.png`；mobile390 `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mbfpl-8a8e9868.png`；GA resources=0。正常頁面，390 documentWidth=390；[{"first":"sticky","nowrap":"nowrap","width":508}]；多/少/empty/error互動未完，status=pending。
- 2026-10-13 03:03 Taiwan，/tags/；GPT-6.1 Sol；SHA a45b06a8816e8388c463173f6b7c43da81aeb51b；desktop1280 `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mbitl-a59f9e1b.png`；mobile390 `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mbl4b-bfac64fd.png`；GA resources=0。正常頁面，390 documentWidth=390；[]；多/少/empty/error互動未完，status=pending。
- 2026-10-13 03:03 Taiwan，/traffic/；GPT-6.1 Sol；SHA a45b06a8816e8388c463173f6b7c43da81aeb51b；desktop1280 `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mbozs-dec09e89.png`；mobile390 `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mbrbq-dc21d12e.png`；GA resources=0。正常頁面，390 documentWidth=390；[{"first":"sticky","nowrap":"nowrap","width":1061}]；多/少/empty/error互動未完，status=pending。
- 2026-10-13 03:03 Taiwan，/relations/；GPT-6.1 Sol；SHA a45b06a8816e8388c463173f6b7c43da81aeb51b；desktop1280 `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mbuc7-26ff1ac9.png`；mobile390 `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mbwnd-cd7dd0bf.png`；GA resources=0。UI-001再次重現整頁429，status=issues。
- 2026-10-13 03:03 Taiwan，/about/；GPT-6.1 Sol；SHA a45b06a8816e8388c463173f6b7c43da81aeb51b；desktop1280 `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mc0jk-f75a1275.png`；mobile390 `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mc2tm-0ef96053.png`；GA resources=0。UI-001再次重現整頁429，status=issues。

盤點時間：2026-10-13 03:04（Asia/Taipei）。Reviewer：Codex / GPT-6.1 Sol。正式站審查 SHA：`a45b06a8816e8388c463173f6b7c43da81aeb51b`；基底 `origin/main`：`fc6b5a902f230047252391ee2eae509e76c46427`。瀏覽器獨立 tab：`tab_4f`。

本表盤點全部 21 個 UI route/錯誤模板，另列 healthz、manifest（非 UI）與未實作 /tech/，共 24 項。現階段無整頁 pass：19 個 UI route 已嘗試導航（404工具失敗未驗證），6 個 route 有限流 issues，其他重要狀態尚待驗證。動態模板仍需多資料、少資料、empty、error、denied，任何未驗證重要狀態皆維持 pending。

截圖均位於 repo 外私有 `/home/deck/.t3/userdata/browser-artifacts/`，不包含帳號 email。未登入真人 Google；不新增 admin 帳號/權限。

統計防護：先開 `/observe/opt-out/`，設定 `blog-analytics-opt-out=1` 並 dispatch `blog-analytics-opt-out-change`。首頁、articles、blogs、ranking、topics 的 performance resource 檢查皆無 GA/GTＭ 資源（0）。未合成 GA 事件；保留瀏覽器 DNT/privacy guard。

對照：readonly `/home/deck/.cache/tag-visuals`。共同 font stack、select padding、table sticky/nowrap CSS一致。綠色 accent 與部落格/作者/文章等不同實體為授權偏離；首頁文字雲品牌編排為部落格首頁特有設計，尚待逐狀態互動比對。來源提示有原站連結及收錄方式說明。未完成的 tag 視覺互動對比不視為通過。

| route | example URL | reviewer/model | reviewedSHA | desktop1280 screenshotPath | mobile390 screenshotPath | tag偏離/理由 | pending | fixCommit | retestSHA/screenshots | status |
|---|---|---|---|---|---|---|---|---|---|---|
| / | https://blog.observe.tw/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5m7tcc-760eb163.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5m843z-4f67ecc8.png | 綠色accent及實體差異授權；其餘待逐頁對比 | 02:58 Taiwan 正常首頁390無頁面橫向溢出、文字雲未重疊；導覽開合、light、empty/error尚待驗證 | — | — | pending |
| /articles/ | https://blog.observe.tw/articles/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5m8fuf-7e766b26.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5m8hde-825d508a.png | 綠色accent及實體差異授權；其餘待逐頁對比 | 正常狀態已導航；重要互動/多少empty/error仍待驗證 | — | — | pending |
| /blogs/ | https://blog.observe.tw/blogs/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5m8l3r-54f1b925.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5m8mmm-63af68dd.png | 綠色accent及實體差異授權；其餘待逐頁對比 | UI-001整頁429；正常狀態待驗證 | — | — | pending |
| /blogs/[slug]/ | https://blog.observe.tw/blogs/herbertlui.net/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mehau-9199bf4a.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5meity-861b6d36.png | 綠色accent及實體差異授權；其餘待逐頁對比 | 正常狀態已review；多/少/empty/error/denied等適用重要狀態未齊，詳見log | — | — | pending |
| /authors/ | https://blog.observe.tw/authors/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mbdee-0b688e38.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mbfpl-8a8e9868.png | 綠色accent及實體差異授權；其餘待逐頁對比 | 正常狀態已導航；重要互動/多少empty/error仍待驗證 | — | — | pending |
| /tags/ | https://blog.observe.tw/tags/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mbitl-a59f9e1b.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mbl4b-bfac64fd.png | 綠色accent及實體差異授權；其餘待逐頁對比 | 正常狀態已導航；重要互動/多少empty/error仍待驗證 | — | — | pending |
| /topics/ | https://blog.observe.tw/topics/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5m8ubi-ca0be55f.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5m8vun-d8c95840.png | 綠色accent及實體差異授權；其餘待逐頁對比 | UI-001整頁429；正常狀態待驗證 | — | — | pending |
| /topics/[id]/ | https://blog.observe.tw/topics/美食/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mem0e-174530eb.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5menhu-1f8de438.png | 綠色accent及實體差異授權；其餘待逐頁對比 | 正常狀態已review；多/少/empty/error/denied等適用重要狀態未齊，詳見log | — | — | pending |
| /ranking/ | https://blog.observe.tw/ranking/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5m8pos-aa351860.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5m8r83-095a4ef0.png | 綠色accent及實體差異授權；其餘待逐頁對比 | UI-001整頁429；正常狀態待驗證 | — | — | pending |
| /traffic/ | https://blog.observe.tw/traffic/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mbozs-dec09e89.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mbrbq-dc21d12e.png | 綠色accent及實體差異授權；其餘待逐頁對比 | 正常狀態已導航；重要互動/多少empty/error仍待驗證 | — | — | pending |
| /relations/ | https://blog.observe.tw/relations/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mbuc7-26ff1ac9.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mbwnd-cd7dd0bf.png | 綠色accent及實體差異授權；其餘待逐頁對比 | UI-001整頁429；正常狀態待驗證 | — | — | pending |
| /about/ | https://blog.observe.tw/about/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mc0jk-f75a1275.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mc2tm-0ef96053.png | 綠色accent及實體差異授權；其餘待逐頁對比 | UI-001整頁429；正常狀態待驗證 | — | — | pending |
| /api/ | https://blog.observe.tw/api/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mcunz-104263a4.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mcwzv-d34bfbad.png | 綠色accent及實體差異授權；其餘待逐頁對比 | 正常狀態已導航；重要互動/多少empty/error仍待驗證 | — | — | pending |
| /api/status/ | https://blog.observe.tw/api/status/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5md0v2-1b3aa3e6.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5md34c-ddad97b3.png | 綠色accent及實體差異授權；其餘待逐頁對比 | 正常狀態已導航；重要互動/多少empty/error仍待驗證 | — | — | pending |
| /login/ | https://blog.observe.tw/login/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5md5gu-6cbf500a.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5md7pw-05d14a3d.png | 綠色accent及實體差異授權；其餘待逐頁對比 | 正常狀態已導航；重要互動/多少empty/error仍待驗證 | — | — | pending |
| /my/ | https://blog.observe.tw/my/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mda1u-735092e7.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mdcdj-e1459194.png | 綠色accent及實體差異授權；其餘待逐頁對比 | 正常狀態已導航；重要互動/多少empty/error仍待驗證 | — | — | pending |
| /observe/opt-out/ | https://blog.observe.tw/observe/opt-out/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mg34x-faded943.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mg4o9-765bc12f.png | 綠色accent及實體差異授權；其餘待逐頁對比 | 正常狀態已review；多/少/empty/error/denied等適用重要狀態未齊，詳見log | — | — | pending |
| /admin/ | https://blog.observe.tw/admin/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mdeqj-cec9db1b.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mdhra-c5ff70f3.png | 綠色accent及實體差異授權；其餘待逐頁對比 | 已驗未登入redirect；缺隔離授權帳號，admin實際頁面未review；discovery登入畫面另遭UI-001 | — | — | pending |
| /admin/discovery/ | https://blog.observe.tw/admin/discovery/ | Codex/GPT-6.1 Sol | a45b06a8816e8388c463173f6b7c43da81aeb51b | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mdk43-ce607726.png | /home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mdmew-9050ea11.png | 綠色accent及實體差異授權；其餘待逐頁對比 | 已驗未登入redirect；缺隔離授權帳號，admin實際頁面未review；discovery登入畫面另遭UI-001 | — | — | pending |
| 404 (not-found.tsx) | https://blog.observe.tw/ui-review-missing/ | Codex/GPT-6.1 Sol | — | — | — | 綠色accent及實體差異授權；其餘待逐頁對比 | 尚未實際審查；重要狀態待驗證 | — | — | pending |
| 500 (error.tsx) | 尚未安全觸發 | Codex/GPT-6.1 Sol | — | — | — | 綠色accent及實體差異授權；其餘待逐頁對比 | 尚未實際審查；重要狀態待驗證 | — | — | pending |
| /healthz/ | https://blog.observe.tw/healthz/ | Codex/GPT-6.1 Sol | — | — | — | 綠色accent及實體差異授權；其餘待逐頁對比 | 非UI端點，另列盤點，不宣稱視覺pass | — | — | pending |
| /manifest.webmanifest | https://blog.observe.tw/manifest.webmanifest | Codex/GPT-6.1 Sol | — | — | — | 綠色accent及實體差異授權；其餘待逐頁對比 | 非UI端點，另列盤點，不宣稱視覺pass | — | — | pending |
| /tech/ | https://blog.observe.tw/tech/ | Codex/GPT-6.1 Sol | — | — | — | 綠色accent及實體差異授權；其餘待逐頁對比 | F4尚未實作 | — | — | pending |

UI-001（2026-10-13 02:59 Taiwan）：正常查看 /articles/ 後，至少31個 favicon GET 與 navigation RSC prefetch 回429，隨後 /blogs/、/ranking/、/topics/ 全文件429。最直接 mobile error證據：`/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5m93q0-947f7d7a.png`。不把限流畫面當成預期error state通過。root確認無刻意限流測試或部署，將修正靜態asset/global配額。


## B0正式歷史fallback補證（42711cf；不提升整個動態模板為pass）

GPT-6.1 Sol於2026-10-12T20:23:54.443Z實際讀三頁各1280×900／390×900，已先讀tag參考圖；正式releaseheader為`42711cf18c452b406904af6000ccbf88a1ff6102`、generation4，BUILD_ID沿用已核對的`GOv8HpPOwOSxlwvjwd6FB`。六個document均200、no-store/DYNAMIC、GA0/4290，沒有整頁橫溢出。範例為`/topics/風險管理/?days=90`（3篇）、`/topics/榴槤/?days=90`（1篇）、`/topics/國際市場/?days=90`（2篇）；畫面可見「過去觀測到的文章」、近90天無新相關文章、原文標題／來源／日期，已確認篇數3/1/2、待重確認均0。共同來源版本`83eaac91-a18a-4284-99a9-f042f3e95333`可見；文章數字ID沒有在画面顯示，不以此聲稱已驗ID或F3全文證據。

私有證據根目錄 `/home/deck/.t3/userdata/ui-review-blog-20261013/batch-live-history-42711cf/`：`risk-1280.png`／`risk-390.png`、`durian-1280.png`／`durian-390.png`、`market-1280.png`／`market-390.png`。原始逐頁review：`reviewer-original-notes.json`；request/headers/可見文字：`capture.json`。raw reviewer harness `/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl`：model receipt1342（20:22:20.597Z，gpt-6.1-sol）、tag實際讀圖1370（20:23:08.166Z）、六張blog實際讀圖1411（20:23:54.443Z）。不使用新模型自行評自己寫的頁面。

freshgate20:22:33Z：load3.76/6.01/6.32、blog final200 TTFB1.226s、otherbrowser root1/build0，允許開本thread唯一browser，頁間5秒。途中root量到load>12後發停止通知；reviewer20:23:27Z核load17.29，停止時最後in-flight畫面已自然完成、browser20:23:30.370Zclose。之後只讀既有圖，無補拍、重試或正式導航；本批實際存在的`gate-before.json`、`browser-closed.json`及`reviewer-original-notes.json`內loadInterruption保留時間；**沒有產生gate-after.json**，先前引用錯誤已更正，未事後補建。停止觀測UTC20:23:27Z、關閉20:23:30.370Z以原始reviewer紀錄與browser-closed為準。不能把此批稱為持續健康負載；後續capture仍暫停。

此補證只覆蓋歷史fallback多/少資料，沒有補齊整個`/topics/[key]/`的empty/error/permission等狀態，因此權威主表與總數維持pending原狀。三個本次修正route的正式browserretest仍未做，不將歷史頁當作它們的驗收。

## 歷史：話題方法說明收合的 source 修正（當時 candidate 畫面待驗）

程式修正 commit：`8afc698`；未部署。

本批以 `origin/main` 的 `0b7d42e`（先前實作起點 `3ad4191`，差異只有證據文件）為基礎。Opus 5.5 實作將長方法、上游窗口、品質與容量資訊移入既有「本頁資料來源與計算方式」原生 details；手機先呈現文章，保留必要來源與確認狀態。error／404 的 topic-only fallback 也補上通用方法區塊。

- 實作原始紀錄：`/home/deck/.t3/projects/blog-observe-tw/.reviews/topic-method-ui/opus-implementation.jsonl`、`opus-fixes.jsonl`；兩者實際 model `claude-opus-5-5`，result success。
- 獨立 source reviewer：GPT-6.1 Sol；原始 model log 與 UTC 見 `/home/deck/.t3/projects/blog-observe-tw/.reviews/topic-method-ui/codex-source-review.md`、`codex-source-rereview.md`。TM-S1 已補 error／404 fallback；TM-S2 建議採納，本輪 source-string 測試移到 ignored review 目錄保留，未當作視覺證據。
- 已執行既有 web tests：172 passed；前端 TypeScript `--noEmit --incremental false` 通過。log：`.reviews/topic-method-ui/web-tests.log`、`typecheck.log`。
- **尚未建置、部署或拍攝本批 candidate**：tag 備份期間磁碟凍結。1280／390、tag 對照、鍵盤展開／收合、error／404 單一 details、資料多／少／空狀態仍待實際獨立 review；沒有新 screenshot，也沒有把 source review 當畫面 pass。
- 權威主表狀態與計數不變；topic UI-H01 仍是 issues，不能宣稱整 route 已通過。


## 歷史：磁碟凍結期間的離線逐頁 review（2026-10-13）

本輪基底 `origin/main e2929a82ac928c9d22b91d8b41ccf174833a1ca6`（已 fetch）。不啟動瀏覽器、建置、部署、資料匯出或 release 複製。磁碟凍結由 babysit 通知解除，不能由本工具或 review 完成自行解除。

既有 119 張 PNG（共 14,041,140 bytes，沒有複製）已用檔案內容計算 SHA-256 與 IHDR 尺寸；盤點：`/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-inventory/existing-images.json`。這是輸入盤點，**不是 119 張已完成 review**。舊 capture 的 SHA 和本輪 review 的 repo HEAD 分開記錄；不把 b011873 圖片當成 42711cf 或尚未建置的 8afc698 畫面。

逐頁完成條件仍為：實際 1280／390 圖片與 tag 參考圖輸入、核實 model、原始 transcript、該頁 findings／偏離理由與未驗狀態。agent 回報 Done、source review、HTTP 200、單一共用元件 review，均不能取代這些條件。靜態 PNG 不能證明 sticky、橫向捲動、鍵盤、登入權限或未截到的長頁內容。

新 capture 一律是後續獨立批次：必須符合全域瀏覽器 ≤2、load1 ≤12、DNT=1、導航前 GA／GTM 阻擋、逐批小量容量估算及保留備份門檻餘裕。做不到就使用現有圖離線 review；不得補造歷史 gate-after 或改寫舊 capture。兩條 Cloudflare 快取規則保持 Disabled。

### 離線 batch B：實際圖片 review 已完成的範圍

GPT-6.1 Sol 已逐張讀取 20 張既有圖（blog 10、tag 10），涵蓋 `/api/`、`/my/`、`/login/` 正常與取消、`/observe/opt-out/`，共四個 route、五個畫面狀態。原始本輪 model receipt：`/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl:1749`（UTC21:30:48.793Z）；實際view_image calls1759/1767/1775/1783/1791，UTC21:31:15–50。

逐頁結果和輸入圖片、SHA-256、1280×900／390×900尺寸：`/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-b/reviewer-original-notes.json` 與 `image-provenance.json`。這批捕捉版本為 b011873，tag參考圖沒有保留SHA，明列unknown；本輪HEAD並不代替capture SHA。

已修正 `/my/` 原表誤寫「未capture」：原有兩張匿名200的實際畫面；只有登入後／權限／錯誤／互動狀態仍缺。其餘三route的這批證據接續原表引用，沒有新fixCommit或現行版本retest。可見區域沒有新阻擋問題，API範例密度/斷字、登入次要連結辨識、opt-out淺灰CTA屬low觀察；未操作互動、未驗完整API長頁或登入資料，故四route維持pending。

### 後續 capture 的安全修正（沒有執行新 capture）

工具 commit `71738b2`：[`tools/ui-capture.mjs`](../tools/ui-capture.mjs)，[`工具限制與使用方式`](../tools/ui-capture.md)，[`13項pure/mock測試`](../tools/ui-capture.test.mjs)均離線通過。預設dry-plan；最多4張固定viewport，按未壓縮像素估算並限制50MiB；扣預算後保留111.5GiB＋512MiB；啟動與逐頁檢查load與配額；導航前default-deny外部流量與GA/GTM，DNT／opt-out／service-worker guards維持。每document要求觀測到的release與BUILD_ID，產物只標captured-unreviewed，finally記真實停止與close狀態，不把工具成功當作頁面review。

**尚未整合全域quota controller，亦未證實正式端可提供可信BUILD_ID header**；工具因此拒絕真實capture。本輪沒有執行`--capture`，也沒有為此新增部署或偽造版本標頭。現有老capture scripts與gate檔保留為歷史證據，後續不得繼續無門檻重跑；舊regex在離線測例實際可匹配正常GA/GTM，不宣稱不存在的regex修復。

### 離線 batch B2：可見靜態內容與 429 不混算

GPT-6.1 Sol 再逐張讀取36張既有blog/tag圖，九個畫面狀態：authors正常／missing、tags正常／missing、ranking、about、admin、admin-discovery、404。原始model receipt同一raw rollout **line1845、UTC21:35:08.463Z**；實際view_image calls1855/1863/1871/1879/1887/1895/1907/1915/1923（UTC21:35:41–21:37:02）。逐頁輸入、hash、viewport、capture UTC與URL見 `/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-b2/reviewer-original-notes.json` 和 `image-provenance.json`。這些都是b011873舊圖；tag SHA沒有保存則標unknown，不捏造版本。

- authors/tags/ranking可見區域已對照，但全表、sticky/橫捲與互動尚未驗；tags-missing的選擇狀態在截圖下方，不能只看主列表就判missing通過。
- authors-missing、admin、admin-discovery、404的圖只顯示原始JSON429，沒有真正的missing/admin/404模板，原pending/issues維持。
- **about由pass降為pending**：390圖只到「作者與標籤」開頭，後半、隱私、更正與footer沒有畫面；先前可見區域的正面評價保留，但不足以支持整頁pass。這是修正驗收範圍，沒有產品退化的宣稱。
- 無圖的500與tech不納入本批完成數，沒有虛構fixture。權威狀態因此為 **pass0／fixed3／issues4／pending15／n/a-ui2**。

### 離線 batch A：獨立 Opus 圖片輸入與具體發現

獨立 `claude-opus-5-5` 實際Read20張PNG（blog12、tag8），覆蓋目錄正常／少筆／空、部落格詳頁、關係圖、流量，共四route／六case。`/home/deck/.t3/userdata/ui-review-blog-20261013/offline-20261013-a/opus-review-verified.json` 記載每張Read call ID、原始行數、成功image block、PNG hash與1280×800／390×844尺寸；原始 transcript 是同目錄 `opus-review.jsonl`，原始回覆是 `opus-result.original.txt`。實際model只有claude-opus-5-5，result line103=`success/end_turn/completed`、is_error=false；**工具程序exit143**也照實記錄，不冒稱exit0。完整result與20圖回傳均已核對，未觀察到截斷；raw及原圖完整保留。

最優先的可見問題是390目錄的名稱被網址擠窄（Herbert Lui也截斷）及首屏僅兩欄。採納名稱優先、隱藏次要網址、首欄縮小與欄寬一致的修正方向；**不採納Opus「網址另起一行」建議**，因使用者明定每列單行。其他P3/info（小資料量關係圖留白、文字雲字級、traffic首屏排序／圖例等）先記錄，在目前candidate與不同資料量核對後才決定，不將舊b011截圖當成現行427退化證據。

六case均issues-found，四route由pending改為issues；互動、深色、未截到的內容仍待驗。所有圖片來自已存在檔案，未產生新capture。A的部分tag參考capture時間／HTTP狀態未保留則明列unknown，不能由畫面猜200。協調agent的模型與真正image reviewer分開記錄，不冒充指定模型。

本輪合計 **76張實際圖片輸入（blog40／tag36）**，兩批GPT-6.1 Sol與一批Opus；覆蓋15個不同route的部分靜態狀態，並非15個整頁pass。權威盤點維持24項，最新 **pass0／fixed3／issues8／pending11／n/a-ui2**；fixed只表示先前指定修正已驗，不等於該route所有狀態通過。


### 歷史操作限制：當時全部新增 capture 停止（現行 gate 見頂端4cc節）

使用者回報 `/home` 107.80GiB，已低於112.5GiB截圖停止線。本限制取代先前「門檻符合即可新capture」的操作條件：只允許既有圖的離線review與不產生建置產物的小型程式碼／文件修正。禁止新截圖、capture、建置、匯出與大型寫入，不刪檔、不碰tag-backup；空間回升不會自動解除。capture CLI已在讀計畫／載入Playwright／建立artifact目錄之前無條件拒絕`--capture`。純函式與mock用於離線驗證，不是實際瀏覽器執行權限。

## 歷史：凍結期間缺件盤點（2026-10-13，離線；最新缺件見頂端4cc節）

本次主表為 24 項：pass 0、fixed 3、issues 8、pending 11、n/a-ui 2；先前交辦的「14 pending」並非本次主表數字。fixed 只代表列出的修正範圍，不能視為整頁所有狀態已通過。

獨立 reviewer：GPT-6.1 Sol；UTC `2026-10-12T23:05:36.514395+00:00`。逐頁缺件及 PNG hash、尺寸、舊版 SHA、參考圖皆在 [原始報告](/home/deck/.t3/userdata/ui-review-blog-20261013/pending-evidence-audit-20261013-b/pending-evidence-audit.json)。[原始 transcript](/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T03-13-01-01a13188-57d9-7543-bb11-3ef610ddcb3c.jsonl) line 1954 為 model receipt、1993 為四張既有 500 圖的實際 view call。沒有新增 capture、HTTP、DB、build 或帳號。

這四張歷史 500 圖可見錯誤說明和重新載入按鈕（1280×800／390×844），但缺現行 SHA 的畫面、恢復互動與 tag 同狀態參考。既有 B1/B2 review 不重複計入新完成頁數。現行驗收目標為 `42711cf18c452b406904af6000ccbf88a1ff6102`；舊 `b011873` 圖不能代替。

| route | 證據狀態 | 仍缺的必要狀態 | 主表狀態 |
| --- | --- | --- | --- |
| /tags/ | missing | 多筆/少筆/空資料/不存在標籤/錯誤；完整內容、篩選及連結操作；現行 SHA 桌機／手機與對應 tag 參考 | pending |
| /ranking/ | missing | 多筆/少筆/空資料/錯誤；完整排名、期間切換與圖表；現行 SHA 桌機／手機與對應 tag 參考 | pending |
| /about/ | missing | 完整靜態內容與必要連結；多/少/空 N/A；現行 SHA 桌機／手機與對應 tag 參考 | pending |
| /api/ | missing | 完整文檔與下方端點/範例/連結；多/少/空 N/A；現行 SHA 桌機／手機與對應 tag 參考 | pending |
| /login/ | missing | 登入前、取消、失敗、合法登入結果與next導向；現行 SHA 桌機／手機與對應 tag 參考 | pending |
| /my/ | missing | 匿名、合法授權帳號、多/少/空/錯誤；個人追蹤與RSS/OPML/API key狀態（需合法授權）；現行 SHA 桌機／手機與對應 tag 參考 | pending |
| /observe/opt-out/ | missing | 目前停用、恢復、DNT/GPC、儲存不可用；實際操作與持續狀態；不得為驗證外送GA；現行 SHA 桌機／手機與對應 tag 參考 | pending |
| /admin/ | missing | 匿名導向、非管理員403、合法管理員內容/空/錯誤；現行 SHA 桌機／手機與對應 tag 參考 | pending |
| /admin/discovery/ | missing | 匿名導向、非管理員403、合法管理員列表/空/錯誤；現行 SHA 桌機／手機與對應 tag 參考 | pending |
| 500 (error.tsx) | missing | 現行安全fixture錯誤畫面、重新載入/恢復、完整內容；對應tag錯誤基準；現行 SHA 桌機／手機與對應 tag 參考 | pending |
| /tech/ | missing | 實作候選SHA與正常/少筆/空/錯誤/未知版本；觀測scope、歷史failed、partial2000scan、flags false及profile可選tech失敗；現行 SHA 桌機／手機與對應 tag 參考 | pending |

本批另修復歷史附錄曾遭主表更新程式跨區改寫的欄位，還原為 `e2929a8` 的 superseded 附錄；現行主表與原始 review artifacts 保留，不補造歷史紀錄。

## 新 B2 source 批次（待重拍，不升 UI pass）

`/blogs/<slug>/` 的引用與交流新增有界文字配對consumer。作者為既有Opus5.5；另一既有Sol的source／48 SSR複審紀錄：`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/b2-opus-ui-independent-followup.json`。這不是看圖review；尚缺該新SHA／BUILD_ID在1280／390、深淺色的實際圖與tag對照。ready兩邊日期、disabled、無已知target、insufficient、unavailable／withdrawn、截斷都在Mint重拍清單。主表計數不變：24項，pass0/fixed3/issues8/pending11/n-a2。沒有從source通過推成整頁通過。


## 2026-10-14：9888ebf 同產物 candidate 主要頁實際 review

受審 release `9888ebf36229400c2323ae12334d72280cbe699a`，BUILD_ID `Rkz0sExkVW-uDfl_srJEX`，tree `b4d90f8e717831532b1b5986f3ec51d0262bd11d`。來源未重建，blue loopback 18174/18172，正式仍 green/gen5。此 ledger 補記在 OPS 分支，凍結 main／受審 release 不改。

既有非作者 `/root/home_perf`（實際 `gpt-6.1-sol`，UTC 2026-10-14T05:54:35.818227+00:00）逐張看過20 candidate圖及8 tag參照；raw review `/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/9888ebf-candidate-actual-ui-review.json`（sha256 `be41dc9ec0ea6d5dc1ec41ae92d018b6b252e0ccb1d4e7b590289f43d58cee84`），log同名 `.log`。原始 transcript `/home/deck/.codex/sessions/2026/10/13/rollout-2026-10-13T13-12-51-01a133ad-8034-7e81-a619-c9d28bd4ff5f.jsonl`，JSON逐圖記工具line／UTC／hash／viewport。

capture manifest `/home/deck/.t3/userdata/blog-release-9888ebf-candidate-20261014/submission-manifest.json`（sha256 `268b462a9b8434975c7fffd0cba2387ebeb606e12ea030969bec8a31a788ab84`）；每組private PNG均為 `page-1-1280-light.png`、`page-2-390-light.png`、`page-3-1280-dark.png`、`page-4-390-dark.png`，每組 `capture-report.json` 真實核對PID/socket/source764files/SHA/BUILD_ID。實際 document/navigator DNT=1，GPC=null如實保留；pre-navigation network guard installed，GA/GTM attempted=0、analytics allowed=0，browser closed=true。這是攔截層證據，不是封包追蹤；root沒有補造舊manifest。

| route／實際候選 URL | reviewer／受審 SHA | 桌機1280／手機390截圖目錄（含light/dark） | tag偏離與理由 | 發現／修正／重驗 | 狀態 |
|---|---|---|---|---|---|
| `/`；`http://127.0.0.1:18174/` | GPT-6.1 Sol；9888ebf／Rkz0sExkVW-uDfl_srJEX | `/home/deck/.t3/userdata/blog-release-9888ebf-candidate-20261014/home/`（上述四檔） | tag新聞焦點/熱門關鍵字橙色，blog用綠色生活標籤與公開文章，不要求同新聞圖卡功能。 | 首篇公開文章標題原始 &#038; 在四張圖均顯示，內容呈現小問題，非阻擋。。無新runtime修正commit；此次已以9888同產物重拍。待驗：手機下方共同話題/sidebar未入鏡；Suspense pending/late error與搜尋/menu/theme實際操作；第三篇以下完整列表與footer | pending（僅visible-pass） |
| `/tech/`；`http://127.0.0.1:18174/tech/` | GPT-6.1 Sol；9888ebf／Rkz0sExkVW-uDfl_srJEX | `/home/deck/.t3/userdata/blog-release-9888ebf-candidate-20261014/tech/`（上述四檔） | tag traffic只作表格容器/搜尋/密集列基準；tech是被動觀測證據統計，不具媒體流量月份/sparkline功能。 | 入鏡範圍無阻擋。無新runtime修正commit；此次已以9888同產物重拍。待驗：390部落格表格位於900px下方未入鏡；Desktop表格右側成功時間部分裁於容器邊，橫向scroll/排序/搜尋/最後欄操作未驗；方法說明與低於首屏其他技術卡/完整清單 | pending（僅visible-pass） |
| `/relations/`；`http://127.0.0.1:18174/relations/` | GPT-6.1 Sol；9888ebf／Rkz0sExkVW-uDfl_srJEX | `/home/deck/.t3/userdata/blog-release-9888ebf-candidate-20261014/relations/`（上述四檔） | tag新聞圖有多關係色/期間/排名/zoom controls，blog本圖只正文直接連結且實際資料少，大片留白與較簡控件不視為缺媒體功能。 | dark圖下方法fineprint偏暗，列後續對比驗證，不以肉眼判定WCAG數值通過。。無新runtime修正commit；此次已以9888同產物重拍。待驗：節點hover/click/tooltip/zoom與各期間切換；手機下方互相提及卡及所有列表；實際邊方向資料正確性屬既有source/SQL證據，圖片不重證 | pending（僅visible-pass） |
| `/blogs/kocpc/`；`http://127.0.0.1:18174/blogs/kocpc/` | GPT-6.1 Sol；9888ebf／Rkz0sExkVW-uDfl_srJEX | `/home/deck/.t3/userdata/blog-release-9888ebf-candidate-20261014/blog-profile/`（上述四檔） | tag媒體資訊/多日收錄/新聞關鍵字，blog核對網站/本頁50篇/內文來源技術證據，保留相似頁面層次但資料語義不同。 | 入鏡範圍無阻擋。無新runtime修正commit；此次已以9888同產物重拍。待驗：mobile收合展開後技術/來源/流量狀態；相關作者/來源資料tabs與追蹤操作；下方完整文章/方法/技術證據狀態 | pending（僅visible-pass） |
| `/blogs/kocpc/#relations-body`；`http://127.0.0.1:18174/blogs/kocpc/#relations-body` | GPT-6.1 Sol；9888ebf／Rkz0sExkVW-uDfl_srJEX | `/home/deck/.t3/userdata/blog-release-9888ebf-candidate-20261014/blog-exchanges/`（上述四檔） | 不是tag新聞copy關係，只針對本blog已觀察正文links、另列其他關係；disabled comparison是清楚標示的狀態，不能當populated B2結果驗收。 | 入鏡範圍無阻擋。無新runtime修正commit；此次已以9888同產物重拍。待驗：anchor圖从中段起，上方title/期間與sticky-header offset未完整入鏡；非空直接引用證據/共同標籤/文字相似啟用結果未展示；方法link展開/下方話題及完整AI閱讀線索未入鏡（desktop只有線索上緣） | pending（僅visible-pass） |

五模板 blocker 均 false，但**全24項權威狀態仍 pass0／fixed3／issues8／pending11／n/a-ui2**；不把首屏、B2 disabled比較空態或tag缺dark參照當整頁／全部資料狀態通過。首頁raw `&#038;` 與dark小字contrast列後續修正/實測，220 unsupported LAB samples不能冒稱WCAG AA通過。新feature公開前已完成本批主要頁非作者實際看圖；正式瀏覽器驗收仍待。

非UI技術檢查（n/a-ui）：`tests/integration/visibility-barrier.mjs`／`tools/test-visibility-barrier.mjs`，same-release existing runner raw evidence `/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-final-barrier/9888ebf36229400c2323ae12334d72280cbe699a/{runner-result,barrier-result,sequence-result}.json`，53barrier＋60sequence；isolatedDB18169/HTTP18176/18177。Liveblue17 HTML/RSC/API/sitemap GET全部200及no-store，raw `/home/deck/.t3/projects/blog-observe-tw/.reviews/sm-build-9888ebf/blue-http-9888ebf-recheck.json`。首次任意 `_rsc`307與缺techflag404兩次失敗原log保留；只用existing cache-busting helper及blue旗標true精確匹配green，沒有放寬斷言／改source。

操作狀態：switch前fresh曾blog median7.284s/load12.17而暫停；原量測 `/home/deck/.t3/projects/blog-observe-tw/.reviews/sm-build-9888ebf/switch-submission-fresh.json` 保留，不能當通過。switch／rollback尚未執行，no-store與CF Disabled維持。


## 2026-10-14 下一批執行中

使用者已取消逐命令等babysit核對／密集小步review。f091首次build完成，但
真SQL發現coverage排序欄位歧義，未進正式；修為ranked欄位後四個隔離suite通過，
新candidate需要新commit/build。正式仍blue/gen12/43d。前述source GO仍適用
已審的UI；排序qualification僅後端一行，已正常測試／自檢。
新actual viewport、model看圖、release/build和部署證据仍待補，不將舊圖當新圖。


## 2026-10-14 正式 green/gen13：首頁正文引用與詞雲品質

APP 76a90e7a4126832331761baca7c10d2133272b18 / tree396a5f3724376d3f66582a3fcd70223c26f03370 /
BUILD_ID1VV772sbyYBRdL9ur6l9f。切換 UTC 2026-10-14T13:58:01.263271+00:00，
正式16項驗證於 2026-10-14T13:58:59.022777+00:00 完成；no-store/DYNAMIC/HSTS、
OAuth302 S256、SSRF400、話題100/home8、正文引用5、三站200通過。
正式edge active.json=green/gen13；blue43d在線可立即rollback blue，原green4cc、
f091未切換產物、所有backup/worktree皆保留。正式資料無migration／刪除。

actual候選12張（home/topics/blog各1280/390、light/dark）唯一manifest：
/home/deck/.t3/userdata/blog-home-display-76a-20261014/submission-manifest.json
DNT1、navigatorDNT1、GPCnull；網路deny在首nav前裝好，analytics allowed0。
既有非作者Sol實際逐圖＋6張tag参照的review：
/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/76a-home-display-independent-actual-ui-review.json
SHAb16e9eac7d3186670ec4160968fd0d38af3c8d8b852bb252ed974d4587c60a85。
只本次三模板入鏡範圍無blocker；互動、展開、空錯、其他route仍pending，
不升完整route pass，也不冒稱精確對比度通過。

B0同immutable76a的53barrier/60sequence：
/home/deck/.cache/blog-display-noise-20261014/.reviews/display-noise/b0-final-76a-attempt3/runner-result.json
同目錄barrier-result.json、sequence-result.json；DB18169/HTTP18176/18177，
SHA/build/tree與driverhash在artifact。原失敗檔全部保留。
測試driver僅補首頁仍保留的latestPostTitle觀測欄位，原assert/容量/commit/fresh-read
不刪；imports與Next/process/build checks仍指向immutable76a。相對路徑搬移失敗
attempt2也保留，不拿錯誤artifact當成功。此OPS僅test/docs，runtime未改或重建。

首頁五次完整HTML：candidate中位3.600061s、部署前正式2.539592s，
兩者含來源/edge/網路且不同hostname，不能當精確origin同條件速度提升。
本批較慢的觀測照實保留，不用選最快一次當驗收。

Babysit人類在UTC14:01正式1280/390 opt-out/GA0驗收通過：三區已移除、
文章→網域/時間/核對列存在、手機無横向捲動；無Uncategorized/未分類/每天。
未提供新正式截圖路徑，不捏造model看圖。後續cloud恢復30詞、同文章多target合併、
泛詞品質與F1接入是下一批，尚非已完成。

## gen16頂端狀態存檔（保留原文，非現況）

## 目前狀態（2026-10-14 UTC16:22正式驗收後）

- 正式：**blue／gen16／af0e73ccc3c5ace88dc8fb6f45d7d76123c218da**，UTC16:14:07.167切換。
  BUILD_ID **LdOP5yqOhKdYbIlHZVfoN**。green／76a90e7保持在線回滾。依[使用者核准的滾動保留政策](release-retention.md)清理舊release／建置checkout；備份、正式資料、一般worktree與review證據保留。
- 建置位置：**Steam Machine（SM）**。本批只有gateway SQL改動，web tree與兩份lockfile完全相同，
  沿用f77已build/review的前端產物，沒有新的Next build；新APP＋同frontend compose後跑完新SHA的B0。
  Mint／gen5／SM禁止build的舊段落只代表當時狀態，不代表現行流程。
- 已由人類正式驗收：gen12（43d）的話題非空與HTML entity修正；gen13（76a）的首頁三區塊移除＋正文引用；
  **gen16 UTC16:22**的30詞雲、保留景點、排除人氣／傳承／每天／Uncategorized／未分類、
  「文字雜想」同文兩網域合成一卡與GA0。未提供人類capture路徑／viewport，不補造資料。
- 效能：gen14 f77於15:49:10.762因三次median **6.188152s**回滾green／gen15／76a。
  gen16正式五次median **2.679479s**；人類三次4.19／2.84／2.63，median **2.84s**。
  這是公開網址HTML完整回應時間，非純origin render或TTFB；no-store／DYNAMIC、HSTS86400不變。
- 技術驗收：新APP af0的 **53 barrier＋60 SSR/RSC**、386 topic tests、18查詢比較／6 fresh-read barrier，
  B3兩suites47checks通過；正式21項HTTP驗收、三站200／OAuth302／SSRF400／404／no-store通過。
- F1關係：正式共用標籤區塊與本地快照已接入；worker目前也是af0，6小時排程、每日40次wire上限。
  UTC16:17的blogs-shared-labels已實際完成，relations與visual各13個ready快照；空結果不是缺資料。
  柯文哲上位分類政治人物＋相關／別名／圖示「尚未收錄」已有候選actual圖review，正式專項瀏覽器回報仍待補。
- UI證據：f77前端的home／shared／topics共12張1280／390 light/dark＋6張tag參照，由非作者Sol實際看圖。
  frontend與af0完全相同，但**不把f77的APP screenshot metadata改寫成af0**；af0尚無新capture，僅同產物技術與人類正式驗收。
  reviewer原檔：/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/f77-home-cloud-independent-actual-ui-review.json。
  source效能review：同目錄compact-ranking-independent-source-review.json；author／model／UTC／逐圖hash／raw transcript均保留。
- 未完成：**F3歷史全文搜尋／蛤蜊絲瓜、所有route和重要狀態逐頁review（admin、空／錯／權限、展開／手機表格右欄／belowfold／精確contrast）、
  真人Google登入、F1正式專項畫面證據**。不以本次首頁驗收宣稱完整scope完成。Cloudflare兩條規則維持Disabled。
- 待評估詞（不擋目前上線，不另造詞名黑名單）：**壓力／生日／保險**有至少一站crawler topic角色／topic種類的原始標籤佐證，
  因此依同一個保留景點的規則保留；**眼睛**32站39篇，但每站最高2篇，未達tag broad的peak≥3。
  長期基準title/matched依序壓力0/69、生日7/47、保險6/53、眼睛1/46；資料讀取時間相異，不冒稱同一交易快照。
  是否應改採tag early qualification或顯示上位主題留待後續評估，這批不為移除四個名字而調門檻。

證據位置：
/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/home-cloud-b3/formal-acceptance-af0.json、formal-five-samples-af0.json、
formal-performance-parts-f77.json、f77-performance-followup-gate.json、lifestyle-word-audit-af0.json、lifestyle-baseline-af0.json。
新B0：/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-final-barrier/af0e73ccc3c5ace88dc8fb6f45d7d76123c218da/runner-result.json
與同目錄barrier-result.json／sequence-result.json，實際APP/tree/BUILD_ID／DB18169／HTTP18176、18177／UTC在原檔。
