# no-store 模式的導覽預取與手機可用性修正

基底：fetch 後的 `origin/main` `56bc118`。前端實作由獨立 `claude-opus-5-5` instance 完成（回應 model/finish 已核對）；Codex 執行自動排版、測試與整合。實作紀錄：`.reviews/ui-fixes/opus-implementation.jsonl`。writer 的說明不是獨立 review。

## 可重現問題與變更

- 真實首頁58次請求中25次為 Next 自動 RSC 預取，14次 favicon 均200。當公開頁為 no-store 時，每次預取都會重新SSR，多個瀏覽session共用IP配額後造成429，重查詢也可能超時500。所有原有Next Link改用同一個NoPrefetchLink，強制prefetch=false，仍保留點擊client導航。私人RSS/OPML由原生a下載，不進RSC。沒有放寬限流、恢復快取或變更analytics guard。
- 手機文章頁原本自動展開頁首搜尋，與logo、主題、登入、選單相擠。文章頁本已有搜尋表单，因此頁首維持搜尋icon，使用者點擊時才展開，與tag既有互動一致。
- API status 是兩欄純文字說明表，採tag既有table-stack手機堆疊例外；完整端點及用途可讀。其他資料表仍維持單行／sticky規格。
- gateway的匿名reader helper已送401時，五個handler明確return reply；測試用延遲onSend hook覆蓋RSS RSC預取，避免重複send警告。

## 驗證與公開門檻

172個前端測試、34個cache/reader回應測試、前後端TypeScript通過。之後仍須正式build與candidate實際桌機1280／手機390獨立review；未完成前不把UI issue標成fixed或pass。不得以共用component code review替代各頁review。

瀏覽器最多2個，DNT=1，啟動前封鎖GA/GTM transport，保留webdriver/opt-out等guard。每頁加間隔，以candidate為主；每批前後記錄uptime與正式首頁TTFB。負載超過12或TTFB超過2秒暫停review，不以反覆重試或放寬配額掩蓋問題。無合法admin session的頁面維持pending，不建立帳號/權限。

本批沒有F4公開路由、schema migration或採集增加。技術偵測模組仍為未公開工作，與此止血修正分開發版。
