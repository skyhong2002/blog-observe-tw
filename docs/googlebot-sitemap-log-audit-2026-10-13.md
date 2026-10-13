# Sitemap 的可信 Googlebot 日誌查核

查核時間：2026-10-13T08:17:45.959223Z。只讀既有日誌，沒有重新探測正式站、開啟 access log 或修改 Cloudflare。正式版本仍為 `4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8`，BUILD_ID `2ZIfs00KopZi_HHl8ahLU`；這是查核時的版本背景，不代表所有歷史日誌都由此版本產生。

**結論：現有來源不足以確認可信 Googlebot 是否抓取 sitemap。** 不能把缺少請求紀錄解讀為 Google 沒有抓取，也不能據此解釋 Search Console 的「Success、discovered 0」。

## 實際資料與缺口

來源為 user journal 的 blue/green gateway、舊 gateway 與 edge，查詢起點為 2026-10-12T00:00:00Z。實際保留 264 個 journal frame，時間範圍為 2026-10-12T17:09:05.908185Z 至 2026-10-13T06:23:42.054063Z。

| 路徑 | 可配對請求紀錄 | 可驗證 Googlebot 的紀錄 | 抓取 UTC／狀態碼／大小 |
|---|---:|---:|---|
| `/sitemap.xml` | 0 | 0 | 未知 |
| `/sitemaps/pages.xml` | 0 | 0 | 未知 |
| `/sitemaps/blogs.xml` | 0 | 0 | 未知 |
| `/sitemaps/topics.xml` | 0 | 0 | 未知 |

目前 gateway 明確設定 `disableRequestLogging: true`，edge proxy 沒有 access log。這些 journal 主要是服務／錯誤紀錄，不含足以完成請求、回應與客戶端身分驗證的資訊。上述 0 是找到的日誌筆數，**不是實際抓取次數**；最後一筆日誌時間也不是服務停止時間。

## 驗證方法與去識別

只對日誌直接記錄的公開 peer 驗證：反查 DNS 必須符合 Googlebot 網域，接著正查同一名稱，確認結果包含原 IP。UA 字串不構成驗證；loopback、未驗證的 forwarded header 或 Google Inspection Tool 也不能直接當成 Googlebot。方法依 [Google 的請求驗證文件](https://developers.google.com/crawling/docs/crawlers-fetchers/verify-google-requests)。

本次沒有可驗證 peer，因此沒有執行反查／正查，不能宣稱任何個別請求已通過驗證。分析過程不保存訪客 IP、完整 UA、cookie、Authorization 或其他個資。缺少的時間、狀態碼及 bytes 保持未知，不由其他 curl 或 GSC 畫面補造。

私有去識別結果：`/home/deck/.t3/projects/blog-observe-tw/.reviews/googlebot-audit/result.json`。分析程式：同目錄 `analyse.py`。它們不進 Git；本文件保留可供交接的摘要。

若後台另有**既有** Cloudflare verified-bot 請求紀錄，可再提供四條路徑的去識別時間、驗證依據、狀態碼與大小。本次沒有取得該來源，也沒有授權新增或改動 Cloudflare 記錄設定。
