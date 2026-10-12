# B0：即時公開性與歷史話題驗收

基底：fetch 後的 `origin/main` **fc6b5a902f230047252391ee2eae509e76c46427**。本批維持 no-store；F3/F4 公開上線仍須 B0 驗收通過。部署完成與 babysit 瀏覽器驗收是不同狀態，不以 commit／HTTP 200 代替。

## 即時撤下

隔離 18169 隨機 DB 的 fixture 以 A、B、C 三站測试。A 改為 seed／rejected／moved，各自先暖讀兩次，再於交易提交後讀取；刪除文章另重新暖讀。**已移除舊測試的 60 秒重試迴圈，第一個匿名請求必須不含 A，不能等過期後才算通過。** 共 76 checks：seed 21、rejected 21、moved 21、delete 13。保留 B 文章、共用話題、B→C 關係，以及原始內部 ledger，不靠刪除歷史證據偽造不可見。

涵蓋 overview、來源目錄、來源頁資料、搜尋、標籤、話題細頁、v1 articles/blogs/topics/relations、單站關係、可讀網址 registry、兩種 sitemap。本站 RSS 為私人讀者 feed，匿名始終 401/no-store；另用既有測試 fixture session 驗證 reader RSS A 消失而 B 保留，不把它冒充公開 RSS。

唯讀正式抽查：兩個 moved 與一個 seed 的舊／v1 來源查詢，共六次均 404、private/no-store、CF DYNAMIC；不在報告列出這些非公開 slug。正式資料沒有 rejected row，rejected 使用隔離測試及 verified-only SQL 驗證，未為測試插入正式內容。

獨立審查另外發現一篇未來日期文章會影響少數統計。已補齊 overview／catalog／authors／標籤關聯與篇數／content coverage／relation coverage 的發布日期條件；原資料保留。新 SQL fixture 同時驗 past、undated、future：只計前兩篇，future-only 標籤不出現；改為已發布後下一次讀立即計入。舊測試中「未來文章也算來源篇數」的期待一併更正。

公開 HTML/RSC/no-store 既有實測見 [隱私部署紀錄](privacy-deployment-2026-10-13.md)。本次最終 build 仍要重驗 seed/rejected/moved/delete 的 SSR/RSC；未完成前不把它標成完成。

## 正常瀏覽遇到 429

GPT-6.1 Sol 逐頁審查重現大量 favicon 消耗 global 240/min 配額，後續頁面變成原始 429 JSON。修正只把固定 favicon PNG 讀取移出動態桶；公開 v1 仍維持原來 60/IP、1000/key，auth／admin／寫入的規則未放寬。

直接 loopback、無 CF/forwarded／登入／API或service credential 的既定公開資料 GET/HEAD，改用獨立而有界的 render 2000/min 桶；不接受外部來源或任意 `/api/*`。它不是容量無上限承諾，極高的共同 SSR 負載仍會回429；此時不以過期資料掩蓋失敗。已測不可透過 forwarding headers、寫入、admin、auth 或編碼前綴取得此桶，並測 icon 多次404不耗動態配額。

Opus 5.5 回應 model/finish 均確認（`claude-opus-5-5`、`stop`）。採納額外 forwarding header 排除、HEAD／編碼路徑／favicon404與穿越測試。overview completed cache 已移除，僅 single-flight；故其 TTL 延遲疑慮不適用。關係首頁/blogroll 是獨立表，文章 relation_links 要求 source_post_id，不能用 LEFT JOIN 把已刪文章的邊救回公開查詢；另外補 source blog ownership 一致性。UTC 儲存、連線 timezone Z，fixture 包含前後日期邊界。

Review 原始紀錄（gitignore）：`.reviews/b0-f4/opus-b0-review.json`、`render-rate-review.md`、`b0-f3-audit.md`、SQL／unit logs。未含金鑰、連線字串或非公開內容。

## 歷史 fallback 與 20 筆樣本

[完整二十筆資料與舊→新網址驗收](topic-history-acceptance-2026-10-13.md)：4,769 累積話題、710 個近30/90天皆無 fresh 命中的話題；有可公開歷史文章才保留頁面，真正完全無證據不憑空產生 fallback。薄頁 noindex 政策未新增。

正式瀏覽器範例（1280 寬，先明確設 opt-out，GA 資源0，未送合成事件）：

| URL | 畫面證據 |
| --- | --- |
| https://blog.observe.tw/topics/風險管理/?days=90 | `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5m57y7-bcaae672.png` |
| https://blog.observe.tw/topics/榴槤/?days=90 | `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5m69rn-64c35565.png` |
| https://blog.observe.tw/topics/國際市場/?days=90 | `/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5mdiix-18d5e2fe.png` |

三頁皆有「過去觀測到的文章」，分別3／1／2篇；每篇仍有原文連結、日期及證據來源。UI 完整逐頁／多狀態審查另外在 [ui-review-ledger.md](ui-review-ledger.md) 記錄，不以這三張圖代替所有頁面 review。
