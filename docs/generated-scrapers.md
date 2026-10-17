# 自動產生的部落格爬蟲

沒有 RSS／Atom／文章 sitemap 的部落格，以及 feed 或內文已經爬不到的部落格，由 CLI Proxy 的 `sky-quality`（Codex quality）替該站寫一支 JS 爬蟲，在沙箱裡用真實頁面驗證，通過即自動上線（使用者已授權，與 BlogBlog.Club 自動收錄同一政策）。程式在 `app/src/scrapers/`。

## 爬蟲的形狀

模型回傳 strict JSON：`listUrls`（同站列表頁，最多 3 個）、`maxPages`（1–3）、`code`、`notes`。`code` 只定義兩個同步純函式：

```js
function listPosts({ url, html, $ }) // → { posts: [{ url, title, publishedAt }], next }
function parsePost({ url, html, $ }) // → { title, author, publishedAt, tags, bodyHtml }
```

`$` 是已載入該頁的 cheerio（列表頁若是站方自己的 RSS／Atom／sitemap，則為 XML 模式）。爬蟲**只解析一頁 HTML**：抓頁一律由受信任的 `politeFetch` 負責（robots、DNS 釘選、每站延遲、8 MiB 上限），輸出再經 `contract.ts` 驗證——只留同 publication 的文章網址、合理日期、≤ 20 個標籤、≤ 512 KiB 內文。

## 需要 JS 的網站（`render.ts`）

- **內嵌資料**：骨架保留 `script#__NEXT_DATA__`、`type="application/json"`、JSON-LD 與 `window.__NUXT__` 這類狀態，JSON 壓縮成形狀（陣列留 2 項加數量、字串截短，保證仍是合法 JSON），爬蟲可在沙箱裡 `JSON.parse`。多數 Next／Nuxt 站不必開瀏覽器。
- **無頭瀏覽器**：`playwright-core` 帶動 Playwright 自己的 chromium headless shell（Chromium 沙箱開啟），經 `render-scope.sh` 放進獨立 systemd scope（MemoryMax 640M、CPUQuota 50%），不佔 worker 的 768M。每頁先經 `politeFetch`（robots、公開位址、HTML），再渲染同一頁；圖片、影音、字型不載，子請求逐一檢查公開位址，主框架不能導到別的站，service worker 停用。一次只渲染一頁，閒置 60 秒關閉。
- **何時渲染**：首頁幾乎沒有文字、站內連結少且沒有內嵌資料時，第一輪就用渲染頁；否則原始 HTML 那輪若列不出文章、抽不到內文，或模型回報 `needsRender`／`noArticles`，下一輪改用渲染頁（只切換一次）。通過的爬蟲記下 `blog_scrapers.render`，日常爬取與內文 worker 都照這個模式抓頁。`BLOG_SCRAPER_RENDER=false` 或沒有瀏覽器時只讀原始 HTML。
- **空部落格**：模型回報 `noArticles` 且驗證也列不出文章（已看過渲染頁）就提早結束，原因 `site_has_no_articles`。soufflesound.com 的原始 HTML 只有「Coming Soon」，渲染後才出現文章，所以會先渲染再下結論。
- **標籤**：爬蟲抽到的 `blog`、`posts`、`Uncategorized`、`未分類` 等區段／佔位名稱會被濾掉（`contract.ts` 的 `GENERIC_TAGS`）；RSS 分類不受影響。

## 沙箱（`sandbox.ts`，任一層缺少即拒絕執行）

1. `bwrap --unshare-all --clearenv`：沒有網路 namespace（連 127.0.0.1:8317 也碰不到）、沒有 /home、沒有環境變數（拿不到 API key、DB URL）；只唯讀掛載 `/usr`、node、`node_modules` 與 runner。
2. `node --permission --allow-fs-read=/sandbox --disallow-code-generation-from-strings --max-old-space-size=128`：不能讀其他檔案、寫檔、開子程序或 worker；主 realm 也不能 `eval`／`Function`，擋住 `$.constructor.constructor` 這類逃逸。
3. `vm` context 只有 `__page`、`URL`、`URLSearchParams`，2 秒 timeout；父程序 5 秒 SIGKILL、stdout 2 MiB 上限。
4. 靜態檢查（輔助，不是邊界）：≤ 40 KiB，不得出現 `require`、`process`、`constructor`、`fetch`、`eval` 等識別字。

`sandbox.spec.ts` 直接驗證以上各層（逃逸、網路、env、/home、子程序、無窮迴圈、輸出與記憶體炸彈）。worker 的 systemd unit（`NoNewPrivileges=true`）下 bwrap 可用。這些層只套在模型寫的程式碼上；瀏覽器執行的是網站自己的 JS，由 Chromium 沙箱與上一節的請求規則限制。

## 產生與驗證（`generate.ts`）

