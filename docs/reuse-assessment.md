# 從新文易數建立部落格觀察

查核日期：2026-10-12（Asia/Taipei）。這份文件是依正式網站、正式 release 原始碼、會議記錄及使用者提供的種子 CSV 做的移植評估；下列新站設計是建議，尚未實作。

## 結論

建議以新文易數目前正式版作為來源，選擇性移植基礎設施與讀者功能，在獨立資料庫、工作佇列與服務中建立部落格觀察。核心實體改成「部落格、作者、文章、標籤、閱讀清單」，產品重心是發現網站、訂閱更新、分類探索與透明的網站觀測。

先完成種子目錄、文章收錄、部落格個別頁與訂閱，再加入社群標籤、推薦清單及排行。新聞事件分群、政治立場比較、人物圖像與寫法分析不列入第一版。

## 查核基準

- 正式網站：https://tag.observe.tw/
- 原始碼：https://github.com/skyhong2002/tag.observe.tw
- 正式版 commit：`afe0a653fa8aae7e25a04a1d9fe87bf0400a2a39`。
- 正式服務：`tag-analysis.service`、`tag-web.service`、`tag-worker.service`，均為使用者 systemd 服務。
- 部署入口：`/home/deck/.local/share/tag-analysis/current`，查核時指向 `releases/afe0a653fa8aae7e25a04a1d9fe87bf0400a2a39`。
- 本機原始碼倉庫：`/home/deck/Projects/tag.analysis.tw`；其 main HEAD 為 `d034b09`，並有既存未提交修改。不能把這個工作目錄當成目前正式版直接複製。
- 同版完整工作樹：`/home/deck/.cache/tag-visuals`。後續取碼應固定上述 commit，避免混入別人的工作中修改。
- 目前 blog.observe.tw 專案只有 README 與圖示，尚無應用程式。
- 新文易數程式採 MIT 授權，移植時保留授權與著作權聲明。

實際瀏覽首頁、`/media/`、`/media/kocpc/`、`/media/traffic/`；讀者功能另外核對正式 release 的 routes、schema 與前端，沒有操作追蹤、收藏或管理寫入。

## 已有能力與移植方式

下列程式路徑皆相對於新文易數固定版本根目錄。

