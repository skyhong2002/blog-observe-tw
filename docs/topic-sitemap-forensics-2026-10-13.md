# 話題 sitemap 與空白頁鑑識（2026-10-13）

本報告記錄唯讀查核，不是已實作的修正。查核基底為 `f6bd9191cae318c5bfb9c63e0b213fb6b8b3905f`，舊查詢取自 `d6fd44a35da4ac92052e04bff670c6c161e50b3d`。文中時間除另註外一律 UTC；加八小時即台北時間。

## 結論與證據界線

可讀網址／純標點排除這次程式變更，在**同一筆正式資料庫一致性快照**中，舊 sitemap SQL 得 3,178 個話題，新 SQL 與 registry 得 3,177 個；唯一差異是名稱 `""` 的純標點話題。registry 缺漏為零，沒有加入「至少三篇／兩站」等薄頁門檻。

歷史 4,012 → 3,176 的 836 筆差額不能全歸因於此一筆程式排除。查到兩項獨立、具體的資料生命週期問題：滾動 24 小時來源窗口使詞條退出目前快照；文章內容已變而比對預算耗盡，使有效 evidence 暫時消失。另有詞條退出後重入，但舊文章命中未恢復的問題。下面以保留的兩代快照量化這些原因；**這是現時資料的反事實對照，不是假稱重建當時 836 個 URL。**

完整歷史 4,012 筆 XML／URL cohort 沒有保存在找到的審查紀錄中。舊工具抓過整份 XML，但輸出只保存統計與八個樣本，因此仍無法提供「當時每個被移除 URL」的確切清單。

## 方法與限制

- 正式 DB 僅使用 `REPEATABLE READ`、`START TRANSACTION WITH CONSISTENT SNAPSHOT`、`TRANSACTION READ ONLY`。同一組對照使用同一條連線、同一交易與相同 90 天時間界線。
- 查詢設 40 秒上限；詞集合最多 10,000 筆；registry 分批讀取。不寫正式資料、預算、快照指標、索引或服務設定。
- 公開 HTTP 查核是循序且節流的 GET，無 Cookie／Authorization；未掃描全部數千個 URL。
- 未讀取或還原約 632 MB 的 15:35 備份；它本身也晚於 14:59 的歷史觀測，不能直接等同該時 XML。
- 正式 worker 在稽核期間繼續更新，所以不同交易／HTTP 段落有各自時間與 snapshot ID，不能交叉當成同一資料快照。
- `topic_post_indexes_v3` 與 `topic_matches_v3` 保留舊代索引，但 `posts`／正文是目前內容。舊代索引對目前內容的反事實查詢，不等於當時 HTTP 輸出。

## 歷史紀錄存了什麼

| 紀錄 | 時間 | 可證實內容 |
| --- | --- | --- |
| `topic-evidence.json` | 2026-10-12 14:59:22 | 舊正式版 sitemap 4,012 筆；統計與八個樣本，沒有完整 URL 清單 |
| `sitemap-get-head-production.json` | 舊 SEO 審查 | GET／HEAD 200、4,012 筆、670,111 bytes；沒有完整 XML |
| `readable-resume-preview.json` | 2026-10-12 17:08:16 | 可讀網址版本 3,176 筆；只保存三個 URL 範例 |
| 本次正式 HTTP | 2026-10-12 17:17 起 | sitemap 3,177 筆；與稍早 3,176 不同，資料仍在更新 |

舊報告 `docs/seo-audit-2026-10-12.md` 還指出：XML 與獨立 SQL 不是同一交易，查 SQL 時已有七個 XML 話題沒有 90 天 evidence。這再次說明不能以不同時刻的計數倒推出逐筆原因。

## 同資料、不同程式的精確比較

時間：2026-10-12 17:16:31；current snapshot：`579af26c-8f78-4214-b3dd-1813bc953eb6`。

| 步驟 | 話題數 |
| --- | ---: |
| d6 舊 sitemap evidence SQL | 3,178 |
| f6 新 evidence SQL | 3,177 |
| f6 加 registry canonical URL | 3,177 |
| 純標點排除 | 1 |
| registry 缺漏／無效 key | 0 |
| 其他新增排除條件 | 0 |

唯一移除項：`tag:12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126`，label `""`，原本有五篇／一站；舊 URL 現在是實際 HTTP 404，並有 noindex。

程式比對也確認 `body.ts`、`frequency.ts` 不變，`POLICY_VERSION`／`MATCHER_VERSION` 相同；evidence SQL 只多了 `publicationLabelSql(t.label)`。sitemap 仍沿用 90 天內至少一筆有效 evidence，沒有三篇／兩站門檻。一般單篇或單站頁的 robots 政策未改。

## 來源快照的變化

在 2026-10-12 17:22:32 的同一交易讀取兩代保存資料：

