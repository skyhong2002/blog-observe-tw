# 部落格圖示來源與更新

圖示處理選擇性移植自新文易數固定版本 `afe0a653fa8aae7e25a04a1d9fe87bf0400a2a39` 的 `tools/fetch-favicons.ts`，保留 MIT 與 `Copyright (c) 2026 Sky Hong`。使用相同的 192×192 PNG 透明留白轉換及 ICO 最大圖層優先策略；補上 ICO 邊界檢查與解碼像素限制。

## 來源與隔離

工具唯讀查詢 blog 專屬資料庫中的 `blogs`；`--include-candidates` 另讀全部 discovery 候選，使用 `candidate-<id>` 作本機檔名。抓圖示不會核准候選、不會新增追蹤、不會變更原始網址；缺少網址直接記錄 `default / no-source-url`，不依名称猜網域。

取得順序為網站 HTML 的 icon、apple-touch-icon、mask-icon，接著 manifest 的 icons、明確站點 logo／作者介紹圖、og:image，最後 `/favicon.ico`。作者圖片限語義明確的 aboutme widget、介紹自己的側欄，或標題與站名完全一致的 image widget；不抓一般文章縮圖、熱門文章、廣告或合作平台標章。站點 logo 限頁首／導覽品牌區，支援宣告在 `data-src`／`data-lazy-src` 的延遲載入圖片，不使用透明 placeholder。沿用原頁的完整 URL 解析相對路徑，避免把平台作者頁當成平台首頁。共享平台的總站圖示會被排除；取不到可歸屬該站的圖示時顯示預設圖示，不以平台品牌冒充作者。

每次批次用站點身分去重複抓取：一般獨立網站使用 origin，共享平台保留作者子域或作者／salon 路徑。每一個輸入仍分別寫入結果與原始 URL，候選不因同 host 就互相合併。這是圖示快取重用，不是部落格身份合併。

## 禮貌與限制

所有 HTML、manifest、圖片及每一跳轉址都經由既有 `politeFetch`，共用 robots、可識別 User-Agent、每站延遲、DNS／IP 安全驗證與連線釘選。工具只有一個 worker，單請求 timeout 8 秒，每個站點開始新請求前檢查 30 秒時間預算；候選來源去重後最多 24 個，受相同時間預算限制，保留 ETag／Last-Modified 做條件請求。HTTP 狀態 304 沿用已驗證的圖示或已解析的來源清單；HTML 解析快取帶版本，新增解析規則時重新下載首頁，避免永久沿用舊空清單。

圖片必須回傳 `image/*`，所有 response 限制 8 MiB；解碼限制 16,777,216 pixels，SVG 禁止外部資源、內嵌圖片與 XML entities；不收動畫多頁圖、不接受小於 16 px 的來源。ICO 限制 256 個目錄項目，解碼前驗證資料邊界及分配大小。轉換後為 192×192 PNG，保存 SHA-256 revision。沒有通過下載、MIME 與實際解碼的來源不會設定 `verified: true`。

`app/data/.favicon-refresh.lock` 以 exclusive-create 防止兩個批次重疊；不自動接管疑似過期鎖。若程序異常退出，先核對檔內 PID 確實已終止，才由維運移除鎖。每處理一筆就原子更新 catalog／local checkpoint，中斷後可重跑；已成功圖示預設略過。

## 執行與每月刷新

```sh
node --env-file=/home/deck/.config/blog-observe.env tools/fetch-favicons.ts
node --env-file=/home/deck/.config/blog-observe.env tools/fetch-favicons.ts --include-candidates
node --env-file=/home/deck/.config/blog-observe.env tools/fetch-favicons.ts --monthly --include-candidates
node --env-file=/home/deck/.config/blog-observe.env tools/fetch-favicons.ts --all writer-slug
```

預設僅補缺圖；`--all` 強制重新檢查；`--monthly` 只重新檢查超過 30 天的成功圖示，同時補缺圖。可以用環境變數 `BLOG_FAVICON_ROOT` 指定持久化目錄，預設仍為專案根目錄。正式排程以 blog 自己的 timer／worker 執行，不修改 tag／youtube 的排程。`refreshFavicon(target, { refreshAfterMs: MONTH_MS, state, batchCache })` 可供 worker 呼叫，但呼叫方必須維持單一程序互斥與循序執行。

輸出位於所選 root 下：

- `app/data/favicon-catalog.json`：每筆原始 URL、名稱、種類、已驗證來源 `icon`、`verified`、候選來源清單、條件快取及成功／失敗／預設原因。
- `app/data/favicon-local.json`：圖示來源、抓取時間、revision、原尺寸、透明資訊及對應站點 URL。
- `web/public/favicons/<slug>.png`：本機 192 px 圖示，可由 blog gateway 的 runtime 圖示路由提供。

結尾 summary 分別列出 blogs／candidates 的 success、failure、default、skipped。失敗來源保留證據，既有成功圖檔不因一次遠端失敗就刪除。伺服器端 `iconUrl()` 保留 upstream 的已驗證原始 URL 備援；瀏覽器不載入原始 catalog，本站 PNG 失敗時顯示預設首字，避免把候選 URL、快取或 URL 中的敏感參數打包公開。


