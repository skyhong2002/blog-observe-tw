# 種子網址自動查找與收錄紀錄（2026-10-12）

## 基準與保護

從 fetch 後的 `origin/main` `19fad46781ae6a56edc2465bf8135765460d50f5` 開始；此前 `feat/tag-frontend-parity` 已合併，正式版本 `c09ddae` 也在 main 歷史中。

原始 135 站有 4 站已有網址，此次處理其餘 131 站。136 列原始 seed（含同名重複列）的來源 SHA-256、原名、列號、分類及原值保留；不提交原始 CSV 或私人研究報告。

正式寫入前的完整 DB 備份位於 Steam Machine 私人 `~/.local/share/blog-observe/backups/pre-seed-resolution-2026-10-12T04-19-47.208Z.sql`。在隔離、資源受限的 MariaDB 還原後，驗證網址綁定、重跑冪等、audit 失敗全部回滾、正規化 URL 所有權衝突與 136 列不變，測試容器已清除。

## 安全與資料品質

- 驗證器要求首頁第一方身份及有效 RSS／Atom／sitemap；拒絕平台總站、留言 feed、200 HTML 假 feed、售出網域及跨站弱字串身份。
- 抓取沿用 robots、DNS 釘選、redirect 每跳檢查、UA／延遲與大小上限。修正特殊 IPv4 網段判定過寬：例如 `192.0.78.12` 是公開 WordPress IP，不能因 `192.0.0.0/24` 是特殊網段而阻擋整個 /16；新增精確 CIDR 與相鄰公開位址回歸測試。
- 已驗證 feed 持久化後供 worker 使用。Sitemap 中商品／分類頁須經文章類型確認，不能直接用 URL slug 建文章；初次每站限 30 頁，不代表完整歷史已匯入。
- 例如「貓大爺」採現站 lordcat.net，不能把名稱不同的 lordcat.tw 新站誤配；「吟詩旅人」為 lovefood.cc，不與「貪吃鬼熊熊」bearlovefood.com 合併。Nasheat 與 Nash 亦保留不同站。
- 全部寫入僅涉及 blog 自己的資料；不改 tag/youtube 程式、排程或資料。

## Review

本階段以 Codex 查找、身份核對、資料交易交叉審查及整合測試為主，本階段六個 Codex review／整合驗收節點與兩次完整 Claude Opus 5.5（3:1），Opus 留給正式資料寫入與安全邊界；確認回傳 model 和 finish_reason。截斷的首次回應不算完成審查。

採納：URL 正規化／轉址原址所有權檢查、既有 candidate 狀態與 audit 前態、禁止弱名稱跨站配對、RSS channel link 陣列處理，以及 writer 的 affectedRows／欄位長度／錯誤隔離。未採納「candidate URL 全表唯一」假設，因實際 schema 唯一鍵是 `(url, source_type)`，保留多來源 provenance；IPv4 malformed／IPv6 繞過疑慮由既有 isIP、URL 正規化與 DNS 釘選測試覆蓋，未為此放寬抓取限制。私人 packet 與回應不入 Git。

## 最終執行結果

131 個缺網址種子已自動補上 **122 個**：120 個獨立站點與 2 個有完整搬家證據的同站別名（89→28、134→94）。合計 135 個種子為 124 個 verified、2 個 moved、9 個 unresolved；原始 136 列完整保留，新增 120 筆 bind-seed 與 2 筆 bind-seed-alias 稽核。

| unresolved | 原因 |
|---|---|
| 惡名昭彰、mouggan | 官方身份已找到，但未找到有效 RSS／Atom／sitemap；不把商店首頁假當文章 feed |
| 天才領袖、pkstep 痞凱、Wstyle、吹著魔笛的浮士德 qbnews.tw | 正式抓取回應 HTTP 403，沒有繞過 |
| 史萊姆、MiniMatters | robots 禁止，沒有繞過 |
| JazzNews | 官方域及 www 均 DNS ENOTFOUND，沒有改用同名的其他網站 |

每一筆已寫入的身份證據另保存於 discovery audit；失敗檢查及搜尋證據保存在本機 `.reviews/seed-resolution/`。文章／favicon 執行與部署結果將於完成後追加。