| 項目 | 舊 47ca | 新 579a |
| --- | --- | --- |
| ID | `47ca1d4a-b674-4e58-9752-908e7cc07570` | `579af26c-8f78-4214-b3dd-1813bc953eb6` |
| coverage | observed-article-window | observed-article-window |
| 上游窗口 | 10/11 08:23 → 10/12 08:23 | 10/11 17:07 → 10/12 17:07 |
| raw terms | 21,573 | 24,116 |
| canonical terms | 21,495 | 24,008 |
| active terms | 21,086 | 23,569 |
| low-frequency／memory-budget 排除 | 0／0 | 0／0 |
| 估算記憶體 | 71,885,824 bytes | 81,535,488 bytes |

兩代共有 16,780 詞，舊代獨有 4,715 詞，新代獨有 7,228 詞。共有詞的 exclusion／inactive 狀態沒有改變。兩代都沒有碰到 50,000 詞／150,000 codepoints／96 MiB 容量上限。

因此**詞庫總數增加，不代表舊詞都留下**。目前來源是一天的滾動文章窗口，不是上游完整標籤池；較早一段窗口內出現、之後沒有再出現的詞會退出 current snapshot。這不等於上游正式刪詞或認定它是雜訊。

以相同現存文章、相同 90 天範圍與舊版規則各查一代：

| 比較 | 數量 |
| --- | ---: |
| 舊代有效話題 | 3,639 |
| 新代有效話題（尚未加純標點排除） | 3,178 |
| 舊有而新無 | 465 |
| 其中：新來源快照已無該詞 | 453 |
| 其中：詞仍 active，但新代無命中 | 12 |
| 新有而舊無 | 4 |

驗算：`3,639 − 453 − 12 + 4 = 3,178`。用原歷史 14:59 的 90 天時間界線，仍在這份**目前內容**上重算，兩代結果相同；這數小時的日期界線滑動不是這組差異的原因。

## 正文更新、預算耗盡與 freshness

2026-10-12 17:23:53 的一致性交易，兩代 90 天內 verified 文章索引狀態完全相同：

| `status=ok` 的 freshness | 文章數 |
| --- | ---: |
| post／body hash 都相符 | 1,773 |
| 只有 body hash 已變 | 212 |
| 只有 post hash 已變 | 209 |
| 兩種 hash 都已變 | 193 |

共 614 篇 ok 索引需要重比對。兩代最後 matched_at 都停在 14:42:33。17:26 唯讀查到 UTC 10/12 `topics:post-match` 已於 14:42:33 用滿 10,000；`topics:maintenance-match` 為 4,232／5,000。本次沒有重設或增加任何預算。

為量化影響，僅在**診斷 SELECT**暫撤 post／body hash freshness 條件，舊代集合為 4,059。這包含目前已不應公開使用的過期命中，**不是建議略過 freshness**。

| 從舊代保留命中集合到目前新代有效集合 | 數量 |
| --- | ---: |
| 舊代暫撤 freshness 的診斷集合 | 4,059 |
| 新來源快照已無該詞 | −520 |
| 新代有保留命中，但內容 hash 已變，所有命中均失效 | −353 |
| 詞退出後重入，新代沒有命中 | −12 |
| 頻率重算新增可見話題 | +4 |
| 新代舊 SQL 集合 | 3,178 |
| 純標點 `""` | −1 |
| 新 sitemap 集合 | 3,177 |

以上各分類互斥，順序是先判斷新代是否還有詞，再檢查 freshness／命中。不能把這張表中的 353 或 520 直接貼成歷史 836 的分項，因為起始集合是 4,059，並非保存下來的 4,012 XML。

四個新增可見話題是「商品、粉絲、店家、大量」，皆為既存詞；新版頻率基準重算後 `high_frequency` 從 1 變成 0，正文命中重新可見。頻率演算法及 2% 門檻本身未改；這次對照沒有因高頻規則而額外退出的話題。

## 重入詞的命中遺失

十二個詞都有相同軌跡：舊代有命中 → 某個中間窗口不含該詞 → 後續來源再次含該詞，但新代命中為零。

- 預告片、Inside、Double、文創、拍照、Leo、Circle、Below、世界紀錄、美國海軍、陳鏞基、味全。
- 例如「拍照」舊代 68 筆 title/body match；14:16 的中間代無此詞；15:37 重入後為零，至 579a 仍為零。
- 「Inside」舊代 13 筆；16:22 的中間代無此詞；16:37 重入後為零。

`index-carry.ts` 只從上一代複製仍 active 的命中，因此中間代已丟失的 match 不會憑 registry 恢復。新增詞只標記最近 48 小時文章重比對，未涵蓋所有較早仍在 90 天 sitemap 範圍的文章；本日一般比對預算也已耗盡。這是需要修正的資料生命週期問題，不能以改掉薄頁門檻來掩蓋。

## 舊 URL 的實際 HTTP 行為

