# GA4 與隱私

Measurement ID：`G-VKWGDHDESV`（property 558498886、stream 16112932212）。ID 是公開設定；`NEXT_PUBLIC_GA_ID` 可在建置時覆寫，空字串完全停用。Google 後台由另一位協助者維護，本專案不建立 property 或驗證 Search Console。2026-10-12 使用者確認：五項自動內容事件已關閉，僅保留網頁載入及瀏覽器記錄變更，可啟用本 ID。

## 啟用前的 Google 設定

使用加強型評估的網頁瀏覽與「依瀏覽器記錄事件變更網頁」。程式只初始化一次 config，落地頁由 config 計一次；不自行送 page_view，也不在 React pathname effect 重複 config。

**須關閉**加強型評估的外連點擊、網站搜尋、表單互動、檔案下載及影片互動。這些功能會另外送出 link_url、link_text、search_term、form_destination 或 video_title 等；安全自訂事件無法抑制另一套自動事件。後台 email／query redaction 仍保留，作為額外保護，不取代本站的資料最小化。

上述遠端設定已於 2026-10-12 由使用者與後台維護者確認；正式建置使用 `G-VKWGDHDESV`。若未來設定未確認，先以空 `NEXT_PUBLIC_GA_ID` 建置停用。

官方參考：[加強型評估事件](https://support.google.com/analytics/answer/9216061?hl=en)、[GA4 網頁瀏覽](https://developers.google.com/analytics/devguides/collection/ga4/views)、[gtag 參數優先序](https://developers.google.com/tag-platform/gtagjs/reference)。

## 程式邊界

沿用新文易數 SiteAnalytics／analytics-consent 的 MIT 實作模式，由 Opus 移植前端，Codex 審查與部署。只有 production、blog.observe.tw、hydration 後才可載入；webdriver／bot、DNT、GPC、opt-out、無法讀取偏好、空 ID 均不載入。

私人、登入、管理、搜尋、退出統計頁與帶 query 的 URL 不計入。退出統計頁 `/observe/opt-out/` 設 noindex。已知公開路徑有無結尾斜線皆可計入（`skipTrailingSlashRedirect` 兩者都服務），`page_location` 一律為帶結尾斜線的 canonical。`/blogs/<slug>/` 只接受小寫 ASCII slug（長度上限同 `isSlug`），`/topics/<id>/` 解碼後只接受 `tag:<64 hex>`／`rss:<數字>`（同 `isTopicId`）；其他片段（例如 `/blogs/alice%40example.com/`、`/topics/private-email/`）一律不送。程式只檢查片段形狀，**不判斷該頁是否 404**；落地文件若帶 robots noindex 另外不計，但這只是額外防護，client 切頁時無法讀到新頁 metadata。

本站設定的頁面欄位只含允許的 canonical 路徑、固定站名及 referrer origin（Google 的公開歷史切頁可能另帶上一個公開頁路徑，詳見下節），透過全域 `gtag('set')` 設定，`config` 不帶任何 page_* 參數，避免 config 範圍的舊值覆蓋後續切頁（事件 > config > set）。不送原文標題、搜尋字詞、私人路徑或完整外連網址。pushState／replaceState 包裝與 popstate capture 在 gtag.js 載入前安裝，切頁之前就更新 `ga-disable-<ID>`；Google 其後包在外層的 history wrapper 讀到的已是新狀態。gtag.js 載入前的自訂事件只暫存在本地，遇到退出統計、私人頁、query 頁或文件已受污染即丟棄，不會在之後補送。仍必須以真實 Google collect 請求驗收瀏覽器記錄事件，單元測試不能取代外部 tag 行為。

### 文件層級隱私污染（2026-10-12 正式瀏覽器實測）

實測發現：全域 `gtag('set', { page_referrer: origin })`，甚至 `config` 帶 `page_referrer` origin 並 `send_page_view: false`，都**無法**阻止加強型評估的瀏覽器記錄事件覆寫 page_referrer。從 `/articles/?q=ga-privacy-test` 以 `history.back()` 回到 `/articles/`，送出的 `dr` 含完整 `?q`。query 頁本身雖已停用，回到公開頁重新啟用後就把上一個敏感網址洩漏出去。

因此採保守規則：同一份文件一旦已送出 `config`（不論 gtag.js 已載入或仍在載入），只要切到任何私人、query、noindex、無法解析或其他不可計入的網址，即標記為受污染；此後 `ga-disable-<ID>` 恆為 true，所有自訂事件（含暫存佇列與 login）一律丟棄，回到公開頁、StrictMode 卸載重掛、或晚到的 gtag.js onload 都不會再啟用。卸載期間發生、無人判斷的導覽（pushState／replaceState／popstate，或重掛時網址已不同）也視同污染；history wrapper 與 popstate 監聽在整份文件期間保留以偵測這類導覽。不自動重新載入，避免打斷表單與導覽；下一次完整頁面載入會重新開始，`document.referrer` 只保留 origin。從未送出 `config` 的文件（例如落地在私人或 noindex 頁）仍可在第一個公開頁啟用，因為 Google 未看過先前的記錄。

### 可讀網址（2026-10-12 起，刻意縮小的涵蓋範圍）

部落格與話題詳細頁改用頁面登錄的可讀網址（`canonicalPath`，例如 `/topics/旅行/`、`/blogs/example.com/`），舊網址由 gateway 301。可讀話題片段就是話題標籤文字，可讀部落格片段是網域或名稱，因此**不納入** GA：`publicPage` 維持原本的安全形狀（不含 `.` 的小寫 ASCII 部落格 slug、`tag:<hash>`／`rss:<n>`），其他片段一律視為不可計入頁。已送出 `config` 的文件一旦進入可讀話題頁或含網域的部落格頁，就依上節規則整份文件停用，之後回到首頁或列表也不再計。結果是：首頁、列表頁之間的落地／切頁／上一頁 page_view 照常；話題詳細頁與多數部落格詳細頁（及其後同一文件的瀏覽）不計，直到瀏覽器端有經驗證、穩定且安全的對應（例如伺服器保證的 ID 對照）再另行評估。不另外送 page_view 或 config 補償。

select_content：連到可讀網址的連結，若伺服器資料提供穩定 ID，`page-links.ts` 會加 `data-analytics-content-id`（原始 ASCII 部落格 slug、話題 64 hex hash 或 RSS 數字），點擊時經 `safeContentId` 再驗一次才當作 content_id；不符合（標籤、標題、可讀片段、網址、email）時只送 content_type。

一般公開頁之間的 SPA 切頁與上一頁／下一頁不受影響，照常由加強型評估計 page_view；程式從不手動送 page_view。單元測試的假 Google 無法重現 Google 引擎的 referrer 行為，只鎖定上述保守規則，仍須以真實 collect 請求驗收。

自訂事件只允許：

| 事件 | 資料 |
| --- | --- |
| open_original | link_domain、source_page_type（`data-analytics="open_original"`：SourceLink、首頁與話題詳細頁文章標題中真正的原文 http(s) 連結；退回 `/blogs/` 或其他站內部落格連結不標記） |
| select_content | content_type、經驗證的 slug／數字／hash content_id（取自舊形網址或連結的 `data-analytics-content-id`）、source_page_type |
| rss_click | 無內容或身分參數 |
| login | method=google |
| follow | 動作名稱，不含使用者或部落格 ID |
| app_installed | 動作名稱 |

OAuth 成功後 gateway 才寫入 `__Host-blog_login_completed=1` 短效布林 cookie（`Secure; SameSite=Lax; Path=/; Max-Age=300`，非 HttpOnly），開始登入、失敗與登出時清除。前端只用它送一次 `login`（`method=google`），不呼叫 `/auth/me`、不推論登入狀態；事件送出後立即以相同屬性刪除。回到私人頁（如 `/my/`）時延後到 cookie 期限內第一個可計入的公開頁、且 gtag.js 已載入後再送；退出統計時不送也不刪。此訊號不參與認證，也不含 session、sub 或 email；已登入使用者取消 Google 登入時沒有此 cookie，不會誤計成功。未建立的 save 功能不虛構事件。

## 驗收與發布

先測空 ID、開發／非正式 hostname、自動化與隱私偏好零 Google 請求；正式一般瀏覽器檢查 gtag/js ID、落地／切頁／上一頁各一次 page_view、open_original 安全欄位，以及 query／私人導覽不送出。每次正式驗收記錄 UTC 時間供 Google 後台 Realtime 對照。未取得後台必要設定確認前以空 ID 建置，不能假稱已送到 GA。
