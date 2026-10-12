# B0：即時公開性與歷史話題驗收

> **目前部署：42711cf18c452b406904af6000ccbf88a1ff6102，blue generation 4，2026-10-12T20:19:52.889Z。** 最終同 build 的 53 個 barrier／60 個首請求結果、27 組整合測試、獨立候選 UI review 均已通過；正式 HTTP 驗收通過，babysit 外部最終驗收待確認。下面 b011873 等章節保留歷史，不能代替文末新證據。F3/F4 仍不擴大。

基底：fetch 後的 `origin/main` **fc6b5a902f230047252391ee2eae509e76c46427**。本批維持 no-store；F3/F4 公開上線仍須 B0 驗收通過。部署完成與 babysit 瀏覽器驗收是不同狀態，不以 commit／HTTP 200 代替。

## 即時撤下

隔離 18169 隨機 DB 的 fixture 以 A、B、C 三站測试。A 改為 seed／rejected／moved，各自先暖讀兩次，再於交易提交後讀取；刪除文章另重新暖讀。**已移除舊測試的 60 秒重試迴圈，第一個匿名請求必須不含 A，不能等過期後才算通過。** 共 76 checks：seed 21、rejected 21、moved 21、delete 13。保留 B 文章、共用話題、B→C 關係，以及原始內部 ledger，不靠刪除歷史證據偽造不可見。

涵蓋 overview、來源目錄、來源頁資料、搜尋、標籤、話題細頁、v1 articles/blogs/topics/relations、單站關係、可讀網址 registry、兩種 sitemap。本站 RSS 為私人讀者 feed，匿名始終 401/no-store；另用既有測試 fixture session 驗證 reader RSS A 消失而 B 保留，不把它冒充公開 RSS。

唯讀正式抽查：兩個 moved 與一個 seed 的舊／v1 來源查詢，共六次均 404、private/no-store、CF DYNAMIC；不在報告列出這些非公開 slug。正式資料沒有 rejected row，rejected 使用隔離測試及 verified-only SQL 驗證，未為測試插入正式內容。

獨立審查另外發現一篇未來日期文章會影響少數統計。已補齊 overview／catalog／authors／標籤關聯與篇數／content coverage／relation coverage 的發布日期條件；原資料保留。新 SQL fixture 同時驗 past、undated、future：只計前兩篇，future-only 標籤不出現；改為已發布後下一次讀立即計入。舊測試中「未來文章也算來源篇數」的期待一併更正。

公開 HTML/RSC/no-store 既有實測見 [隱私部署紀錄](privacy-deployment-2026-10-13.md)。b011873 的同一份 immutable Next build 已於 19:44–19:46 UTC 完成下方可追溯的重驗；這是序列撤下測試，不代表後述並行缺口已解決。

## 正常瀏覽遇到 429

GPT-6.1 Sol 逐頁審查重現大量 favicon 消耗 global 240/min 配額，後續頁面變成原始 429 JSON。修正只把固定 favicon PNG 讀取移出動態桶；公開 v1 仍維持原來 60/IP、1000/key，auth／admin／寫入的規則未放寬。

直接 loopback、無 CF/forwarded／登入／API或service credential 的既定公開資料 GET/HEAD，改用獨立而有界的 render 2000/min 桶；不接受外部來源或任意 `/api/*`。它不是容量無上限承諾，極高的共同 SSR 負載仍會回429；此時不以過期資料掩蓋失敗。已測不可透過 forwarding headers、寫入、admin、auth 或編碼前綴取得此桶，並測 icon 多次404不耗動態配額。

Opus 5.5 回應 model/finish 均確認（`claude-opus-5-5`、`stop`）。採納額外 forwarding header 排除、HEAD／編碼路徑／favicon404與穿越測試。當時 overview completed cache 已移除但仍有 single-flight；TTL 雖為0，後續獨立審查證實共享未完成結果仍有並行缺口，見下方修正。關係首頁/blogroll 是獨立表，文章 relation_links 要求 source_post_id，不能用 LEFT JOIN 把已刪文章的邊救回公開查詢；另外補 source blog ownership 一致性。UTC 儲存、連線 timezone Z，fixture 包含前後日期邊界。

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


## 正式切換與第一輪驗收（2026-10-12 UTC）