| 類別／樣本 | 舊 hashed URL → 結果 | 內容 |
| --- | --- | --- |
| 純標點 `""` | 404 | noindex、無文章 |
| 新快照缺詞：貢寮區、YT、財務自由 | 404 | registry 仍存在，但 current canonical 不存在 |
| 仍有 evidence：00406A、財氣、xStocks、貢寮 | 301 → 200 | 對應 canonical 頁有原文連結 |
| 重入漏配：預告片、Inside、拍照 | 301 → 200 | 空文章列表；公開 90 天 API 也為零 |
| hash stale：產能、剪刀 | 301 → 200 | 空文章列表；公開 90 天 API 也為零 |

後兩類於 17:24–17:26 抽查，當時 current 已前進到 `be4b67b8-64c4-402a-bc3a-a82b98052571`。HTML 沒有 noindex，正文顯示「此期間尚無已比對文章」，零個原文連結；公開 API `?days=90` 也回 `articles:[]`、`blogs:[]`。因此它們是**已重現的 200 空白內容問題**，不是只因預設 30 天比 sitemap 90 天短。

沒有觀測到 410。對完全沒有目前有效內容的舊 URL，應另修復內容／路由狀態語義；不得順勢把單篇、一站、低頻但仍有內容的頁面判成薄頁或加新 noindex 門檻。

## 「資訊安全」與 20 個 sitemap 話題抽查

使用者回報「資訊安全」30／90 天都空。本次未重現兩個期間皆空；實際結果是 **30 天零篇、90 天一篇**。

- registry canonical key `資訊安全` 對應 `tag:0007a8e4ac46ea23807630a1c90b8cbc9a65fea91e963298298edae989cda47f`，與舊 API ID 完全一致，沒有 readable key／stable ID 錯配。
- 正式 API `?days=90` 回一篇；page metadata `windowDays:90, posts:1` 相符。
- 主代理用 T3 真瀏覽器驗證直接開 90 天，以及由 30 天點到 90 天都成功顯示文章：坭喃貓的 BitoPro 幣託相關文章，日期台北 2026/7/17 15:06。JS assets 與該 stable ID 的 days=90 API 均 200。
- ISR 原始 HTML 固定是 30 天 baseline；非 30 天是 hydration 後的 client request。故只讀 `?days=90` 原始 HTML 不能作為「90 天無文章」的證據。

17:27:33–17:29:18 從正式 sitemap 取「資訊安全＋等距十九筆」作可重現抽樣（不是隨機統計估計）：

| 指標 | 結果 |
| --- | ---: |
| 30 天 articles=0 | 5／20 |
| 90 天 articles=0 | 0／20 |
| page 的 90 天 posts>0、API 90 天卻零篇 | 0／20 |
| stable ID／canonical ID 不一致 | 0／20 |

五個 30 天零篇樣本為資訊安全、自營商、抗議、病患、詐欺；它們都有 90 天內容。17:30:45 再以同一唯讀一致性交易、同一 current snapshot，把二十個 ID 各跑 d6 舊 SQL／f6 新 SQL，30／90 天的文章及部落格數**全部一致**。因此這二十筆沒有「可讀網址改版把原本相同 ID 的文章藏起來」的證據。

## 後續修正方向（尚未在本稽核中實作）

1. 明確區分觀測窗口暫時未見詞與完整來源詞庫的刪詞；避免來源窗口移動就讓穩定公開 URL 失效。未部署的完整快照不能假定已可用。
2. 對重新加入的詞建立可續跑的 90 天 evidence 回補／恢復機制，並保持相同 freshness、noise、verified scope，不能直接放回過期 match。
3. 在每日預算內安排 hash 變更與新文章的合理優先序；公開 coverage 應能呈現待比對及預算延後，不把缺 evidence 當成詞本身失效。
4. 處理完全沒有有效內容時的 HTML 狀態與舊 URL 行為；與「有一篇／一站但不夠多」分開，維持既有薄頁政策。
5. 每次部署／快照切換保存 bounded sitemap URL cohort、snapshot ID、時間與查詢版本。保留原始 XML 或 URL hash 清單，才可對未來增減逐筆稽核。

## 可重跑證據

原始小型 evidence／唯讀腳本放在 worktree 的 gitignored `.reviews/perf/`，不納入 Git；不含金鑰或連線設定：

- `topic-sitemap-same-snapshot.json`：同資料新舊 SQL 與完整當時 cohort。
- `topic-snapshot-forensics.json`：兩代 manifest／selection／頻率／索引統計與集合差。
- `topic-snapshot-carry-forensics.json`：中間代重入詞歷程、hash freshness、反事實分類。
- `topic-budget-frequency.json`：預算耗盡時間、四詞 frequency 變化。
- `topic-sitemap-http.json`、`topic-snapshot-http.json`、`topic-api-samples.json`：HTTP 鏈與空白頁抽查。
- `topic-twenty-audit.json`、`topic-twenty-sql.json`：二十筆正式 API 與同資料新舊 SQL。
- 真瀏覽器畫面由主代理保存：`/home/deck/.t3/userdata/browser-artifacts/browser-screenshot-blog-observe-tw-mv5j1vgh-95a40650.png`。