| 既有能力 | 原始碼位置 | 部落格觀察的用法與必要調整 |
| --- | --- | --- |
| Fastify gateway、Next.js 網站、資料庫、工作排程 | `app/src/app.js`、`app/src/worker.ts`、`app/src/db/`、`web/` | 沿用架構、API 模式、SSR 與工作紀錄；用獨立設定與資料儲存。 |
| RSS／Atom／sitemap 解析 | `app/src/crawl/feed.ts` | 優先移植。保留標題、原網址、發布時間、修改時間、作者、分類與摘要。 |
| HTML 列表與文章中繼資料抽取 | `app/src/crawl/html-list.ts`、`article.ts`、`article-content.ts`、`text.ts` | 抽出通用解析能力，依平台添加例外；RSS 有效但正文不可取得時仍可收錄。 |
| WordPress 支援 | `app/src/crawl/news-discovery.ts` | 已有 WordPress feed 偵測與公開 REST posts 處理，可抽成平台 adapter；新聞驗收條件需要拆開。 |
| 去重、抓取結果與重試 | `app/src/crawl/pipeline.ts`、`text.ts`、`app/src/jobs/crawl-job.ts` | 沿用 URL 正規化、唯一鍵及工作紀錄；補 feed GUID、文章更新與網站搬家識別。 |
| 來源設定與啟停 | `app/src/crawl/sources.ts`、`registry.ts`、`schedule.ts` | 沿用規則模型；將依賴新聞 JSON 的 registry 改接部落格主檔與 feed 設定。 |
| 網站目錄及個別頁 | `web/src/app/(site)/media/`、`web/src/components/SourceProfile.tsx`、`MediaSidebar.tsx`、`MediaTabs.tsx` | 改為 `/blogs/` 與 `/blogs/<slug>/`；展示簡介、作者、標籤、RSS、更新頻率、文章、流量及原站入口。 |
| 文章列表、摘要與搜尋 | `app/src/v1/articles.ts`、`web/src/components/ArticleListItem.tsx`、`ArticleResults.tsx`、`SiteSearch.tsx` | 沿用列表、篩選、搜尋及摘要切換；擴充網站名稱／作者搜尋，公開閱讀以摘要與原站連結為第一版預設。 |
| 帳號及角色 | `app/src/auth/`、`app/src/db/schema.ts` | 沿用 Google 登入、session、角色與稽核機制；新站使用自己的設定及新資料表內容。 |
| 追蹤、收藏、個人動態、私人 RSS | `app/src/reader/`、`web/src/app/(site)/my/`、`web/src/components/reader/` | 正式版已存在，優先移植；追蹤目標改為部落格、文章標籤及作者，延長查詢期間並加分頁。 |
| 推薦及理由 | `app/src/reader/suggestions.ts` | 保留理由可解釋的呈現；改用相近標籤、共同閱讀清單與 blogroll 關係，替換新聞熱點和政治陣營規則。 |
| 公開 RSS、sitemap、API | `app/src/feeds.ts`、`app/src/v1/` | 提供單站、標籤、分類、閱讀清單與個人 RSS；新增 OPML 匯入／匯出。 |
| 來源與文章標籤管理 | `app/src/media-categories.ts`、`app/src/admin/routes.ts`、`web/src/app/(site)/admin/` | 沿用新增標籤、人工修改、修改紀錄與爬蟲不覆蓋手動標籤的機制；補社群標籤資料模型。 |
| 讀者錯誤回報 | `app/src/reader/routes.ts`、`reader_reports`、管理後台 | 正式版已支援文章標籤／署名／來源回報；擴充到網站網址、搬家、停更及收錄建議。 |
| 流量欄位、歷史、圖表與缺值處理 | `app/src/media-traffic/history.ts`、`radar.ts`、`live.ts`、`web/src/components/TrafficComparison.tsx`、`MediaTrafficProfile.tsx` | 沿用資料模型、來源與時間標記、缺值、月變化、排名級距；將供應商取得方式抽成可替換模組。 |
| 同站多篇文章的權重遞減 | `app/src/jobs/ranking-compute.ts` | 同一站對同標籤的貢獻為 1、0.5、0.25……，適合避免高產站壟斷「大家正在寫什麼」；它是主題廣度指標，不能直接當作部落格品質排行。 |
| 趨勢快照、標籤關聯與文字雲 | `app/src/jobs/ranking-basis.ts`、`ranking-job.ts`、`app/src/v1/tag-related.ts`、`tag-series.ts`、前端排行元件 | 保留快照與視覺化，重訂部落格觀察母體及 7／30／90 天期間，標示新增收錄造成的變化。 |
| 文字相似與引用關係 | `app/src/similarity/`、`web/src/components/SimilarityGraph.tsx` | 第二階段可做相關文章與引用關係；引用實體辨識目前偏新聞媒體，需改成一般網站與連結證據。 |
| 品質、觀測、SEO、深淺色、行動版 | `app/src/metrics.ts`、`app/src/v1/media-stats.ts`、`web/src/components/`、`runtime/`、`infra/` | 沿用 UI 與運維模式，分開顯示「抓取成功」及「作者近期有無發文」。 |

## 實際可重用的種子資料

使用者的《Similar Web 新聞 - 2025_12.csv》第一欄等於「個人」的有 136 列、135 個不重複名稱；「捏捏 bewithnene.tw」重複兩列。這只是按名稱去重，尚未完成網址與搬家合併。

原分類以旅遊最多（去同名後 78 筆純旅遊），另有科技、財經、生活與 18 筆電商／服裝電商。保留全部種子及來源分類，用站點性質與收錄範圍另外判斷是否存在可訂閱文章。收錄狀態不能從「個人」標記直接推定。

至少以下四個種子已有核對過的網站對照資料，可作為第一批接通流程的來源：

| CSV 名稱 | 現有 source key | 現有核對網址 |
| --- | --- | --- |
| 電腦王阿達 | `kocpc` | https://www.kocpc.com.tw/ |
| 硬是要學 | `soft4fun` | https://www.soft4fun.net/ |
| 雲爸 dacota.tw | `dacota` | https://dacota.tw/ |
| 點子生活 saydigi | `saydigi` | https://www.saydigi.com/ |

正式站 `/media/kocpc/` 實際展示收錄文章、追蹤按鈕、文章標籤、Similarweb 月流量／國家／導流資料與 Radar 級距；`/media/traffic/` 也顯示上述四站。這證明現有系統已能處理一部分種子，不代表其他 131 個名称都已可收錄。

現有 `tools/import-media-traffic.py` 僅接受主題含「新聞」的列，並要求「網站名／流量／成長」欄位。使用者的 2025_12 CSV 前兩欄無表頭，數值欄標成「網站」，不能直接套用該匯入器。需要獨立的種子匯入器，保存來源檔案、列號、原名稱、原分類、原值；流量欄的月份及單位核對後才轉換。

## 一定要改的新聞假設