正式圖示快取位於 `/home/deck/.local/share/blog-observe/icons`，不提交候選原始 catalog 至 Git。`/api/icons` 僅回傳識別碼、revision 與 dark 樣式，前端共用一次請求；`/favicons/<slug>.png` 只提供有 PNG signature 的本機圖檔，帶 ETag 與 5 分鐘快取。重新整理頁面即可取得每月的新 revision，不需重建 Next。設定 runtime root 時不回退到舊 release 的圖檔，避免網址搬家後冒用舊站圖示。

每月刷新由 `blog-observe-active-favicons.timer` 在每月 1 日 06:20 加最多兩小時隨機延遲執行，單程序、低排程優先權、CPU 25%／記憶體 512 MiB。失敗保留同站先前圖示；網址身分變更則先移除旧圖。timer 只讀 blog DB、不操作 tag/youtube。回滾或暫停：停用該 timer 即可，保留快取與原始 evidence。

影像解碼在獨立 Node 子程序進行，4 秒牆鐘到即終止；Sharp 另設 3 秒 timeout。原始圖只渲染一次，透明度分析只處理已縮成 192 px 的 PNG。ICO 圖層尺寸須與目錄一致，拒絕截斷與超大宣告。採用子程序是為了讓 native decoder 不配合逾時時仍能停止，避免占用同機服務資源。

## 2026-10-12 失敗圖示補查

重查原先 7 個失敗站，先備份 runtime catalog／local，再用相同單程序 CLI 僅重跑指定 slug。修復 5 個，2 個仍受 robots 限制；135 個種子的本地圖示從 119 增加到 **124 個**，其餘為 2 個抓取受限、9 個缺網址。候選圖示未改動。

| 站點 | 原因與處理 |
|---|---|
| Nash、朱寶妮 | 未宣告 favicon；改用首頁明確作者介紹區的圖片 |
| 可人之家 | 宣告的圖示回應 404；改用「我是可人」作者介紹圖 |
| 美食好芃友 | 宣告的圖示路徑拼字錯誤且 404；改用官方 aboutme 圖，不猜修遠端 URL |
| WA!COOKIES | 宣告 PNG 為 4,167 × 4,167，超過既有 16,777,216 像素限制；改用官方導覽區的 100 × 100 品牌圖片，沒有放寬解碼限制 |
| 依武、CELESTETERRY | 圖片 CDN 的 robots 拒絕；維持預設圖，不改主機、UA 或代理來繞過 |

每個候選來源的 HTTP 狀態、轉址結果及 robots／MIME／解碼限制原因現在分別存於私人 catalog 的 `sourceChecks`，方便下次查修；不對外公開原始 catalog。成功的 5 張均驗證為 192 × 192 PNG，revision 與檔案 SHA-256 一致。

新收錄站另由 `blogs-missing-icons` 每15分鐘檢查 verified 缺圖站，每批最多10站／120秒，使用與CLI／月刷新完全相同的exclusive lock；最近七天失敗的相同網址不重抓。依未嘗試、最舊嘗試順序輪轉，原圖檔缺失或站點身份變更會重新取得。可用 `BLOG_MISSING_FAVICONS_ENABLED=false` 暫停，不影響既有圖示供應。

## API 與 ISR 的圖示對照

所有伺服器端 DTO 必須先讀取 `iconManifest()`，再將該快照顯式傳給 `iconUrl(slug, manifest)`；不可直接使用 Git 內的 `favicon-local.json`（正式圖示位於 `BLOG_FAVICON_ROOT`，Git 內可以是空物件）。公開 v1、目錄、overview／搜尋建議、關係與私人追蹤清單皆使用同一份經欄位過濾的執行期快照，URL 保留 revision。

目錄等元件將回應的 `iconUrl` 傳給共用 `BlogIcon`，使 ISR HTML 在 JavaScript 執行前已有圖片。瀏覽器載入 `/api/icons` 後以最新 revision 更新；沒有圖示或載入失敗時顯示首字預設圖示，不留空白。這不影響文章沒有配圖時僅顯示文字的規則。私人追蹤回應仍要求登入且為 `no-store`。

回歸驗證：`app/src/v1/runtime-icons.spec.ts` 使用獨立臨時 runtime 目錄，驗證空 bundled manifest、各 API DTO、版本更新與讀取失敗保留快照；`web/test/media-icons.test.ts` 驗證 SSR 選圖、版本優先與失敗回退。舊版曾以新 gateway 建置 ISR；目前隱私止血已改 no-store 動態渲染，仍須確認 `/blogs/` 原始 HTML 含 `/favicons/` 的 `<img>`；同時驗證 `/api/v1/blogs?limit=50` 的已存圖示 URL 與 `/api/icons` revision 相符。

藍綠部署後的 monthly launcher 每次啟動讀取 active slot，不依賴舊 release 的 WorkingDirectory。原 `blog-observe-favicons.timer`／service 保留但停用。詳見 [藍綠部署與舊服務退役](blue-green-deployment.md)。
