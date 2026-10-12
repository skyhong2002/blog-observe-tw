# 2026-10-12：前端、favicon 與 tag Similarweb 接線驗收

> 本文為前一階段快照；缺網址、候選審核與最新部署狀態請見 [後續完成紀錄](completion-2026-10-12.md)。
## 版本與部署

- 本階段以 fetch 後的 `origin/main` `696c39bb5f904f096a653f4125bf294b61bd6253` 建立獨立 worktree；原共享 checkout 未 reset、未改動。
- 前端移植來源：新文易數 `afe0a653fa8aae7e25a04a1d9fe87bf0400a2a39`，MIT 與 `Copyright (c) 2026 Sky Hong` 保留。
- favicon 功能：`1abadf6`；解碼硬逾時安全修正：`895a6ce`；Similarweb 接線：`c09ddae4cce558e36af5e4404ca63713183ceefe`。均已推送 GitHub main。
- 正式 gateway/web/worker 與每月 favicon service 使用不可變 release `/home/deck/.local/share/blog-observe/releases/c09ddae4cce558e36af5e4404ca63713183ceefe`。對外仍 18160、web 18162，blog DB／Redis namespace 獨立。三服務與 favicon timer 均 active。
- 前端階段 worker 曾維持原版；本次已一併切換 worker，部署 DNS 釘選與 tag API client。前一份 `1abadf6` release 及原 checkout 保留。

## favicon 全批結果

全部 135 個部落格與 1030 筆候選均跑過，未中斷、未自動核准候選。

| 對象 | 成功 | 抓取失敗 | 直接使用預設 |
| --- | ---: | ---: | ---: |
| 部落格 135 | 4 | 0 | 131 |
| 候選 1030 | 845 | 180 | 5 |

131 個種子沒有可核對的 URL，不能憑名稱猜網址；4 個已核對站點均成功。候選失敗包含 robots 禁止、無可解碼的站點圖示與連線失敗；180 筆失敗也在畫面使用預設，因此候選總計 185 筆顯示預設。成功筆數包含同一站點快取的安全重用，不代表發出 845 次來源請求。

runtime catalog 共 1165 筆、本地 PNG 849 個；原始 URL／詳細失敗理由僅保存於私人 runtime，不提交 Git。每月 timer 已啟用，下次為 2026-11-01（有隨機延遲）。實際正式瀏覽器確認圖示 naturalWidth 192；release 的子程序 decoder 也成功轉換。

## Similarweb

已通過本機 token 讀取與真實 tag API GET／POST 契約驗證，才啟用 `BLOG_SIMILARWEB_ENABLED=true`。只提交 dacota.tw、kocpc.com.tw、saydigi.com、soft4fun.net；各 traffic／similar_sites，共 8 筆 POST。tag 讀回 pending，沒有杜撰流量或相似站。

立即再次執行得到 waiting，未重送；本地當日計數 8，下輪至少六小時。worker 每小時檢查 gate。結果出現前公開流量頁顯示等待；Similar Sites 本來就可能 no-data。tag 擁有唯一外部請求工作，blog 無直接供應商 endpoint 或 mkdir 鎖。本階段未改 tag／youtube 程式、服務或資料表。

## 測試、審查與正式驗證

- Vitest 107 項／9 檔、根與 web TypeScript、Biome、Next production build 通過；Biome 僅有上游設定的 deprecated informational notice。
- blog DB 備份已於臨時 MariaDB 還原：135 blogs、88 posts、1030 candidates。新增兩表的 migration 演練與正式套用成功。隔離真 DB 另驗證八筆 mock 提交、重啟去重、advisory lock 互斥／釋放、四個來源證據與快照重播冪等；臨時容器已刪除。
- 非 UI review 節點 Codex 6／Opus 2（3:1）；兩份 Opus 均確認 `claude-opus-5-5`、完整 stop。採納 DNS/socket 釘選、證據白名單、明確 conflict handling、配額持久化、影像子程序 4 秒硬逾時、縮圖後 stats、ICO 尺寸核對與解壓標頭清理。IPv6 實作已正確，保留並補測試。review 原文與累計只放 gitignored `.reviews/`。
- 正式 `/`、`/blogs/`、來源頁、`/traffic/`、`/api/traffic`、`/api/icons`、favicon、`/healthz` 皆 200。OAuth 起始 302、PKCE S256 與精確 callback `https://blog.observe.tw/auth/google/callback` 通過。雙斜線與編碼 slash SSRF 回歸均 400。tag.observe.tw／youtube.observe.tw 皆 200。
- 原生協作瀏覽器有首頁／目錄／來源頁／手機／深色五組並排圖；圖示上線後另留來源页、流量頁深色桌面與淺色手機實照。手機 390 px 無水平溢出，四個圖示正常解碼。比較檔位於 `.reviews/visual/index.html`，不提交原始截圖。

## 回滾與尚待真人驗收

先將獨立服務環境中的 `BLOG_SIMILARWEB_ENABLED` 改為 false 並重啟 blog worker。將 gateway/web/worker/favicon 的 `20-frontend-release.conf` WorkingDirectory 切回已保留的 release，再 daemon-reload 與重啟 blog 三服務；圖示保留 runtime cache，兩張新增表保留作稽核，不刪正式資料。不要切回舊的直接 provider client。停止 favicon timer 可暫停每月更新。

Google 真人授權、登入後追蹤／個人 RSS／OPML 與管理員候選核准仍需使用者本人驗收。131 個缺網址種子需要可信來源補齊，1030 筆候選仍需人工審核；抓取圖示不等於收錄。Similarweb 等待 tag 排程與其剩餘額度，無資料也視為正常結果。