- active state 原子寫入：**19:19:13.484668Z**；edge 探針完成 **19:19:14Z**。
- active.json：`{"active":"green","commit":"b011873255f9bbf30c252df2ca65ead0ef1c306e","generation":3}`。
- release：`/home/deck/.local/share/blog-observe/releases/b011873255f9bbf30c252df2ca65ead0ef1c306e`；green gateway18175／web18173，固定edge18160不中斷切換。當時blue a45b06a保留為predicate修正的回滾版本（後續發現共享promise缺口，不是完整B0安全基線）；沒有把舊unsafe版本重新啟動。
- 建置前153GiB、切換後151GiB可用，未建立完整備份、未刪除任何既有資料。Worker仍單一，改用此release；active favicon job自動跟隨green。

### 舊隔離首請求紀錄（缺少版本 metadata，不作最終 build 驗收）

19 migrations 的原始 SQL 整合測試有27組、76項API/搜尋/關係/sitemap首讀檢查。下列舊SSR/RSC artifact 缺少SHA／BUILD_ID／UTC，因此只能保留為歷史結果，不能證明與最終正式build一致；已由後段明確列版本的重跑紀錄取代：

| 動作 | HTML／RSC／RSC-prefetch 回應數 | 結果 |
| --- | --- | --- |
| 來源改seed、rejected、moved，及刪除文章 | 48 | 每個第一請求已移除A，保留B與共用話題；整輪最長921ms |
| 文章改成未來2天才發布 | 12 | 每個第一請求已移除A，來源頁仍200且不顯示未發布文章；整輪最長1408ms |

上述時間是逐筆完成整輪的耗時，**不是允許暴露或等待失效的時間**。變更提交後沒有sleep／重試／TTL等待。僅暖讀階段節流，以免測試自身耗盡公開240/min；固定`_rsc` key，包含完整RSC與prefetch（prefetch只有shell時，不把空shell當作內容撤銷的唯一證據）。四頁為首頁、文章列表、來源頁、話題頁。API測試另涵蓋關係圖資料、標籤、搜尋、registry和sitemap；future fixture檢查統計及來源歸屬，原資料均保留。正式DB只讀，沒有更動真實使用者內容。

Origin query不使用完成結果快取，Next這些公開頁dynamic/no-store，Cloudflare兩條規則仍Disabled且回DYNAMIC。**仍未恢復任何公開內容快取**，不能宣稱已有三層主動purge機制。既已下載的內容不在撤銷保證內。

私有證據：主repo `.reviews/b0-release-integration.log`、`.reviews/b0-ssr/rsc-visibility-result.json`、`future-rsc-visibility-result.json`；失敗的早期測試（暖讀過快耗quota）另存，不抹除、不算通過。

### 正式標頭與負載

19:19:37Z起，每route5次匿名GET，不帶Cookie或Authorization：

| route | Cache-Control | cf-cache-status | TTFB中位數 |
| --- | --- | --- | --- |
| `/` | `private, no-store` | `DYNAMIC` | 2535.0ms |
| `/blogs/` | `private, no-store` | `DYNAMIC` | 1033.0ms |
| `/topics/` | `private, no-store` | `DYNAMIC` | 1472.6ms |
| `/api/v1/articles` | `private, no-store` | `DYNAMIC` | 426.2ms |

全部無Age。首頁、`/api/v1/openapi.json`、真正404 `/deploy-b0-missing/` 均有 **`Strict-Transport-Security: max-age=86400`**，沒有includeSubDomains/preload。health200、OAuth302/S256/精確callback、SSRF400、tag/youtube200。原始JSON在主repo `.reviews/b0-public-verification.json`。

測量前load1/5/15為5.01/7.68/6.31，後為30.14/13.90/8.50；期間兩個UI reviewer同時執行瀏覽器，不能把差值全部歸因於部署。UI真實檢查另遇首頁與topics timeout500、數頁429，因此這批**不宣稱整站UI通過**。單首頁受控network診斷58請求中有25個Next RSC預取、14favicon均200；favicon配額已修，但no-store模式的Link自動預取仍放大SSR負載。正在由獨立Opus instance關閉自動預取並處理手機搜尋/API status可讀性，修完先candidate review。未放寬公開IP配額、未恢復cache來掩蓋問題。


## 補正：不可變 build 的原始驗收證據

為補足舊 artifact 缺少版本資訊，重新啟動保留的 b011873 release；gateway 和 Next standalone 的 `/proc/<pid>/cwd` 均核對實際不可變 release 路徑，gateway `app.js` Git blob 也與該 commit 相符。Next原始與standalone BUILD_ID相同。**沒有重新建置、沒有截圖瀏覽器、沒有正式資料寫入。**

