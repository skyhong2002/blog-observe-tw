# 使用的技術

`/api/tech` 與 `/api/blogs/:slug/tech` 只讀 site.observe.tw，不再偵測或寫入技術結果。

- 先讀最多 2,000 個已驗證部落格，以 `canonical_host` 一次 POST 到 `http://127.0.0.1:18150/internal/v1/tech`，再用小寫、去掉 `www.` 的網域對回各部落格與 slug。可讀網址別名仍由公開頁面 registry 解析。
- 認證沿用 `blog-genres/traffic.ts` 的 `readTagSimilarwebToken`；不新增憑證或外部可設定的 endpoint。
- 成功回應快取 60 秒，同一批並行請求共用讀取；失敗不快取、不回退舊資料。traffic 請求上限 2 秒，API 保留整體 2.5 秒期限與 503 `technology_unavailable`。
- `status` 是最近嘗試；`observedAt`、首頁來源與 detections 是最近成功。失敗／阻擋仍保留舊結果並計入技術排行；`notChecked`／沒有紀錄對應 `not-observed`。
- 公開欄位沿用原 API；method 改成 `traffic-homepage-wappalyzer`。coverage 只宣告首頁及部分覆蓋，不捏造 traffic 沒有提供的節點數或截斷狀態。
- traffic 每 30 天重新抓取成功站點首頁，先檢查 robots.txt、限制公開位址和 512 KiB，以釘選的 Wappalyzer 規則比對。失敗按 1、2、4…天重試，上限 30 天。細節見 https://site.observe.tw/tech/ 。

blog 的 observer、fetch batch、detector、store 和 backfill 已移除，`BLOG_TECH_ENABLED` 不再有作用；`BLOG_TECH_PUBLIC_ENABLED=true` 仍控制公開頁面與 API。

`blog_tech_scans` 資料已匯入 traffic。本次沿用先停用、保留舊表以便回滾的方式，不做 migration；schema 與歷史 migration 保留。人工 `content/platform-repair.ts` 尚可讀取舊快照作歷史參考，不再更新該表。

`platform.ts`、Wappalyzer input/matcher/rules 和 `tools/fetch-wappalyzer-rules.ts` 保留：`content/registry.ts` 在爬文章時仍需辨識部落格平台，與公開技術統計的資料來源無關。

驗證：`npm run typecheck`、`npm run lint`、`npm test`、`npm run test:web`、`npm run test:topic-ui`。新增 traffic client／route 測試涵蓋批次網域對應、快取、失敗、別名與歷史結果。
