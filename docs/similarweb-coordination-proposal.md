# Similarweb 跨服務協調方案與已核准契約

方案一已獲使用者核准；tag 的 `898f463` / migration `0035` 提供唯一供應商工作。blog 不直接請求 Similarweb、不持有供應商 cookie、不讀寫 tag DB 或 Redis。舊 provider client、模擬 extension headers、mkdir 鎖已移除。

## traffic API

2026-10-21 起 Similarweb 請求改由獨立的 traffic.observe.tw 送出（tag 只轉送），blog 直接呼叫它。契約、token 與下列規則都沒變。

固定 `http://127.0.0.1:18150/internal/similarweb`，只能本機直連，不轉送 Cookie、CF 或 X-Forwarded-For。認證從 `~/.config/observe-similarweb/blog-token` 讀取 Bearer token，檔案須為本人持有的普通檔案、權限 0600、不是 symlink；密鑰不進日誌、Git 或 review packet。測試可使用獨立注入的 mock token。

- `POST /requests`：`{domain,kind:"traffic"|"similar_sites"}`；202 新排入，200 既有工作，400 不合法，429 當日提交上限。
- `GET /results?domain=…`：來源 `similarweb-extension`、抓取時間、各 kind 的 pending/ok/no-data/blocked、traffic 摘要與 similarSites。只有精確的 `404 not_requested` 可視為尚未提交；認證遮蔽的 404 會停止整輪。
- 請求 10 秒逾時、回應最多 1 MiB、禁止 redirect；回應逐層驗證並重建欄位白名單，不保存不明欄位或 headers。

Similar Sites 並無獨立可用的 `/api/v1/similar-sites` endpoint。資料來自 tag 已取得的 `Competitors.TopSimilarityCompetitors`，多數站可能為空。`no-data`、長時間 pending 均屬正常，不能補寫推測值。

## blog 排程與資料

`BLOG_SIMILARWEB_ENABLED=true` 才啟用；預設 false。worker 的獨立 `blogs-similarweb` job 每小時喚醒，但資料庫限制最早六小時才呼叫 API（避免佇列延遲讓固定六小時 tick 跳成十二小時），不受每週 blogblog.club 工作影響。wrapper 沒有顯式 client 時仍零 I/O。

目前只提交已核准（verified）、URL host 與 canonical host 一致的部落格；不把 1030 筆未審候選整批送出。每網域各 kind 最早 30 天後重新提交，pending/blocked 不重送。blog 本地每天最多 30 次 POST，包含失敗或結果不明的送出；台北時間換日。GET 最早每六小時一次。tag 另限制每輪最多 3 次外部請求、每天 30 次，tag 自身需求優先。

`similarweb_control` 與 `similarweb_domains` 位於獨立 `blog_observe` DB，保存配額、預留提交、下次輪詢、退避與快照。單一專用 MySQL connection 持有 blog 專屬 advisory lock；不在 HTTP 等待期間開 transaction。遇 blocked、401/403/429、認證或契約錯誤整輪停止，至少六小時冷卻，服務重啟不會重設配額。

新的相似站只能進入候選清單，來源 `similarweb-similar-sites`。保存查詢網域、tag 抓取時間、本地發現時間、發現路徑、相似站邊與欄位白名單化的原始 **tag API 回應**（不是未提供的供應商原始 response）。同一快照重播不重複 audit；不同來源網域仍追加各自證據，不覆寫人工審核狀態，不當作權威分類。舊快照不覆蓋較新的資料。

流量頁與來源頁只顯示核准部落格的網域估計、來源和抓取时间；共享平台根網域及多作者共用 host 不當成單一作者的流量。流量不是實際讀者人數，也不是文章品質指標。

## 部署與回滾

先關閉旗標，備份 blog DB 並在無網路的臨時 MariaDB 演練還原與 migration。`0002` 只新增兩張表；MySQL DDL 有 implicit commit，失敗需核對已建立的表，不可假設 transaction 能撤回 DDL。驗證 client、配額、重播、HTTP 契約後才開旗標。

回滾先設 `BLOG_SIMILARWEB_ENABLED=false` 並重啟 blog worker，再切回保留的 blog release。保留新增資料表、候選與稽核，不刪正式資料；不復活舊 provider client。tag 端任何停用或回滾由 tag thread 處理，blog 不修改其程式或排程。

最初評估入口是 tag 的 `app/src/media-traffic/live.ts`、`app/src/jobs/media-traffic-job.ts`、worker 與 gateway。實際已上線的 API 契約以上述 898f463 為準。共用 flock/token bucket 的方案二未採用。