- release SHA：`b011873255f9bbf30c252df2ca65ead0ef1c306e`。
- Next BUILD_ID：`TJrsq78INga04l4V8V_sE`。
- seed/rejected/moved/delete：2026-10-12T19:44:22.346Z → 2026-10-12T19:45:59.711Z，48 responses全過。
- future：2026-10-12T19:46:00.861Z → 2026-10-12T19:46:25.214Z，12 responses全過。
- 兩份 JSON 均包含 releaseSHA、nextBuildId、UTC 起訖、gateway/web PID與cwd、gatewayGitBlob、buildIdSha256、isolatedPorts（DB18169/gateway18176/web18177），以及每一個回應狀態、no-store、時間與redirect。
- 原始紀錄：[48筆 JSON](/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-ssr-provenance/rsc-visibility-result.json)、[12筆 JSON](/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-ssr-provenance/future-rsc-visibility-result.json)。舊無版本JSON保留，但不再拿它當最終build provenance。

## 並行 fresh-read 補修（已部署；正式外部驗收待確認）

獨立 Codex 審查用 deferred loader 重現：A先讀visible資料並暫停，hide commit後B同key讀取時會共用A的舊Promise，B自己的loader沒有執行；relations真實入口搭配fake pool也可重現。**這是程式語義的隔離重現，不是已確認正式站實際洩漏。**程序內clear／revision無法涵蓋CLI、worker和其他process的全部寫入，所以不拿它當可靠跨程序撤銷機制。

最小修法讓每個request各自fresh load，不共用完成或未完成結果；topic/overview/SEO wrapper每實例最多8個讀取，relations每pool最多4，超量回503而非舊內容。clear/invalidate不重設active，finally釋放容量。102項純unit回歸含A→commit→B、clear期間容量、不同行為失敗排空和SEO入口；Opus安全review已完成（claude-opus-5-5、finish=stop），未發現阻擋問題；採納真實DB barrier與其他cache掃描建議，最終 build 隔離驗收及部署已完成，見文末 42711cf 紀錄；正式外部驗收待確認。前一版48+12序列測試通過不能抹除這個並行缺口。


### 最終驗收語意

撤下保證以資料庫交易 **commit** 為界：A若在commit之前已開始讀取，可完成並回傳它已讀到的舊結果；commit之後才開始的新匿名請求B，必須獨立查詢，不可共用A的未完成Promise。測試必須使用可手動釋放的barrier，不以sleep、重試或TTL等候製造通過。最終final candidate測試已記錄A開始、commit、B開始、B完成、A完成的UTC與sequence，涵蓋hide／rejected／moved／future及關係圖、sitemap。artifact需包含releaseSHA、Next BUILD_ID、source tree hash，並分開記錄DB、gateway、web埠。

上述b011873的48+12筆只是已補版本metadata的**序列**證據；最終42711cf的barrier／SSR／RSC已完成，見文末完整路徑。F3/F4保持暫停，no-store與Cloudflare兩條Disabled規則不變。

Opus原始安全review與處理紀錄：worktree `.reviews/b0-f4/opus-fresh-read-review-retry.json`、`fresh-read-review-outcome.md`。第一次回覆截斷不計有效review。九個wrapper各有最多8個邏輯讀取（包含巢狀SEO工作），relations每pool4個，並不是全服務只准8個；底層mysql仍4連線與64排隊上限。實際queue/負載由部署後測量，沒有提高DB連線數。

### Barrier 實作與部署前檢查

新增 `tests/integration/visibility-barrier.mjs` 與 `tools/test-visibility-barrier.mjs`。2026-10-12 19:59 UTC 的隔離API-only實驗通過23個case：hide／rejected／moved／future／delete × overview／topic／relations／topics sitemap，另三種站點狀態的blogs sitemap；future／delete不應隱藏仍公開的部落格本身，該站點sitemap組明列不適用。727個UTC/sequence事件保留在worktree `.reviews/b0-f4/barrier-api.json`，DB18169、gateway33399、web=null。這不是最終Next build驗收。

負控制在獨立程序重現舊single-flight，只有A已捕捉舊SQL→commit→B開始→B無法完成而deadline失敗的完整事件順序，才視為成功抓出缺口；artifact本身仍 `passed:false`，見 `.reviews/b0-f4/barrier-negative.json`。正常模式不使用sleep、重試或TTL。獨立GPT-6.1 Sol另外核對barrier位置、B correlation＋同SQL指紋，以及Next測試preload僅在原始fetch下層附追蹤header，不改Next cache key、no-store、回應或SQL條件。

