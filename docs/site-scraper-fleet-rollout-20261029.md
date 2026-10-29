# 逐站抓取器部署紀錄 — 2026-10-29

Runtime release: `2b252768361bcdbf89491b55b3cc0cc8a261a3ab`，green／edge generation 115，https://weblog.tw/。
逐站定義修正提交：`80e9ec3d650f3ccbd07427be82467dbc445156f5`（Yomo 正文 selector）。解析插件依驗證證據寫入 DB，無須重建 runtime。
前版 blue `e1025ed190c6a8b389ca54d901cd66f02dca0fdc` 及其 worker 設定保留。

## 逐站結果

10 個 GPT 6.1 Sol agents 分工原本沒有專用抓取器的 359 個名錄入口。

- 355 份定義，其中 312 份實頁驗證通過；43 份保留失敗／無文章原因，另 4 站無法取得足以撰寫解析器的公開頁面。
- 新增啟用 **306** 支抓取器，306 個不同 blogId，全部有精確定義雜湊、`gpt-6.1-sol` 與 `operator-agent-authored` 來源證據；無同站重複 active，1 支需要渲染。
- 6 個重複入口沿用目標站：450→625、636→568、643→475、657→693、659→523、669→580。來源網站、候選、網址及歷史文章未合併或刪除；來源450的49篇歷史文章保留。
- 622 依主站明示、且具雙向連結的部落格入口更新為 `blog.ttheng.com`，保留作者首頁別名及原名錄證據。
- 47 站目前無法啟用：HTTP403 10、HTTP404 11、DNS9、逾時5、連線失敗3、沒有作者文章4、作者入口不明2、驗證頁／publication界線2、渲染後無可讀文章1。不繞過403或驗證頁、不猜測作者或捏造正文。

344／397 個既有名錄 blog records 有啟用抓取器；全部344個已有文章。其餘53個包含47個上述阻礙及6個保留的重複入口。收錄資格不因文章抓取失敗而撤銷。

## 實際補抓

首次選中的31個無文章網站全部成功，共寫入258篇；三個方格子沙龍分別取得2、10、10篇，22篇內文均為 `ok`。

最後檢查另找出既有scraper63的搬站問題：`blog.qian30.net` 安全HTTP重新導向 `blog.chien.dev`，抓取器已使用新網址、blog首頁卻仍是舊網址，publication界線因此排除全部文章。核對目標無其他擁有者、無拒收／人工決定，且保留既有程式原封不動通過17篇列表／3篇正文驗證後，只更新blog576的canonical、保留舊址redirect別名與稽核，成功補進10篇。

本輪直接補抓合計 **32站／268篇**。快照 2026-10-29T10:18:24.616Z：397個名錄blog records中，347個有文章，50個仍無文章；新抓取器全部已有文章。這是當下數量，日常排程繼續執行。

## 驗證與操作證據

- 155個後端測試檔案、1550項測試全數通過；另125項針對測試通過。最初併行執行遇到一次沙箱逾時，單獨重跑及最後完整單worker套件均通過，未放寬沙箱限制。
- TypeScript、變更程式Biome、Git diff檢查通過。隔離18169資料庫套件經36個migrations，驗證安裝冪等、保留既有active、stale proof不寫入、audit失敗整筆回滾及來源證據保存。
- 最後驗證器對56份短文／照片／方格子定義重新實頁驗證。Yomo縮小正文selector；其他逾時項目逐站重跑後通過。少於200字元的文字及所有輸出照片均須源自原頁。
- 新release由同一Git archive、乾淨root/web `npm ci`及同次Next build建立，原始檔與standalone一致；先record-built／prepare-built，通過預熱後切換，未重建已記錄產物。
- 部署前磁碟守門先擋下操作，公開流量未變。依既有保留政策在部署鎖內重查引用，移除未被使用的舊45f274c release與其receipt，保留正式／回滾／候選與部署基礎程式後重試。
- 公開首頁、queue、內容API、私人路徑狀態、healthz、OAuth S256 callback檢查通過；release／generation相符，HTML／API維持no-store、Cloudflare非HIT。單一worker已切到同release，NODE_PATH及原生sharp檢查通過，無重啟循環；原旗標保留。
- 搬站後的舊qian30候選仍顯示已收錄、10篇文章；hawks.tw仍已收錄、30篇文章。

私人證據：`.reviews/scraper-fleet/`，包含backup、canonical reviews／audits、逐站定義綁定報告、install-applied、installed-integrity、crawl-installed-results、576-after-canonical、public-after、worker-verified與CSV。

完整397站CSV：`.reviews/scraper-fleet/all-sites-final.csv`；359個原待處理入口及目標映射：`sites-final.csv`。資料庫備份已在批次安裝與canonical變更前完成；此次沒有schema變更。

回滾須透過既有部署工具驗證保留的blue，再同步交還唯一worker至對應release／NODE_PATH，保留插件與新文章資料。舊runtime尚不支援本次方格子跨路徑歸屬證據，回滾後這三站的後續更新會受限；不宣稱回滾會保留新功能。
