# 公開資料撤銷、HSTS 與舊服務退役驗收

> 此文是 18:31–18:47 UTC 的歷史部署紀錄。現行 release 為 42711cf（20:19:52.889 UTC，blue generation 4）；最終 barrier 與正式標頭見 [B0 驗收](b0-acceptance-2026-10-13.md)。舊版共享未完成查詢的缺口已移除，不以舊版序列測試取代最終證據。

時間均為 UTC；本階段原始 remote main 為 `f6bd9191cae318c5bfb9c63e0b213fb6b8b3905f`，本輪退役改動基於重新 fetch 的 `2a47d92cc31c56e18da074e54dccecb0cb03119d`。所有修正 commit 已推至 main，沒有修改 tag／youtube 程式、服務或 Cloudflare 設定。

## 正式版本與切換

| 項目 | commit／時間 |
| --- | --- |
| 公開資料 predicate、no-store、Next 動態讀取 | `a45b06a8816e8388c463173f6b7c43da81aeb51b`，2026-10-12 **18:31:23.817Z** atomic blue 切換，generation 2 |
| HSTS edge | `2a47d92cc31c56e18da074e54dccecb0cb03119d`，18:33:33Z edge 程序啟動；socket 保持 listener |
| 舊服務退役／active favicon launcher／安全回滾底線 | `93060cc5e97628f84fa1fb2b8e9eecc41157d462`；舊服務停止 18:39:21Z、新 timer 啟用 18:42:52Z |

本歷史紀錄當時應用為 blue a45b06a（gateway 18174、web 18172），沒有為 timer 安裝重建或切換應用。edge/code 指向 93060cc 的 immutable archive，運作中的 edge 程序仍從 2a47d92 啟動；兩者的 proxy／HSTS 程式相同。下次啟動 wrapper 或排程使用新 launcher。green 2379fba 保留供診斷，**不允許安全回滾至該版本**；手動／自動回復必須通過 a45b06a 祖先檢查。

本輪容量檢查：安裝前 `/home` 465G／used 297G／available 155G／66%；驗收後 available 154G／66%。全程超過 10 GiB，沒有刪除、清理或新建完整資料庫備份。

## 對外標頭、效能與主機負載

18:43:07Z 開始的正常匿名 GET（無 query、Cookie、Authorization）驗收如下；四項全部 200，無 Age，x-blog-release 均為 a45b06a。

| 路徑 | Cache-Control | cf-cache-status | 未命中快取的 5 次 TTFB 中位數 |
| --- | --- | --- | ---: |
| `/` | `private, no-store` | `DYNAMIC` | 1292 ms |
| `/blogs/` | `private, no-store` | `DYNAMIC` | 440 ms |
| `/topics/` | `private, no-store` | `DYNAMIC` | 869 ms |
| `/api/v1/articles` | `private, no-store` | `DYNAMIC` | 410 ms |

TTFB 是每次新連線等待**最終 200 headers**（包含連線／TLS／Cloudflare 回源），不是 HTTP 103 Early Hints；先前 curl 將 103 當成 time_starttransfer 的數值已捨棄。前三頁量測從 18:35:11Z 開始，API 從 18:41:30Z 開始。這不是純 origin CPU 執行時間。另於 18:47:00Z 直接經本機 edge 18160、同樣每路徑 5 次量測，首頁 **823 ms**、目錄 **83 ms**、話題 **478 ms**、文章 API **15 ms**（中位數）；這組排除 Cloudflare／公網／TLS，較接近實際 origin 回應時間。

同機 load average（1/5/15 分鐘）：切換前 18:30:16Z 為 **3.33 / 4.84 / 5.88**；18:35:11Z 為 **9.65 / 6.36 / 6.07**；18:41:30Z 為 **2.18 / 3.84 / 5.04**；18:43 驗收後為 **5.88 / 4.41 / 5.09**。主機還有其他工作和服務，這些是時間切片，不能把全部差值歸因於取消快取。動態首頁確實增加回源工作，待可靠撤銷機制完成後再改善。

Cloudflare 協助者已停用首頁 a142…／API 8056…兩條規則並 purge blog 主機快取。這邊沒有操作其他規則／WAF。初次切換後曾觀測到舊 HIT；那段初測不作撤銷成功證據，以上採清除後正常 URL 的 DYNAMIC/no-store 結果。

## 撤銷契約與隔離測試

所有含文章／來源資料的 origin API、Next fetch、HTML／RSC、搜尋 loader、話題與 sitemap 均不保留完成的結果，TTL 為 **0**；當時仍會合併同時進行的查詢，後續確認這不符合commit後新請求契約；42711cf已移除跨請求的共享promise，見最新B0文件。公開 SQL 要求 blog verified、文章仍存在、非未來發布；不再只排除 moved。關係公開讀不使用 worker 舊 snapshot。層別詳細規則見 [公開內容與快取](public-page-cache.md)。

隔離 MariaDB 為 18169 的隨機測試 DB，gateway／Next 為 18176／18177，使用正式 a45b06a build。兩站 A/B 共享一話題，另有 A-only 話題；先讀兩次，再把 A 改為非公開 seed，恢復／重新讀取後刪除 A 的文章。沒有對正式資料做這類驗證寫入。

