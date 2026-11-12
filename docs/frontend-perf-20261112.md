# 前端效能（2026-11-12，source／fixture 驗證，未部署）

分支 `perf/frontend-20261112`，基底 `28ec313`。只改 `web/`：不動爬蟲、scraper fleet、排程、gateway、DB 或正式站；
沒有 build／capture 正式 release，也沒有切換 slot。截圖與量測全部用本機 fixture gateway（合成資料，無 DB）。

## 1. 首頁與重頁面快取：維持 no-store，TTL 全部為 0

`/`、`/relations/`、`/traffic/`（以及其他公開資料頁）**不加 ISR、`revalidate` 或資料層快取**。依
[公開內容撤銷規則](public-page-cache.md)：origin／Next／Cloudflare 三層主動撤銷證據不齊前一律 bypass + no-store，
明文排除「s-maxage ≤ 60 秒」之類短 TTL 例外；gateway 也不得共用進行中或已完成的結果（B0 barrier），所以 Next
端的記憶體快取或 request coalescing 同樣不行。使用者 2026-11-12 確認照此規則處理。

| 頁面 | 選定 TTL | 理由 |
|---|---|---|
| `/` | 0（force-dynamic、no-store） | 首頁列文章與標題；隱藏／撤銷後下一個請求就不能再出現 |
| `/relations/` | 0 | 提及關係含文章證據，撤銷時限同上 |
| `/traffic/` | 0 | 部落格列表依公開狀態篩選；隱藏站點不得殘留 |
| `/my/`、追蹤、session | 不經伺服器快取 | 頁面是靜態外殼，個人資料只在瀏覽器以 credentialed no-store 讀取 |

爬蟲造成的 500 已由 `378b296`／`28ec313` 修正（loopback render bucket 漏列與容量不足），根因不是缺快取。
本批能在規則內做的是：慢頁先送出骨架（第 3 項），以及把既有 no-store 契約固定在測試（`web/test/public-cache.test.ts`
的 `no page in the app is ISR`、`public data pages stay force-dynamic`，新增 loading boundary 與 follows 契約）。
若日後要恢復快取，前提仍是 public-page-cache.md 所列的三層主動撤銷驗證，不是調 TTL。

## 2. 圖片：不開 Next image optimizer，關閉 `/_next/image`

評估後不開最佳化：

- 圖片來自約 700 個任意部落格網域，`remotePatterns` 只能是 `**`，等於在 SM 上開一個任意抓取＋縮圖的 proxy；
  爬蟲或惡意請求可讓同機（與 tag-db 共用 CPU／記憶體／IO）跑 sharp。
- 伺服器端抓圖會取代目前「瀏覽器直接向原站讀、`no-referrer`」的設計，並把第三方圖片寫進 `.next/cache/images`
  （位於不可變 release 目錄內，持續成長）。
- 縮圖顯示 64–80 px、首頁大圖已是 `fill`＋`sizes`＋`fetchPriority=high`，其餘 `loading=lazy`；寬高或 `fill`
  與 `sizes` 原本都齊全（`NewsImage.tsx`、`ArticleThumbnail.tsx`），版面不會位移。

實際修正：舊設定 `remotePatterns: [{hostname:'**'}]`（http 與 https）讓 `/_next/image?url=<任意網址>` 仍可被
直接呼叫。改為 `images: { unoptimized: true, remotePatterns: [], localPatterns: [] }`：全域 unoptimized 時 Next 不提供
`/_next/image`（404），空 patterns 確保日後拿掉 `unoptimized` 也不會重新開放任意網域。畫面輸出不變（所有
`next/image` 本來就 `unoptimized`）。

## 3. 慢頁 loading 骨架

- `/relations/`、`/topics/`、`/topics/trending/` 新增 `loading.tsx`：渲染該頁自己的 pending 畫面（同一標題、
  期間分頁與頁尾，依網址 `?days=` 標示），資料區用 `PendingRows` 灰色列（`aria-hidden`、`motion-safe` 才閃爍，
  不假造名稱或數字），原本的 `role=status` 文字保留。
- `/topics/` 的 page 移到 route group `app/topics/(ranking)/`，網址不變；這樣 loading boundary 不會包住
  `/topics/[id]/`——那頁對未知／撤銷話題要回 HTTP 404，若上層先串流就會變成 200。
