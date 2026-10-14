# F4 T-ref 對齊與互動驗收（2026-10-15）

本批基底為 fetch 後的 `origin/main` `53a408481e9c09bfd9a986e7625252220cbfa227`。本批已於 UTC2026-10-14T22:28:02.034Z 上線 blue/gen22 `58e551a79626681024bf47e70ab8e1eee2b2f073`／BUILD_ID `Xm1Rp-cc1A9eW-NCT5lnf`。起始盤點時正式為 gen21/b8；其舊圖保留原 SHA，不改標成新版本。實際候選與正式圖／獨立 review、隱私測試和回滾見 [gen22證據索引](f4-gen22-evidence.md)。

## 沿用與刻意偏離

T-ref：`/home/deck/Projects/tag-sm-f1-release/docs/cross-site-consistency.md`；其正式 web 基準 `7dc59c3c17f6d6420354c3d4df733549071f2bb4`、BUILD_ID `4nl3B-BcT4mA9uh47rm0Z`。

| 頁面／共用項目 | 沿用 | 功能差異與理由 |
| --- | --- | --- |
| 全站 header/footer、字型與色票 | 既有 SiteHeader、SiteNavigation、FooterMethod；font-sans 與亮暗背景／前景 token | 站名／內容改成部落格；品牌綠色為使用者明確指示，不改成新聞品牌橘色。 |
| `/topics/`、`/tech/` 寬表 | TableScroller.tsx、table-styles.ts 與 T-ref 工作樹逐位元相同；表頭跟隨頁面、首欄 sticky 與手機 9.5rem→5.5rem；nowrap、truncate/title、數字右對齊 | 話題為部落格 7/30/90 日母體；技術表呈現被動觀測，不套媒體流量的月份欄位。 |
| `/tech/` | 卡片 border-zinc300/dark800、次要字 zinc600/dark400、44px 搜尋／篩選操作、可見搜尋 label | CMS／主題／外掛／分析工具與低信心主機/CDN 分開，保留自身狀態與 evidence。 |
| `/blogs/[slug]/` | tag 來源頁 sidebar 位置的 BlogTech、相同次要色票與操作高度 | 站名與作者分開；版本未知就明示未知，來源觀測時間和最後嘗試分開。 |
| `/relations/` | 既有 tag 圖表與清單層級；方法說明為同樣原生 details 展開 | 正文引用、blogroll、共同標籤、文字相似分開；不稱為抄襲，不以共現推論交流。 |
| 方法說明 | FooterMethod 是目前共用原生 details，內容置於頁尾，手機主內容優先 | 尚未改成 tag 的平行 @notes 路由；各頁內容來自同次匿名資料而非另一份快取，避免重複說明，先保留既有接線。 |
| 所有公開資料快取 | SSR、不傳 Cookie/token、導航 prefetch=false | **維持 private/no-store**；不同於 tag 可快取頁，直到 origin/Next/edge 三層撤下失效皆有實證才評估。 |
| 文章／圖示 | 既有 SafeImage 尺寸、lazy 與本地 favicon | 使用者要求文章無圖直接純文字，不顯示占位圖；網站圖示才可用預設圖示。 |

## F4 原始需求核對

偵測只讀既有 HTML/header/script/meta；不新增對來源站的請求。固定白名單規則、sanitized evidence、版本僅取明確 generator、主機/CDN 低信心皆沿用原 detector。公開 API 每次重新驗證站與文章可見性、不共享 promise，失敗回 503 而非零筆。頁面有 detected/unknown/failed/blocked 與未觀測各自數量、公開總數、最後嘗試／成功時間，以及可點技術篩選；部落格頁有規則／證據／信心度／版本／觀測日期。

此次既有觀測查核 UTC：2026-10-14T22:13:37.948364+00:00。313 個公開部落格全數讀取：detected 104、unknown 164、failed 0、blocked 7、未觀測 38。這是該次 API 讀取，不是假定資料凍結或同一個全站交易快照。

- Alina：仍是 2026-10-13T03:34:12Z 的 body-fragment，unknown。沒有新 generator 原文，不把舊 adapter 當 WordPress 證據。
- Carol：2026-10-14T00:58:20.216Z 有 Blogger 規則命中，版本 unknown；同一 q 搜尋另有不同候選名稱，不將它跨站合併。
- timdream：仍是 2026-10-13T03:19:44Z 的 body-fragment，unknown。雖研究者曾在瀏覽器見 7.1.3，本站沒有保存該 generator，不能宣稱已取得此版本。

原始 API DTO：`/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f4-round2/live-tech-cases.json`。沒有為本批補抓外部首頁。Alina/timdream 的完整公開回應證據仍待正常既有爬取自然取得，F4 資料 coverage 不宣稱完成。

## 四頁一批的互動證據

本批四個 route 為 `/topics/`、`/tech/`、`/relations/`、`/blogs/anise-tw-534/`，每頁 1280/390；保留單個 capture 最多四張的限制，因此分成兩個子批，不把兩頁當四頁。原圖、raw network、SHA/BUILD_ID、DNT1、實際 GPC 值與操作前後 DOM 幾何在 repo 外私有目錄。第一次 gen21 capture 的可見性推導過於寬鬆、方法 summary 被 sticky header 蓋住，保留原 artifact，修正工具後重拍，不覆寫歷史或算成新程式碼已 pass。

完整頁面、深色與空／錯／權限狀態仍逐頁 pending；非作者看圖 transcript 與後續新 SHA 正式圖以 UI ledger 為準。

## 回填守門結果

五篇／60 秒試跑僅寫入 10 筆，到游標 24448；UTC2026-10-14T22:01:52.508Z 首頁 HTTP500、6.412 秒，CLI 自動退出，沒有自動重試。兩筆 gateway overview log 的 databaseCode 為 unknown，現存證據不足以斷言唯一根因。後續正式三站恢復200、blog三次中位2.470秒，先減回一篇／較長間隔再小量驗證，不恢復五篇批次或同時開 worker producer。