1. **來源新鮮度**：`media-stats.ts` 目前以新聞 6 小時、其他來源 24 小時無新文判為 stale。部落格要分開存最後抓取成功、最後發文、預期更新頻率，避免週更／月更被當成失效。
2. **探索期間與內容門檻**：`news-discovery.ts` 預設只收近 14 天（已有 `includeArchive` 例外開關），且若干路徑要求有效正文與最低字數。初始收錄需有獨立的歷史匯入模式；短文、照片文、僅提供摘要的有效 feed 也能被索引。
3. **文章形式**：正文解析偏文字新聞，會移除圖片、figure 等。部落格應保留文章型態與縮圖資訊，不以文字字數當唯一成功條件；RSS 摘要與圖片授權另存來源策略。
4. **訂閱時間範圍**：`reader/feed.ts` 的 `FEED_DAYS=7`、`FEED_LIMIT=150` 不適合低頻部落格。改為可分頁的持續時間軸，RSS 的窗口也要適應低頻更新。
5. **排行母體**：固定新聞來源集合 `ranking-baseline.json` 與 `ranking-basis.ts` 必須重建；不能讓新增網站後的篇數增加被解讀成話題成長。
6. **推薦條件**：`reader/suggestions.ts` 使用新聞事件、近 7／14 天數量門檻及藍綠立場。保留理由顯示，另做適合小站、長期寫作與主題探索的條件。
7. **來源主檔**：目前名稱、圖示、分類、爬蟲與流量網域分散在 JSON 與 DB。部落格需要一份穩定的站點主檔，讓新增網站不必改多份程式設定。
8. **平台共用網域**：站點身份要能表達子網域與路徑；同在 Blogger、WordPress.com、痞客邦、Medium 等平台的兩個作者不能合成一站，也不能把平台總流量算給個人。
9. **作者身份**：可借用署名抽取與編輯 UI，但作者 ID 與網站所有者需獨立；不能只憑相同筆名合併跨站作者，也不能假定一站只有一人。
10. **流量解讀**：現站已有「每篇分攤造訪」，也有文件與畫面不同步。部落格的長尾舊文可能帶來主要流量，第一版只顯示網站月造訪估算、成長與來源；不將這個分攤值當成單篇閱讀數或品質。
11. **閱讀與保存策略**：現站有發布後 7 天公開閱讀規則、約 90 天正文快取及 NAS 封存機制。新站先採標題、摘要、分類、來源連結與原站閱讀；正文保存／公開另按來源設定，避免意外沿用新聞站政策。
12. **站名與運行隔離**：多處硬編碼 `https://tag.observe.tw`，worker 使用 `tag-jobs`，session 名稱是 `tag_session`，快照預設落在 tag-analysis 目錄。需統一由新站設定提供 origin、品牌、佇列、檔案位置及 cookie 名稱；新站的工作不能被舊 worker 消費。

## 新站的核心資料模型

以下為新增／改造建議，並非目前已存在的表。

- `blogs`：穩定 ID、slug、名稱、簡介、主要網址、語言、站點性質、收錄政策、狀態、首次發現／收錄時間。
- `blog_urls`：主要網址、舊網址、子網域／路徑邊界、搬家與合併證據，保留身份歷史。
- `blog_sources`：RSS／Atom／sitemap／HTML adapter、排程、最後成功時間、HTTP cache validator、失敗狀態。
- `seed_records`：CSV／blogroll／讀者提交等出處、原始列號、原名、原始標記與解析結果；一站可有多個發現來源。
- `posts`：以既有 articles 為底，增加 feed GUID、修改時間及版本／內容雜湊，保留原始發布時間。
- `authors`、`blog_authors`、`post_authors`：作者、網站與文章的多對多關係；認領與跨站合併有獨立狀態。
- `tags`、`blog_tag_assignments`、`post_tag_assignments`：分開網站身份標籤、文章主題；記下作者／讀者／系統／管理員出處、修改時間、狀態與別名對照。
- `collections`、`collection_items`、`blog_links`：人工作成推薦清單、blogroll 與文章引用的關係，附理由及出處。
- 沿用但重新綁定目標的 `user_follows`、`user_saves`、`user_prefs`、`user_feed_tokens`、回報與修改紀錄。
- 沿用流量月份／profile／Radar 歷史表的概念，增加可辨識的量測範圍（網域、子網域或其他範圍），避免估算值跨網站誤用。

「高中生」等身份標籤應來自作者自述或有出處的使用者標記，不由爬蟲自動推定。個人的整理標籤與公開共用分類分開，讀者可以替自己或別人的網站加標籤，公開彙整保留誰提出及如何修訂的資訊。

## 產品頁面與排序

建議導覽：**探索部落格／最新文章／分類與標籤／排行榜／閱讀清單／我的訂閱**。

