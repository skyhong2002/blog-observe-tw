# 部落格圖示來源與更新

圖示處理選擇性移植自新文易數固定版本 `afe0a653fa8aae7e25a04a1d9fe87bf0400a2a39` 的 `tools/fetch-favicons.ts`，保留 MIT 與 `Copyright (c) 2026 Sky Hong`。使用相同的 192×192 PNG 透明留白轉換及 ICO 最大圖層優先策略；補上 ICO 邊界檢查與解碼像素限制。

## 來源與隔離

工具唯讀查詢 blog 專屬資料庫中的 `blogs`；`--include-candidates` 另讀全部 discovery 候選，使用 `candidate-<id>` 作本機檔名。抓圖示不會核准候選、不會新增追蹤、不會變更原始網址；缺少網址直接記錄 `default / no-source-url`，不依名称猜網域。

取得順序為網站 HTML 的 icon、apple-touch-icon、mask-icon，接著 manifest 的 icons、og:image／明確 logo，最後 `/favicon.ico`。沿用原頁的完整 URL 解析相對路徑，避免把平台作者頁當成平台首頁。共享平台的總站圖示會被排除；取不到可歸屬該站的圖示時顯示預設圖示，不以平台品牌冒充作者。

每次批次用站點身分去重複抓取：一般獨立網站使用 origin，共享平台保留作者子域或作者／salon 路徑。每一個輸入仍分別寫入結果與原始 URL，候選不因同 host 就互相合併。這是圖示快取重用，不是部落格身份合併。

## 禮貌與限制

所有 HTML、manifest、圖片及每一跳轉址都經由既有 `politeFetch`，共用 robots、可識別 User-Agent、每站延遲、DNS／IP 安全驗證與連線釘選。工具只有一個 worker，單請求 timeout 8 秒，每個站點開始新請求前檢查 30 秒時間預算，最多嘗試 5 個圖示來源，保留 ETag／Last-Modified 做條件請求。HTTP 狀態 304 沿用已驗證的圖示或已解析的來源清單。

圖片必須回傳 `image/*`，所有 response 限制 5 MiB；解碼限制 16,777,216 pixels，SVG 禁止外部資源、內嵌圖片與 XML entities；不收動畫多頁圖、不接受小於 16 px 的來源。ICO 限制 256 個目錄項目，解碼前驗證資料邊界及分配大小。轉換後為 192×192 PNG，保存 SHA-256 revision。沒有通過下載、MIME 與實際解碼的來源不會設定 `verified: true`。

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

每月刷新由 `blog-observe-favicons.timer` 在每月 1 日 06:20 加最多兩小時隨機延遲執行，單程序、低排程優先權、CPU 25%／記憶體 512 MiB。失敗保留同站先前圖示；網址身分變更則先移除旧圖。timer 只讀 blog DB、不操作 tag/youtube。回滾或暫停：停用該 timer 即可，保留快取與原始 evidence。

影像解碼在獨立 Node 子程序進行，4 秒牆鐘到即終止；Sharp 另設 3 秒 timeout。原始圖只渲染一次，透明度分析只處理已縮成 192 px 的 PNG。ICO 圖層尺寸須與目錄一致，拒絕截斷與超大宣告。採用子程序是為了讓 native decoder 不配合逾時時仍能停止，避免占用同機服務資源。
