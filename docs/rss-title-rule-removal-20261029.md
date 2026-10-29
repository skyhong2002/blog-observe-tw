# 2026-10-29：取消 RSS 名稱比對

使用者明確要求 RSS 與網站名稱不符不影響收錄。本批以 fetched
`origin/main@f31d9f465e41115752fffda65d4c542d08581993` 為基底，提交
`ec460c9e2e2363076a4eb9a6aaea4853bfb367c3`，政策更新為
`personal-rss-publication-v7-no-feed-title-gate`。

- 刪除驗證器與准入 writer 的 RSS／Atom title 比對，不論訂閱來源是否由首頁宣告。
- RSS／Atom title 空白時，仍可由實際 item／entry 識別有效 feed，不再因缺少名稱而跳過。
- 保留 publication 網址歸屬、文章範圍、有效文章、留言 feed 排除、SSRF 防護與人工決定。
- 首頁本身與 sitemap 的身分核對仍保留；沒有取消這些不同的規則。
- 政策版本更新使舊候選排入重審；舊的 `feed_name_identity_mismatch` 是歷史檢查結果。

64 項候選驗證、准入、批次及 seed source 測試通過；TypeScript、變更檔案 Biome、
正式 Next standalone 建置與配對驗證通過。新增回歸案例包含未由首頁宣告、名稱不同、
空白 title 的同 publication feed；跨站來源仍未通過。

## 正式部署

green／generation **111**，BUILD_ID `Y_BsqhxaXliCeUa_ZQAVj`，應用 ec460c9。
藍槽 1056514 保持運作供回滾。依序 archive、同 lockfile 依賴副本、低優先建置、
record-built、prepare-built green、switch green；未在 receipt 後修改或重建產物。
編譯 rewrites 指向 18175，網站介面與公開 origin 沿用既有設定。
本批沒有 schema migration，沒有另外建立資料備份或反向資料處置。

只停止待替換的舊 green 與唯一 worker，正式流量由 blue 持續處理。
worker 新增 `zzzz-no-rss-title-ec460c9.conf`，WorkingDirectory／NODE_PATH 指向
同 ec460c9 release，沿用 weblog origin；同 release Sharp smoke 通過。
公網驗證後才啟動唯一 worker，保留舊 drop-ins。

公網首頁、待查清單、我的網站、Hawks API 與 healthz 回新版／gen111；
HTML／API no-store、CF DYNAMIC、無 Age，私有 API 未登入 401。
OAuth 起始仍為 S256 與 weblog.tw callback，舊 Host 308、tag／youtube 200。
未建立 production 測試帳號、認領、推薦或臨時登入 session。

優先重查 10 筆舊 RSS 名稱不符候選，全部以 v7 保存新結果：1 筆關聯既有 Kalan 部落格，
9 筆下一個卡關原因為個人網站證據不足；沒有再因 RSS 名稱被擋。
這 10 筆候選不代表 10 個獨立新網站，也沒有直接把其他檢查未通過的站點改為 approved。
後續由新版 worker 持續重審。

私人建置、審查與公網驗證紀錄位於 `.reviews/no-rss-title-deploy/`，不納入 Git。
回滾使用本版工具 `bash tools/deploy-blue-green.sh rollback blue`，並停止唯一 worker、
移出本批新增的 `zzzz-no-rss-title-ec460c9.conf` 後 daemon-reload／start；
不刪除已完成審查的資料。回滾程式會恢復舊政策，僅供故障恢復使用。
