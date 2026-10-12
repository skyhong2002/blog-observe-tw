# 被動技術偵測離線稽核（2026-10-13）

本次只盤點既有檔案並執行純函式測試，沒有 HTTP、資料庫存取、匯出、補抓、capture、build 或部署。工作樹 HEAD 為 `42711cf18c452b406904af6000ccbf88a1ff6102`，含尚未提交的 F4 程式；這不是正式環境偵測結果。

## 三站實際輸入盤點

| 站點 | 找到的既有資料 | 抓取 UTC／記錄的 HTML SHA-256 | 本次結論 |
| --- | --- | --- | --- |
| Alina（`https://alinalife.tw/`） | 舊身分／來源驗證摘要，當時 HTTP 200；未找到原始 HTML 或 headers | `2026-10-12T04:21:01.055Z`／`8f8dcdd405ae6df754ddfa3f9caf29c6c3fb18acf0999b2bafe30b52c3f023b6` | `missing-input`，沒有執行真站 detector |
| Carol（`https://caroleasylife.blogspot.com/`） | 舊身分／來源驗證摘要，當時 HTTP 200；未找到原始 HTML 或 headers | `2026-10-12T04:21:46.321Z`／`7ed864348d2022be6863e168c699f0bce2ae685b70c6214f4795610e57c6f29f` | `missing-input`，沒有執行真站 detector |
| timdream | 第三方 blogroll 的 `http://blog.timc.idv.tw` 連結，以及以 `https://timdream.org/` 為 URL 的合成單元測試 | 未找到可核對的目標站原始 response、抓取 UTC 與 hash | `missing-input`；不把口述 7.1.3 或合成 generator 當實測 |

Alina／Carol 摘要來源為既有 `/home/deck/.t3/projects/blog-observe-tw/.reviews/seed-resolution/validation-first.json`。該 hash 是舊摘要記錄值，**本次沒有原文可重新核對**。另一站 HTML 中的外連片段也不能代替目標站的 response。盤點範圍為專案 fixtures、原專案 `.reviews`、`/home/deck/.cache/blog-*` 既有審查檔及 `/home/deck/.t3/userdata`；不讀正式 DB 或備份，因此不能聲稱資料庫也沒有原始內容。

真站統計分母為要求的 **3 站**：detected 0、unknown 0、failed 0、blocked 0、not-observed 0、missing-input **3**。可執行的真站輸入分母為 **0**，偵測率不適用，不能寫成 0% 成功或延伸為 313 站 coverage。缺檔不能歸為抓取失敗、robots/WAF 阻擋或已觀測但技術未知；本次也沒有資料庫觀測紀錄可宣稱 not-observed。

## 合成離線驗證（與真站驗收分開）

新增 `app/src/tech/offline-evidence.spec.ts`，並將舊 timdream 單元測試名稱明確標示為 synthetic。六個測試驗證：

- 有 generator 的 detected、成功但無可辨識標記的 unknown、有明確 timeout 證據的 failed、有 HTTP 403 證據的 blocked；四者皆不呼叫 fetch。
- 明確 CMS generator 信心 0.95；Cloudflare 屬 CDN，Vercel／Netlify 屬 hosting，header 提示信心 0.3，不保留私人 header 值。
- 未提供 generator 版本時為 `unknown`；asset `?ver=7.1.3`、server 字串都不能補出 CMS 版本。明確 generator 才可提供版本。

純函式合成四狀態輸出分母 **4**：detected 1、unknown 1、failed 1、blocked 1、not-observed 0、missing-input 0。這是設計的測試組合，不是網站分布。

執行：`./node_modules/.bin/vitest run app/src/tech/detector.spec.ts app/src/tech/offline-evidence.spec.ts --maxWorkers=1`，**2 檔、32 tests 通過**。第一次執行有 4 個測試失敗，原因為合成時間設成尚未到來的 UTC，正確觸發未來時間驗證；已改成固定過去時間後重跑通過，未放寬正式 validator，原失敗日誌仍保留。啟動兩次測試時 load 分別為 10.50、8.89，均低於 12。

小型機器可讀證據保存在既有工作樹的忽略目錄 `/home/deck/.cache/blog-tech-features/.reviews/b0-f4/offline-input-audit-20261013/`：`input-inventory.json`、`synthetic-results.json`、初次 `unit-tests.log`、修正後 `unit-tests-fixed-clock.log`。原始三站實測仍缺輸入；本批不替這項缺件新增擷取行為。

本次只將 contracts、純 detector 及其兩個測試檔整合至 main；尚未接上 worker、路由、UI 或 migration，沒有增加抓取或啟用正式功能。
