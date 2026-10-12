# Similarweb 跨服務協調方案

## 決策與目前狀態

**方案一已獲使用者核准：tag 是唯一會向 Similarweb 發出請求的服務，blog 只透過 tag 提交探索需求及讀取結果。** 目前仍等待 tag 端的正式 API／認證與資料契約，尚未接通。blog 這次變更沒有修改 tag 的程式、排程、Redis 或資料庫。

blog 的 `loadConfig().similarWeb.enabled` 固定為 `false`。原先直接請求 Similarweb 的 endpoint、User-Agent／headers、本機 mkdir 鎖與 budget 已刪除，所有舊 `BLOG_SIMILARWEB_*` 環境變數均忽略。即使直接呼叫 `discoverSimilarSites(domain, { enabled: true })`，也只會得到 `awaiting-contract` 與空候選；關閉時為 `disabled`。兩者都是零網路請求、零檔案系統操作，不會占用 tag 的供應商配額，也不會寫入發現結果。

## tag 端待確認與實作範圍

下列是固定參考版本 `afe0a65` 的評估入口，不代表 blog 已修改這些檔案：

- `app/src/media-traffic/live.ts`：維持單一供應商請求入口、快取、保守的全域預算及 401／403／429 退避；先重用既存資料，避免為重疊網域重複請求。
- `app/src/jobs/media-traffic-job.ts`：評估如何將 blog 獨有網域的需求排入既有工作、去重與限制批量，並維持 tag 既有流量更新優先順序。
- `app/src/worker.ts`：評估既有 `MEDIA_TRAFFIC_CRON`（每小時 `:35`）與工作排程的整合。不得另開一組無協調的供應商請求。
- tag gateway 與資料保存模組：提供探索需求提交、快取結果讀取及來源／時間資訊。實際路由、認證方式、資料表與檔案位置由 tag 端契約決定，blog 不預先假設。

啟用前需取得：服務位址與路由、認證及授權範圍、允許的網域／輸入格式、請求去重規則、同步或非同步回應模式、快取有效期、結果 schema、來源與時間欄位、配額／退避與重試契約、失敗狀態、觀測指標。密鑰只能放在獨立服務環境，不提交 Git。

## blog 後續接線與驗收

契約明確後，才把 `app/src/crawl/similarweb.ts` 接成 tag client，並由 discovery 保存已驗證的候選、`similarweb-similar-sites` 來源、查詢網域、抓取時間及相似站關係 evidence。結果不是權威分類，未經審核不直接公開收錄。目前沒有可啟用的 adapter，也不接受測試注入的成功資料寫入正式候選。

驗收需證明：重疊網域命中 tag 快取、不額外打供應商；blog 新需求受同一個全域配額和退避控制；401／403／429 不會被 blog 繞過重試；錯誤或不完整結果不寫候選；blog 不會讀寫 tag 私有資料表、共用 session 或佇列 namespace。部署後仍須確認 blog `/healthz` 與 tag／youtube 正式站正常。

## 風險與回滾

主要風險是共用對外 IP 配額互相消耗、供應商封鎖中斷 tag 流量更新、額外工作造成 CPU／網路尖峰、錯誤來源或過期結果被誤當成分類。由 tag 維持唯一供應商入口，並在接線前驗證契約與退避行為，才能降低這些風險。

未來接線版本的回滾順序：先停用 blog 對 tag 的探索需求，再移除或停用 tag 新增的 blog 工作／API，保留已寫入的候選與 provenance；不得重設 tag 既有流量資料。blog 可回復目前的零 I/O placeholder，不能復活舊的直接 provider client。

第二方案（兩個服務共同使用 `flock` 與主機級 token bucket）未採用，不在本次實作範圍。沒有另建本機鎖、補抓排程或獨立供應商 budget。