- 16 個 gateway／API／RSS／sitemap 端點：第一輪後續請求均看不到 A，B 保留；hide 全批完成 **53 ms**、delete **40 ms**。
- 真正 Next HTML（首頁、文章、來源、目錄、話題）：hide 全批完成 **452 ms**、delete **432 ms**，第一個後續請求即無 A；隱藏來源 HTML 404。
- HTML／完整 RSC／RSC-prefetch 共 24 個後續回應通過：hide 全批 **892 ms**、delete **676 ms**。固定同一 `_rsc` URL，暖讀兩次後才撤銷；完整 RSC 回 `text/x-component`，每次第一個匿名回應即不含撤銷文章。prefetch 原本只回 shell，因此只可證明前後均無文章，不能獨立宣稱它測到了資料撤銷。Next 會先 307 正規化任意 `_rsc` key，測試僅跟隨同一隔離 origin，沒有改變正式的舊話題網址 301 契約。隱藏來源 HTML 是 404；RSC 的 shell／not-found transport 可以是 200，但不含隱藏文章。
- 這是 App Router，Next data 使用上述 RSC；舊式 `/_next/data/<buildId>/index.json` 實測 404，未另有可漏文章的 Pages Router JSON。
- 這些毫秒數是撤銷資料 commit 至整批請求完成的量測，不是允許曝光的 TTL，也不是等待後才測。

不宣稱已證明「啟用快取後三層主動 invalidation」：目前根本不啟用內容快取，CF 也未接隔離 DB。沒有 revalidateTag／purge API 的完整回歸證據前，**不得恢復任何公開內容快取，也沒有 60 秒退路**。

已下載的 HTML／複製／離線內容無法追回；既有畫面回到前景、bfcache／上一頁時重新讀取。JS/CSS 與 favicon 是不含文章清單的靜態檔，仍可快取，原始圖示不因站點隱藏而刪檔；不把它們冒稱為可撤回內容。

## 修正前影響範圍與已知資料量

查詢條件過寬的舊端點：`/api/blogs`、`/api/blogs/:slug`、`/api/catalog`、`/api/catalog/authors`、`/api/overview`、`/api/tags/:slug`、`/api/search`、`/api/blogs/:slug/relations`（來源 lookup；關係 evidence 本來已要求 verified）、`/api/blogs/:slug/content`（抽取狀態，不含全文）、`/api/pages/blogs/:key`。使用這些查詢的首頁、來源、文章、作者、標籤、關係頁也受影響。

私人 `/api/me/follows`、`/me/feed.xml`、`/me/opml` 原本需 session，但缺少追蹤來源狀態重查，亦修正。公開 v1 文章主查詢原先已有 verified 條件；不能籠統說所有 v1 端點都曾有相同 predicate 漏洞。各層舊快取仍可能延遲反映撤銷，這是另一個問題。

18:28:50Z 唯讀盤點：舊 `status <> moved` 可納入 **9 個 seed 來源、0 篇文章**。完全不過濾 status 的舊 `/api/blogs` 另外可納入 **2 個 moved 來源、0 篇文章**（後續複核）。seed 的建立時間均為 2026-10-12 04:39:55Z；這只能證明資料可被舊查詢選中，不是有人實際讀取的證據。

稽核另記錄 **1 次來源移除**，2026-10-12 **12:23:19Z**，移除前 **37 篇文章**；目前該來源／文章剩餘均為 0。稽核未保存先前 status，不能宣稱這 37 篇在隱藏後已實際被公開。保留的 415 筆服務 journal（12:11:43–18:26:56Z）沒有逐請求／回應內容日誌；未取得 CF 存取紀錄。因此**歷史實際外洩人次、文章數、開始／結束期間無法由現存證據確定**，不將「未證明」寫成「確定沒外洩」。原始私人稽核只保留統計，不在此文件列出內容、名稱、email 或秘密。

## HSTS 與舊服務

18:43 驗收：`/`、`/api/v1/openapi.json`、不存在頁面（404）、`/favicons/kocpc.png` 均回 **`Strict-Transport-Security: max-age=86400`**，沒有 includeSubDomains／preload。HTTP 無需此標頭；Cloudflare 原先的 308 規則未改。一週穩定後才另評估加長。

舊 `blog-observe-web.service` 已 disabled 且沒有程序（systemd 留下 failed 結束狀態供診斷），舊 gateway disabled/inactive；舊 favicon timer disabled/inactive、service static/inactive。原 unit／drop-in 保留。edge、blue、green 的實際 upstream 與兩個 build rewrites 均不指向 18162。`127.0.0.1:18162` 無 listener，tag 的 `100.85.214.25:18162` 保持監聽。

新 `blog-observe-active-favicons.timer` active/enabled；下次為 2026-11-01 07:05:12 台北時間。`--check` 確認 blue/a45b06a，沒有手動觸發大量抓取。32 項 edge／launcher／部署測試與後端 typecheck 通過；Codex 交叉審查建議已採納安全 rollback floor 與廢止舊操作文件。前端 no-store 實作由 Opus 完成，這次 runtime 小修沒有額外消耗 Opus。

三站首頁皆 200；blog healthz 指向 18174；Google 起始 302，S256 與 `https://blog.observe.tw/auth/google/callback` 正確。真人登入仍需使用者驗收。