1. 抓首頁，啟發式挑一篇文章；HTML 壓成骨架（去 script／style、保留 class／id／href／datetime／itemprop／JSON-LD／onclick 等）送模型。頁面內容在 prompt 中明示為不可信資料。
2. 真實頁面試跑：列表至少列出文章；抽 3 篇（不足 3 篇則全抽）都要有在該頁出現過的標題、經 `extractContent` 認可且 ≥ 50 字的內文（至少一篇 ≥ 200 字），且標題、內文彼此不同（防寫死）。翻頁失敗不算失敗，只讀第一頁。沒有日期也不算失敗（例如數位花園筆記站）：日期依序取文章頁、列表頁，都沒有就用首次抓到的時間（使用者決定，2026-10-17）。
3. 不通過就把問題、舊程式碼與失敗頁的骨架回饋給模型，最多 3 輪；每輪佔 `scraper:gateway` 每日 18 次額度。

## 觸發（`repair.ts`，獨立 queue `<BLOG_QUEUE_NAME>-scrapers`，每 30 分鐘一輪）

依序挑：

1. **爬蟲失效**：啟用中的爬蟲連續 3 次列不出文章或全部文章解析失敗；帶舊程式碼與錯誤請模型修。
2. **feed 失效**：verified 超過 14 天、爬蟲仍在跑，但 14 天內沒有任何 feed 抓取成功（feed 有回應只是沒新文不算）。
3. **新候選**：候選審查原因為 `rss_or_article_sitemap_required`／`no_verified_feed_or_sitemap`，且已證明是個人首頁或列在 BlogBlog.Club（多數無 feed 的候選是商店、機構，不花額度）。重新跑 `validateCandidate`；若 feed 出現就走一般審查。通過後經 `recordCandidateCheck` 收錄（同一交易鎖定並啟用 `blog_scrapers` 列，不寫 `feed_sources`，沿用每日收錄上限，稽核來源 `automatic-scraper-review`）。
4. **內文抽不到**：`content_blog_rules` 為 `missing／no-semantic-body` 且 14 天沒成功。啟用後該站 missing／partial 內文立即重排。

每個目標的結果寫入 `scraper_generation_attempts`：失敗或略過冷卻 14 天，成功冷卻 3 天。修復 worker 用自己的兩條連線 pool，不佔爬取 worker 的連線。

## 依 Codex 剩餘額度調整（`ai/quota.ts`）

用多少由剩餘額度決定，沒有固定的每日上限（使用者決定，2026-10-17）：

| 剩餘額度 | 每輪（30 分鐘）處理的目標 |
|---|---|
| ≥ 80 % | 4 |
| 50–80 % | 2 |
| 20–50 % | 1 |
| < 20 % 或查不到 | 0（完全不跑） |

- 剩餘額度：讀 status.skyhong.tw 的公開 JSON（`/api/status`，`BLOG_QUOTA_STATUS_URL` 可覆寫，不需金鑰）。各 gateway 主機每 5 分鐘回報 CLIProxyAPI 帳號的 `remainingPercent`；取 Codex 帳號（各主機同步的同一批登入只算一次），去掉停用、登入被拒、有錯誤或 down 的，再取平均。主機回報超過 20 分鐘或標示不新鮮就不採用；沒有可用帳號即視為查不到。`gateway.usage` 那一區量的是另一個帳號（`accountMatches: false`），不採用。讀數快取 5 分鐘。
- 每一次模型呼叫前重查（快取內不重打），額度掉到 20 % 以下就中途停，原因 `model_budget_unavailable`，該目標不記冷卻。
- 防失控的保險：每日最多 100 個目標、300 次模型呼叫（`work_budgets` 的 `scraper:*`）。`tools/scraper-once.ts --quota` 印出目前讀數與每輪目標數；操作者手動執行不受額度門檻限制。

## 上線後怎麼跑

- `crawlBlog`：有啟用中的爬蟲且 14 天內沒有 feed 成功時改走爬蟲——跟著 `next` 讀最多 `maxPages` 頁、遇到全是已知文章就停，每次最多 10 篇新文章（history 模式 20 頁／50 篇），轉成 `FeedEntry`（`source_type='scraper'`）寫入，作者、標籤、內文與全文索引都走既有 `writeFeedEntries`。feed 恢復後自動交回 feed。
- 內文 worker：有啟用中爬蟲的站，文章頁先經 `parsePost` 取內文，失敗則用原頁。
- 爬蟲每次執行更新 `blog_scrapers.last_success_at／consecutive_failures／last_error`。

## 操作

```sh
# 預覽（不寫入）：自動挑目標，或指定候選／部落格；--code 印出程式碼
node --env-file=/home/deck/.config/blog-observe.env tools/scraper-once.ts --candidate 6558 --code
node --env-file=/home/deck/.config/blog-observe.env tools/scraper-once.ts --blog 42 --trigger content_failing
# 實際收錄／啟用（略過每日目標額度，不略過每輪模型額度）
node --env-file=/home/deck/.config/blog-observe.env tools/scraper-once.ts --candidate 6558 --apply
```

worker 需 `BLOG_SCRAPER_GENERATION_ENABLED=true`（預設關閉，關閉時移除排程）；bwrap 不在 `/usr/bin/bwrap` 時設 `BLOG_SCRAPER_BWRAP`。

回滾單一站：`UPDATE blog_scrapers SET status='rejected' WHERE id=?`——該站回到 feed（若有），否則下次符合條件時重新產生。整體停用：關掉 env 並重啟 worker；已收錄的站保留，只是不再更新。
