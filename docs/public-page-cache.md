# 公開內容的撤銷與快取

2026-10-13 安全修正：暫停所有含文章／部落格資料頁的 ISR。舊版 ISR 120 秒加 SWR 180 秒及 API／SEO 快取不能滿足撤銷時限，不能再拿舊設計作為正式快取契約。

| 層 | 目前保存時間 | 失效方式 |
| --- | --- | --- |
| 公開 HTML：首頁、文章、來源、話題、作者、標籤、關係、流量 | 0 | Next force-dynamic，每次請求重讀 |
| Next gateway fetch / React | 0 | fetch no-store；React memoize 只限同一次 render |
| 瀏覽器資料 loader／搜尋建議 | 0 | 不存 Map/localStorage，fetch no-store；分頁再讀 |
| gateway API／SEO 結果 | 0 | 只合併同時進行的請求，不保留已完成結果 |
| 關係資料投影 | 0（公開讀） | 每次讀 SQL；worker 的診斷 snapshot 不供公開回應 |
| sitemap | 0 | 重新查公開證據；HTTP no-store |
| edge／Cloudflare 可變內容 | 0 | private,no-store；剝除上游 CDN override，Cloudflare 協助者已停用首頁／API 規則並清除該主機 edge 物件 |

不使用 on-demand revalidate 或 Cloudflare tag purge。這是撤銷正確性優先的暫時策略；恢復 ISR 前必須有經驗證的主動撤銷機制，不能僅把每層 TTL 各設成 60 秒。

公開內容一律要求站點 verified、文章仍存在、發布時間不在未來。隱藏其中一站不能讓同話題另一站消失。真實不存在與隱藏回 404，累積話題所有證據撤銷回 410。

靜態 JS/CSS 與 favicon 不含文章正文、標題或文章清單，維持靜態資產快取；favicon 原始檔不因隱藏站點而刪除。API 的 favicon manifest 仍是網站圖示資產目錄，不代表站點目前可公開。

已下載、複製或離線保存的內容無法由伺服器追回。已開啟畫面不持續輪詢，回到頁籤、bfcache 還原與上一頁／下一頁會重新讀取。驗收時間指資料撤銷 commit 後的新 HTTP／SSR 請求；不能把它冒稱為所有已開啟離線畫面同時被清空。

## 隔離驗收

`tests/integration/content-visibility.mjs` 強制使用 18169 的隨機 disposable DB。兩站共用話題、另一個僅第一站有文的話題；暖快取兩次 → 隱藏 → 恢復並重新暖快取 → 刪除。16 個端點核對標題、文章 ID、另一站保留、404/410/no-store。SSR 另以正式 Next build 連同一隔離 DB 驗證首頁、文章、來源、目錄、話題。

CF 驗收必須是正常無 Cookie／query／Authorization 的 GET /，確認既有 HIT／Age 已消失，連續兩次確認 no-store 與 BYPASS／DYNAMIC。加 query、RSC 或 Cookie 的 bypass 不能當作舊 CF 物件已撤銷的證據；Cloudflare 沒有掛接隔離資料库，不能宣稱直接對 CF 做了 fixture 隱藏測試。

2026-10-13 最新要求：沒有任何「s-maxage ≤ 60 秒即可恢復」例外。origin、Next、Cloudflare 三層主動失效證據不齊前，一律維持 bypass + no-store。[部署與驗收紀錄](privacy-deployment-2026-10-13.md)。
