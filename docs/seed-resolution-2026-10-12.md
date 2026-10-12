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

本階段以 Codex 查找、身份核對、資料交易交叉審查及整合測試為主，本階段八個 Codex review／整合驗收節點與三次完整 Claude Opus 5.5（8:3），Opus 留給正式資料寫入與安全邊界；確認回傳 model 和 finish_reason。兩次截斷回應均不算完成審查。

採納：URL 正規化／轉址原址所有權檢查、既有 candidate 狀態與 audit 前態、禁止弱名稱跨站配對、RSS channel link 陣列處理，以及 writer 的 affectedRows／欄位長度／錯誤隔離。未採納「candidate URL 全表唯一」假設，因實際 schema 唯一鍵是 `(url, source_type)`，保留多來源 provenance；IPv4 malformed／IPv6 繞過疑慮由既有 isIP、URL 正規化與 DNS 釘選測試覆蓋，未為此放寬抓取限制。私人 packet 與回應不入 Git。

## 最終執行結果

131 個缺網址種子已自動補上 **122 個**：120 個獨立站點與 2 個有完整搬家證據的同站別名（89→28、134→94）。合計 135 個種子為 124 個 verified、2 個 moved、9 個 unresolved；原始 136 列完整保留，新增 120 筆 bind-seed 與 2 筆 bind-seed-alias 稽核。

| unresolved | 原因 |
|---|---|
| 惡名昭彰、mouggan | 官方身份已找到，但未找到有效 RSS／Atom／sitemap；不把商店首頁假當文章 feed |
| 天才領袖、pkstep 痞凱、Wstyle、吹著魔笛的浮士德 qbnews.tw | 正式抓取回應 HTTP 403，沒有繞過 |
| 史萊姆、MiniMatters | robots 禁止，沒有繞過 |
| JazzNews | 官方域及 www 均 DNS ENOTFOUND，沒有改用同名的其他網站 |

每一筆已寫入的身份證據另保存於 discovery audit；失敗檢查及搜尋證據保存在本機 `.reviews/seed-resolution/`。初次文章／favicon 執行及部署結果如下。


## 圖示與正式驗收

135 個種子全數檢查：此次成功寫入 115 個圖示、沿用已有效的 4 個，合計 **119 個本地 PNG**；7 個抓取失敗（其中 2 個受 robots 限制，5 個沒有可解碼的本站圖示）、9 個缺網址，共 16 個使用預設。既有候選圖示 845 個保留，沒有用平台總站圖示補數量。圖示均位於 release 外的 runtime cache，revision 持續有效。

正式 release **`9400b6a4a54fb0ae34ad22fd7158241cc63bc276`** 已 push 至 GitHub main。建置使用新 detached worktree、根／web 分別 `npm ci`、release 的 165 項測試、雙專案 typecheck、Biome 與 Next production build。Lint 僅保留既有 Avatar raw img 警告與設定格式升版資訊，無錯誤；導覽切換的 effect 保留原意，候選載入函式改為穩定 callback。

先以 gateway 18165／web 18166 驗證，再切換 blog gateway／web／worker；favicon timer 保持 active。正式 gateway 仍 18160，Next 18162。三服務共用同一 release，舊 c09ddae release 保留；本次無 DB migration。預覽程序驗證後已關閉。

正式 HTTP 驗證：首頁、`/blogs/`、已補網址的波比個別頁、`/api/blogs`、`/api/overview`、`/healthz` 均 200；OAuth 起始 302、S256、精確 `https://blog.observe.tw/auth/google/callback`；`//127.0.0.1:18160/healthz` 攻擊路徑 400；tag.observe.tw 與 youtube.observe.tw 皆 200。T3 瀏覽器 390px 實查波比頁，文章與 revision 圖示已載入、無水平溢出；公開 PNG 與本地檔案 SHA-256 相同。

真人 Google 同意／callback 後登入狀態仍需使用者本人最後驗收；沒有宣稱已代替真人完成 Google 授權。本階段無改動 OAuth 邏輯、Similarweb 外部請求協調或姊妹站服務。


## 實際資料回歸修正

樂活台南 RSS 中的長摘要超過 MariaDB TEXT 位元組上限；改為保留完整 Unicode 的 60 KiB 摘要上限、作者 255 字元與過長圖片網址捨棄。ETag／Last-Modified／成功時間須等該來源所有文章及作者／標籤寫入成功才保存，避免部分失敗後 304 跳過缺漏；`--history` 不送條件標頭，異常 304 不當作成功。該站已重新下載並成功處理 25 篇。

滿分、布雷克、美奈子、坭喃貓、Jessy、馬克斯的 sitemap 首項為 misc，另外驗證並登記實際 post sitemap，各有 add-verified-source audit。RSS／Atom 與文章 sitemap 優先，misc 來源保留但不先耗盡每站 30 頁預算。來源名稱只用於排序，頁面仍須有文章證據才入庫；所有抓取仍受同一安全／禮貌規則限制。

採納最後整合審查的防禦性 URL 過濾並補相對／非法 loc 回歸；原先 XML parser 已先解析成絕對合法網址，並非可繞過 SSRF 的新漏洞。history 304 原本即走失敗分支，測試確認後保留；`history_imported_at` 表示有成功的有界匯入，不保證每個來源或完整歷史皆已處理。完整歷史翻頁／多 sitemap 游標仍是後續工作，不能把本次初抓說成全歷史完成。


## 收錄結算

120 個新核對獨立站均完成初次抓取；長摘要失敗站已補抓，六個誤選 misc 的站各補抓 30 篇，沒有留下未處理的批次例外。結算時資料庫共有 **1,537 篇文章、106 個站有文章**。18 個 verified 站在本輪沒有可索引文章（包含商店、空 feed 或無文章類型證據的 sitemap），不因此判 stale，也不把商品頁補成文章。

原始 136 列再次以備份與目前 seed_records 的 dump INSERT 作 SHA-256 比較，結果逐位元組相同。新增稽核合計 120 筆綁網址、2 筆搬家別名、6 筆文章來源補登。所有私人研究、測試、review 與執行報告均未提交 Git。

main 最後再補一項共用 sitemap 排序函式的非法直接輸入測試，合計 **166 項通過**；此項與紀錄文件不改變正式 runtime，因此不為文件／測試重建 release。正式程式 commit 9400b6a 是 main 祖先；下一次部署仍須遵守 fetch／祖先檢查／乾淨建置流程。

待外部條件或後續範圍：9 個 unresolved 站的可用官方索引／DNS／抓取許可、7 個圖示失敗站的可用圖示、完整歷史游標與分片遍歷，以及真人 Google 授權驗收。這些項目有原因與證據，不以猜測、繞 robots 或交回整批人工配對收尾。
