# 累積話題與歷史文章

話題頁只由 blog 自己的文章比對證據建立。tag 的完整詞庫或近期文章窗口都是「可用來比對的詞」，不是可索引頁面清單；匯入成功也不等於話題內容修復完成。

`topic_pages` 與 `topic_article_evidence` 保存 canonical ID、文章 ID、標題／正文來源、matcher version、首次／最近命中時間、文章與正文雜湊。公開母體要求至少一篇仍存在、所屬部落格仍公開的非撤銷證據。沒有 3 篇／2 站等薄頁門檻。

詞退出同步窗口不撤銷觀測。內容雜湊改變先標 pending 並清楚顯示；背景在既有每日維護預算內重驗。缺正文或截斷不能當陰性證據。完整重驗後確定不再命中、文章刪除或明確雜訊才撤銷。暫時隱藏站點回 404/no-store，可以恢復；證據全被撤銷回 410；合併直接 301 最終網址。既有公開 slug 不重新生成。

30／90 天沒有可確認的新文章時，SSR 顯示歷史文章、命中日期與待確認狀態。話題細頁與資料讀取不跨請求快取，以免其中一站隱藏後仍顯示舊文章；首頁、列表的既有 ISR 保留。歷史分頁 cursor 綁定 canonical ID。Sitemap 使用累積集合，lastmod 取最後文章發布日期；XML 快取仍最多 300 秒並允許 600 秒 stale-while-revalidate，頁面入口會即時檢查公開證據。

## 啟用與回滾

1. 執行單元、型別、web 與隔離 `18169` 整合測試。
2. 確認 `/home` 至少 10 GiB；migration `0019` 只新增三表與索引，沿用既有備份，不新建完整備份。
3. 先執行 `tools/backfill-topic-history.ts --enabled`，每交易最多 500 筆、每輪最長 30 秒，快照 keyset checkpoint 可續跑。同一 topics job lease 防止同步與回填競爭。
4. `BLOG_TOPIC_HISTORY_WRITE_ENABLED=true` 啟用新命中雙寫、五分鐘小批回填／重驗；尚未捕捉完的 published/retiring 快照暫停 GC。先開 write，再完成讀取驗收。
5. `tools/revalidate-topic-history.ts --enabled` 沿用每天 5,000 篇 maintenance 配額，不重設預算。不發出外站請求。
6. `BLOG_TOPIC_HISTORY_READ_ENABLED=true` 切換頁面、API、sitemap。先在隔離新版 gateway/web 驗證，才切流量。部署方式見 [blue/green](blue-green-deployment.md)。回滾可關閉 read，保留資料與 write；舊版程式忽略新增表。

歷史回填僅能恢復仍留存的合格比對版本；已被舊 GC 刪除的資料不能捏造。`retiring` checkpoint 註明 retained-evidence-only。後续須從實際文章重新比對補齊。

## 驗收

`node --env-file=<private config> tools/audit-topic-history.ts` 只讀彙總：累積數、30/90 天零篇數、固定種子的隨機 20 筆網址／ID／證據／版本、至少三個歷史 fallback 與拍照／Inside／預告片。完整報告需另驗證正式 HTTP 與 SSR 或瀏覽器畫面；不能只看 migration、import 或單元測試就宣称修復完成。
