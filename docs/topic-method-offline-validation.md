# 話題方法說明：離線原始碼驗證

基底 `95e6ff5` 已包含 `8afc698` 的話題頁修正：方法、上游窗口、品質與容量說明集中於「本頁的資料來源與計算方式」，預設收合；文章／歷史文章的 DOM 順序在說明之前，必要來源及確認狀態保留。尚未建置或部署本項修正。

本批由 **claude-opus-5-5** 新增 `web/test/topic-method-render.spec.tsx`、`vitest.topic-ui.config.ts` 與 `test:topic-ui` script。實作原始 log：`/home/deck/.t3/projects/blog-observe-tw/.reviews/topic-method-unit/opus.jsonl`；回應 model 為 claude-opus-5-5、result success、is_error=false，沒有安裝套件或執行建置。

實際執行 `vitest run --config vitest.topic-ui.config.ts --maxWorkers=1`：**25 tests 通過**（UTC 2026-10-12T23:07:48Z 起）。`tsc -p web/tsconfig.json --noEmit --incremental false` 通過；Biome 先指出格式差異，格式化後檢查。Vitest 設定關閉磁碟 cache。

測試使用真正 React server render 與 DOM 斷言，涵蓋正常、歷史、空資料、pending/error/missing/gone、framework error/404、非話題頁 footer；驗證只有一個 method details、預設無 open、長文在 details 內、內容順序與歷史確認標示。Next hooks、links/images、資料 hook 及 layout wrapper 有替身，並非完整 Next 整合測試。

獨立 **GPT-6.1 Sol** source review（與作者不同）沒有 blocking finding。原始 findings：`/home/deck/.t3/userdata/ui-review-blog-20261013/topic-method-ssr-source-review-20261013/findings.json`，內含 model receipt、原始 transcript 行號、UTC 與各檔 SHA-256。

採納 reviewer 的驗收限制：不能把 DOM 順序叫作手機首屏通過；不能聲稱涵蓋真正 layout/hydration、no-store、prefetch、隱私、所有詞彙狀態。excludedReason 與未知版本尚未有專屬 fixture。390px 實際版面、深色、觸控與鍵盤開合、完整 error/404 路由仍待解凍後 candidate 截圖獨立 review。本批不變更 ledger 為 pass，也不新增 capture。