UI小修由Opus實作（7a89af2），獨立GPT-6.1 Sol的候選實測：首頁自動RSC prefetch=0，點擊導覽保留client navigation，390px搜尋可展開，API status九個端點完整顯示。後續42711cf已使用實際部署build完成HTML/RSC barrier與60筆首請求檢查，再完成獨立candidate UI review與切流；沒有用API-only結果替代。

## 最終42711cf：同一份不可變 build、review、切換與正式驗收

本批起點為fetch後remote main `7a89af2d2bec4f4246d606a3f84291f8f3a21744`。`2736b49`關閉共享promise並加barrier；`ca4ca01`校正Next驗證的RSC query key；`42711cf`將兩組舊single-flight測試改為新契約。最後一個commit只改測試，但仍重新建立實際42711cf不可變release並重跑全部證據，**不主張其BUILD_ID和ca4ca01相同**。完整diff保留在主repo `.reviews/b0-final-barrier/ca4-to-427.patch`。測試仍驗fresh read、容量上限8／4、超量503與釋放後可再讀，未刪除隱私檢查。

| provenance | 值 |
| --- | --- |
| release SHA | `42711cf18c452b406904af6000ccbf88a1ff6102` |
| Next BUILD_ID | `GOv8HpPOwOSxlwvjwd6FB` |
| Git source tree hash | `8d8ac1209aa1b7947c8eef714f6e99ba83fecdff` |
| runtime source SHA-256 | `d9311c416073e966b8e8fa99ec86bc3d88090c55579b8420218a6b62f7ee3a96` |
| 隔離 DB / gateway / web | `18169 / 18176 / 18177` |
| 同build驗收UTC | `2026-10-12T20:15:46.658Z`–`20:16:41.201Z` |
| archive核對 | 563個tracked files逐一核對Git來源；19 migrations |

最終完整結果（私有、gitignore；舊檔均保留）：

- [barrier-result.json](/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-final-barrier/42711cf18c452b406904af6000ccbf88a1ff6102/barrier-result.json)
- [sequence-result.json](/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-final-barrier/42711cf18c452b406904af6000ccbf88a1ff6102/sequence-result.json)
- [runner-result.json](/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-final-barrier/42711cf18c452b406904af6000ccbf88a1ff6102/runner-result.json)

53個barrier為55種組合扣掉future/delete不該隱藏部落格本身的兩個blogs-sitemap案例。每筆保留A開始、捕捉旧SQL、commit、B開始、B獨立SQL與回應、A放行／完成的UTC及sequence；A直到B完成才放行。測试沒有sleep、重試、TTL grace。60個sequence首請求是57個200、3個hidden/rejected/moved來源HTML 404，不是全部200。HTML／完整RSC／prefetch涵蓋首頁、文章、來源、話題；prefetch若只有shell，不當作唯一撤銷證據。27組完整隔離整合測試全過，log為`.reviews/b0-final-barrier/integration-42711cf.log`。正式DB未插入驗收資料或改動真實內容。

其後才做獨立candidate review：GPT-6.1 Sol，1280×900／390×900，實際讀7張candidate及6張tag參考圖。首頁自動prefetch與初載RSC均0，點擊仍有client navigation；390搜尋可展開聚焦，API status九條路徑完整。GA傳輸0、429為0。實際筆記、model raw harness與image tool receipt見[final review](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-final-42711cf/reviewer-original-notes.json)。只涵蓋本次三scope，不冒稱其他UI狀態完成；完整ledger仍有pending。本批安全／拆解review為3 Codex＋1有效Opus，採納真實DB barrier、cache audit與有界讀取建議；截斷的Opus回應不算有效review。

已就緒的blue gateway18174/web18172先完成candidate probe與review，之後atomic切換固定edge18160：`2026-10-12T20:19:52.889Z`，transition4與active.json一致：

```json
{"active":"blue","commit":"42711cf18c452b406904af6000ccbf88a1ff6102","generation":4}
```

worker舊job正常完成後單一重啟到同release；favicon跟active slot。green舊檔與程序保留，不把含共享promise缺口的舊release稱為通過B0的回滾版本。未做migration或完整備份、未刪除任何檔案。建置前140.23GiB、建置後139.39GiB；切換前`df -h /home`139G、驗收後140G，均高於10GiB。

### 正式HTTP結果與資源

2026-10-12T20:20:30.861Z起，各5次匿名新連線GET，最終200 headers TTFB（包括公網/TLS/CF，非103 Early Hints）：