首頁以新加入網站、最近更新、各類別探索及精選閱讀清單為主。讓沒有第三方流量資料的小站也能出現；「新加入」表示本站新收錄，不能誤標為作者剛開始寫作。

第一版的排序分開提供：

- 最近更新：依文章發布時間，排除搬家重抓造成的假新文。
- 新加入：依本站收錄日期。
- 持續寫作：依 30／90 天內有發文的週數等透明指標，明示資料涵蓋期間。
- 月流量／月成長：僅對有可比較資料的網站排序，顯示來源、月份、估算範圍與缺值。
- 主題熱度：參考既有同站遞減權重，呈現參與網站數、文章數與期間。
- 精選清單：顯示整理者與推薦理由。

不把文章數、Similarweb 估算、站內追蹤數和品質合成一個無法解釋的總分。使用者訂閱保持明確選擇與時間排序，推薦入口獨立呈現並附理由。

## 如何取得與搬運

可行路線比較：

| 路線 | 用途 | 判斷 |
| --- | --- | --- |
| 只接新文易數 API | 快速展示已收錄重疊站點與流量 | 可做初期對照，但新聞 API 的來源母體與篩選規則無法涵蓋完整部落格需求。 |
| 複製固定版本，逐模組移植到獨立應用 | 保留成熟爬蟲、訂閱、管理與 UI | **本次建議**；先選必要模組，讓新站資料與產品邏輯獨立。 |
| 立即把兩站改成共同核心套件 | 長期同步抓取與 UI 改善 | 等部落格流程穩定、共通邊界清楚後再做，避免第一版先花大量時間重構原站。 |

取固定 commit 的 tracked files，不複製整個正式 release（包含建置物），也不直接複製有未提交修改的 main 工作目錄。新站保存來源 commit 與模組清單，以便日後選擇性同步修正。

可重用資料包括：核對過的站名、別名、網址、圖示來源、RSS／解析設定，以及同一站點同一量測範圍的流量歷史。對重疊站點，文章中繼資料可經唯讀 API 或限範圍匯出加入新站，保留原取得時間與出處。採用一個抓取者供應共用站點，或建立新站獨立排程，需選定責任邊界以免重複請求。

使用新資料庫或獨立 schema、獨立權限帳號、Redis namespace／佇列、快照目錄、服務及 OAuth callback。初期只啟用部落格抓取、流量、索引和必要維護工作；新聞事件、政治分類、舊站 MySQL 匯入與 NAS 還原流程不隨預設啟動。

## 分階段落地與驗收

### 第一階段：能找到並讀到部落格

1. 匯入 136 筆原始種子，建立 135 個待核對名稱及可追溯的來源紀錄。
2. 先接通上述四個重疊來源，再分批補網址、平台、RSS、狀態與分類；同時加入少量週更／月更、短文、靜態站、共用平台站作為驗證樣本。
3. 上線目錄、分類、單站頁、最新文章、搜尋、摘要與原站入口。
4. 只有「已列種子」的來源顯示待核對；只有實際取得有效文章才標示已收錄。

驗收重點：同文多網址可去重；舊文修改不冒充新文；月更網站不被判為抓取故障；短文與僅摘要 RSS 可收錄；缺流量的小站仍在目錄；同平台不同作者的資料與流量不混在一起。

### 第二階段：讀者能持續使用

1. 移植登入、追蹤、收藏、個人動態與私人 RSS。
2. 加入 OPML、網站提交／搬家回報、社群標籤、公開推薦清單。
3. 分開「我的訂閱」與「探索推薦」，讓每個推薦都看得到理由。

驗收重點：訂閱超過一週沒發文的站仍能看到歷史與最新文章；分頁不漏資料；標籤有來源及修訂紀錄；RSS 匯出與畫面使用相同選擇條件；新站帳號與排程不污染原站。

### 第三階段：觀測與成長

1. 移植流量歷史、分類排行、發文頻率、主題趨勢。
2. 加入 blogroll 擴充、互相引用與相關文章。
3. 依作者意願評估 GA 等第一方統計；這不是第一版收錄或曝光的前提。

驗收重點：比較月份與量測範圍一致；無資料與零值分開；排名能說明指標及來源集合；新增種子或補收舊文不製造虛假的熱度成長。

## 本次執行範圍

評估階段已完成正式站瀏覽、部署版本辨識、程式與資料模型查核及移植方案。第一版已另建零依賴 Node 服務，使用獨立的 `blog-observe.service`、18160 埠與私有 OAuth 環境檔；目前只放入四個已核對 seed 網站，未宣稱 136 筆種子已全部匯入，也未修改 tag.observe.tw 或 youtube.observe.tw。RSS 抓取、來源探索、持久化資料庫與訂閱功能仍待後續實作。
