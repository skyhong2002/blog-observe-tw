# 種子網址查找、驗證與收錄

本文件取代先前的人工配對提案。2026-10-12 使用者明確要求由維運者自行查找並驗證 131 個缺網址種子，符合條件直接補上；只有真正無法判定或無法安全驗證的個案保留 unresolved，不將整批工作交回使用者。

## 來源與身份證據

先解析原名內的網域，再比對既有 1,030 筆 discovery 候選／blogroll，最後搜尋官方網站、about、官方搬家公告及作者連結。搜尋只是線索，不能單憑名稱或網域猜測。研究 JSON 與逐站報告保存在 gitignored `.reviews/seed-resolution/`；原始 CSV 不入 Git。

`tools/resolve-seed-urls.ts` 每次重新抓取首頁與來源。首頁 title、og:site_name 或作者須與完整站名／有出處的官方別名相符，且至少驗證一個 RSS、Atom 或 sitemap。跨網域轉址要求完整身份，不接受「廚房」「旅行日記」等泛稱。平台總站不得冒充個人出版者；保留 Medium 等平台的作者路徑。RSS 須為實際有效 XML，留言 feed 不作文章來源；sitemap index 會再驗證其子 sitemap。

所有抓取沿用 DNS 驗證及連線釘選、每跳轉址檢查、robots、識別 UA、每站延遲、20 秒以下 timeout 與 5 MiB 上限。403、robots 禁止或驗證頁不繞過。沒有 RSS／sitemap 即使官方身份已找到，也仍保留 unresolved 與理由。

## 執行

```bash
# research.json: [{id, urls, aliases?, evidence:[{url,title,note}]}]
# 研究檔只由維運者建立，不提供公開提交或任意別名授權入口。
node --env-file=/home/deck/.config/blog-observe.env tools/resolve-seed-urls.ts \
  /private/research.json --report /private/validation.json
# --apply 仍會重新連網驗證；不直接信任舊報告 validated 布林值。
node --env-file=/home/deck/.config/blog-observe.env tools/resolve-seed-urls.ts \
  /private/research.json --report /private/applied.json --apply --ids 2,3
```

單一 DB 交易鎖定既有 seed，補網址、canonical host、`blog_urls`、已驗證 `feed_sources`，保存 `seed-url-resolution` 候選及 append-only audit。原有 blog ID、slug、分類、作者、人工標籤與全部 136 個 `seed_records` 原始列不變。URL 身份比對統一 scheme／www／尾斜線，但保留出版路徑與 query；已被其他站擁有、曾拒絕或多個不同身份通過時不直接覆寫。

重複種子另作有完整轉址與相同 feed 證據的受限 alias 交易：保留兩個 seed ID 及原始列，別名標為 moved，文章／feed 仍只屬 canonical seed。不能憑作者相同就合併不同網站。正式寫入前已備份並在隔離 MariaDB 還原演練，驗證重跑冪等、audit 寫入失敗整筆回滾及網址所有權衝突。

## 收錄與圖示

網址驗證成功不等於已有文章。`crawl:once -- --history --ids ...` 優先使用驗證成功的 feed；RSS／Atom 解析文章，sitemap 頁面還須有 Article／BlogPosting／NewsArticle 或 og:type=article 證據，不把商品、分類頁當文章。每站單輪最多 30 個 sitemap 文章頁；這是有界的初次歷史匯入，不宣稱已抓完整歷史。低頻站不判 stale。

`favicons:fetch` 依既有安全抓取與固定尺寸 PNG 流程補本地圖示，保留 revision 與每月刷新。無法抓取者使用預設圖示，不以平台總站 logo 冒充作者。

## unresolved 與回滾

逐站報告保留搜尋出處、最後網址、身份命中、首頁 hash、來源檢查及失敗理由。可針對官方來源恢復、解除禁止或新證據重跑指定 ID；不反覆轟炸不可用站點。已核對網址不因後續暫時抓取失敗而清除。

部署可回到先前 immutable release，保留新增 audit、文章及圖示。撤銷錯誤網址須先查核其後續文章、追蹤及人工變更，再作補償交易；不能還原整庫覆蓋後續使用者資料，不能刪原始種子。