| route | Cache-Control | cf-cache-status | TTFB中位數 |
| --- | --- | --- | --- |
| `/` | `private, no-store` | `DYNAMIC` | 1276.6ms |
| `/blogs/` | `private, no-store` | `DYNAMIC` | 442.7ms |
| `/topics/` | `private, no-store` | `DYNAMIC` | 923.1ms |
| `/api/v1/articles` | `private, no-store` | `DYNAMIC` | 396.2ms |

20次均200、無Age、release header全部42711cf。load1/5/15：9.29/7.43/6.76→8.89/7.47/6.78。上一版同法中位數2535/1033/1472.6/426.2ms，但其他thread負載不同，不能把全部改善歸因本次修改。candidate review之前/之後正式首頁TTFB仍曾2.56/4.62秒，因此正式capture當時維持暫停，未用重試掩蓋。

首頁、OpenAPI、真正404均`Strict-Transport-Security: max-age=86400`，無includeSubDomains/preload；health200、OAuth302/S256/精確callback、SSRF400；tag/youtube200。正式原始結果：[public-42711cf.json](/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-final-barrier/public-42711cf.json)。CF兩條規則維持Disabled，沒有改CF/WAF。origin/Next不共用內容結果，edge DYNAMIC；未恢復任何內容cache，亦不宣稱已實作三層主動purge。commit前已开始的A與使用者已下載的內容不在新請求撤銷保證內。

修正前受影響的端點及唯讀資料統計見[歷史隱私報告](privacy-deployment-2026-10-13.md#修正前影響範圍與已知資料量)：9個seed與2個moved來源metadata各0文章；一次移除前有37篇的來源未保存原status。沒有回應body或CF存取紀錄，因此不能確認歷史實際外洩數量或期間，也不列私有內容。

另於 2026-10-12T20:22:59.286755+00:00 開始對本機edge18160直連，各5次200（不經CF/TLS），origin TTFB中位數：`/` 745.9ms、`/blogs/` 31.4ms、`/topics/` 428.9ms、`/api/v1/articles` 20.0ms。原始資料 `.reviews/b0-final-barrier/origin-42711cf.json`；此組與上述公網最終headers TTFB分開，不混稱純回源延遲。

該origin量測時load已升至20.61/9.30/7.38→19.89/9.53/7.47；收到此觀測後立即通知reviewer停止後續正式capture。先前9.x負載並非持續穩定保證；並行其他thread工作仍會造成尖峰。沒有提高瀏覽器／build上限或恢復cache。

### 正式歷史fallback：同release畫面

正式捕捉fresh gate於20:22:33Z通過：load1=3.76、首頁最終200 TTFB1.226秒、全機其他browser root1，因此本thread只啟動一個browser。正式`42711cf`三頁1280×900／390×900共六張畫面均200、header release42711cf、no-store/DYNAMIC，並顯示「過去觀測到的文章」與「近90天沒有新的相關文章」：

| URL | 歷史篇數 | 正式桌機／手機畫面 |
| --- | ---: | --- |
| https://blog.observe.tw/topics/風險管理/?days=90 | 3 | `batch-live-history-42711cf/risk-1280.png`／`risk-390.png` |
| https://blog.observe.tw/topics/榴槤/?days=90 | 1 | `batch-live-history-42711cf/durian-1280.png`／`durian-390.png` |
| https://blog.observe.tw/topics/國際市場/?days=90 | 2 | `batch-live-history-42711cf/market-1280.png`／`market-390.png` |

以上根目錄 `/home/deck/.t3/userdata/ui-review-blog-20261013/`；同folder的`capture.json`保留每頁UTC、headers與SSR可見文字。DNT=1、預先阻擋GA/GTM、optout、無GA外送，沒有登入者資訊。20:22:59Z另外的資源測量讀到load>12後要求停止後續capture；reviewer於20:23:27Z確認load17.29並停止，當時已在途的最後畫面完成後browser於20:23:30.370Z正常關閉。沒有補拍或重試，不能把整段稱為持續通過負載閘門。實際model讀圖記錄另列UI ledger，不拿HTTP/DOM文字冒充視覺review。既有20筆證據抽樣仍見`topic-history-acceptance-2026-10-13.md`。

上述六圖已由獨立GPT-6.1 Sol實際讀圖，原始證據：[reviewer-original-notes.json](/home/deck/.t3/userdata/ui-review-blog-20261013/batch-live-history-42711cf/reviewer-original-notes.json)。三頁均顯示已確認3/1/2篇、待重新確認0；畫面有來源版本但沒有文章數字ID，ID與match version仍以20筆資料證據表為準，不混稱截圖包含。