- **不加**的頁：`/traffic/`（讀取失敗時整頁失敗，先串流會把 5xx 變成 200 的錯誤頁）、`/tech/`（關閉時 404）。
  契約測試鎖定 loading boundary 清單，且其下的 page 不得呼叫 `notFound()`／`redirect()`。

## 4. `/api/me/follows` 共用讀取

`lib/follows-store.ts`（`useSyncExternalStore`）：同時掛載的 `FollowButton`、`ReaderList` 共用一次
credentialed、no-store 讀取；最後一個元件卸載即 abort 並丟棄資料，下次掛載（換頁、上一頁、換帳號）重讀；
不寫瀏覽器儲存，伺服器 snapshot 永遠是 `loading`，個人資料不會進入共享 HTML。

`FollowButton` 原本每次點擊先打 `/auth/me` 再送 follow；現在若 follows 讀取已回 401 就直接導向登入，否則直接送
follow，回 401（session 過期）再導向登入。每個 `/api/me/follows` 在 gateway 都是一次 DB 查詢加圖示 manifest，
少讀也減輕共用 tag-db。

## 驗證（UTC 2026-11-12 10:46–11:10，sky-server，非 SM）

測試：`npm run test:web` 258／258（新增 7）、`npm run test:topic-ui` 205／205、`npm run typecheck` 通過。
`npx vitest run` 1546 通過／15 失敗，與未改動的基底 `28ec313` 完全相同（`app/src/scrapers/*` 14 項、
`collection-count.spec.ts` 1 項仍期待 2000／min），本批未碰這些檔案。

Build：before（`git archive 28ec313`）與 after 各一次 `next build`，nice 19／ionice c3、
`CIRCLE_NODE_TOTAL=2`，開始前 load1 ≤12 且同機無其他 build。兩者都以 `next start` 接本機 fixture gateway
（`web/test/public-payloads.ts` 的空答案加合成列，無 DB；`/api/topics?…order=`、`/api/relations?days=7`
人為延遲 4 秒模擬慢主機）。瀏覽器一次一個、DNT=1、非本機請求全部拒絕（合成縮圖由本機回應）。

| 項目 | before | after |
|---|---|---|
| `/`、`/relations/`、`/traffic/`、`/topics/`、`/my/` 的 Cache-Control（有無 session cookie） | `private, no-cache, no-store, max-age=0, must-revalidate` | 相同 |
| 連續 5 次請求 `/`、`/traffic/`、`/relations/` 的 gateway 讀取次數 | 各 5 | 各 5（不共用結果，符合撤銷規則） |
| 慢讀取時 `/topics/` TTFB／完成（3 次中位數） | 4.012 s／4.012 s | 0.007 s／4.011 s |
| 慢讀取時 `/relations/` TTFB／完成 | 4.011 s／4.012 s | 0.012 s／4.013 s |
| 點擊後 900 ms 畫面 | 仍是上一頁（首頁） | 該頁標題、分頁與骨架列 |
| `/topics/rss%3A999/`（未知話題） | 404 | 404 |
| `/_next/image?url=https://img.fixture.test/…` | 500（伺服器嘗試向外抓取） | 404（端點不存在） |
| `/_next/image?url=/favicon.ico&w=64` | 200（sharp 即時縮圖） | 404 |
| 完成後畫面（首頁、話題、關係圖、部落格頁、`/my/`，1440／390） | — | 與 before 像素完全相同 |
| 每頁 `/api/me/follows` 讀取 | 1 | 1（目前兩元件不會同頁出現） |
| 點「追蹤」：未登入 | `/auth/me` → 導向登入 | 直接導向登入 |
| 點「追蹤」：已登入 | `/auth/me` → `DELETE follow` | `DELETE follow` |

截圖（repo 外）：`/home/sky/.cache/blog-perf-frontend-20261112/shots/`，雜湊 `../SHA256SUMS`，原始輸出
`../evidence.txt`。這是本機 fixture 的相對比較，不是正式站 origin／Cloudflare 時間，也不是 candidate 驗收；
部署前仍依 [下一批 release](next-release-candidate.md) 的閘門與逐頁 review。
