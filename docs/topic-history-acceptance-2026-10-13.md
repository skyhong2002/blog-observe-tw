# 累積話題正式驗收（2026-10-13）

> 下列18:43–18:45 UTC資料為歷史紀錄，產生時正式站仍是blue `a45b06a`、generation2；工具所在worktree HEAD為`fc6b5a9`。兩份舊artifact沒有記錄release SHA，其中HTTP檔僅含status/canonical，**不能當作現行42711cf的驗收**。舊檔保留；新驗收另存新路徑。

## 現行驗收摘要

以正式版 `42711cf`、UTC **2026-10-12T21:05:23.000Z** 的重驗為準：累積可公開話題 **4,769** 個，近 30 天與近 90 天皆無目前確認文章 **838** 個，缺少可讀網址 **0** 個。統計是**依序執行的唯讀 SELECT，不是同一個交易快照**；worker 可在查詢之間更新資料。完整 SHA、BUILD_ID、固定樣本和原始 artifact 見下方「42711cf 正式版重驗」。

SSR 固定顯示預設 **30 天**及歷史 fallback；client 切換期間才呼叫 **90 天 API**。帶 `?days=90` 的 HTML 並不構成 90 天 SSR 證據；本次兩者分開驗證。B0 的具體條件已補證，可繼續 F3／F4 candidate；這不代表全部 UI 通過。Cloudflare 兩條快取規則維持 Disabled，磁碟凍結解除前不進行大型建置或 artifact。

## 舊資料來源（只留追溯，不作現行摘要）

本報告依固定驗收檔 `/home/deck/.cache/blog-topic-history/.reviews/history/audit-final.json`，資料截至 **2026-10-12T18:43:15.000Z**（台北 2026-10-13 02:43:15）。來源檔 SHA-256：`c0bf9dc24c2f74811c57aa2d047f6c2aa58b3a9dc746f5f237fd3dea13a3449c`。稽核工具為 [`tools/audit-topic-history.ts`](../tools/audit-topic-history.ts)，本次文件整理沒有寫入正式資料庫。

舊 artifact 原始數字保留在上述檔案，文件中的現行母體統一使用 21:05:23 UTC 的 **4,769／838**，不倒填或修改舊 artifact。母體是部落格文章的保留比對證據，**不是 tag 的完整詞庫**。低頻、單篇、單站不因數量少而新增 noindex 門檻。

資料統計是唯讀且循序的 SELECT，worker 同時持續更新，並非全份資料處於同一個隔離交易。下表保留該次紀錄，不把稍後 HTTP 的最新值倒填成同時刻統計。主代理另以正常匿名 HTTP 驗證這二十個舊網址：全部一次 301 到表中可讀網址，最後 200、canonical 指向自己，沒有 noindex；結果保存在 `/home/deck/.cache/blog-topic-history/.reviews/history/final-20-http.json`。

## 保留證據、待確認與近期文章的語義

- **歷史文章**：仍存在、所屬部落格仍可公開、證據未撤銷的不同文章；包括 retained confirmed／pending 與無發布日期文章，不受 30／90 天窗口限制。相同文章的 title/body 命中不重複計數。

- **confirmed 與 pending**：有效狀態由目前文章／正文雜湊及版本判斷；雜湊或版本已變的保留命中屬 pending，不因仍存資料就稱目前確認命中。頁面標示「待重新確認」。原始 storedEvidenceState 和有效 effectiveArticleState 是不同欄位。

- **近期文章**：目前 fresh confirmed、發布日在該 30／90 天 UTC 窗口內的不同公開文章。高頻詞另外只計標題命中；不把 stale／pending 命中補到近期排行。

- 詞退出同步來源窗口不代表舊文章證據被撤銷。明確雜訊、完整重驗不再命中、文章刪除等才撤銷；站點隱藏會立即失去公開資格，不能靠歷史表繼續顯示。

- `observedAt` 是命中被觀測的時間，不是文章發布時間；`latestMatchingArticle.articleId` 對應稽核選出的最新命中證據，不能當作 `latestPublishedAt` 那篇文章的保證。

實作與狀態轉換詳見 [累積話題與歷史文章](durable-topic-history.md)。

## 固定種子抽樣 20 筆

種子為 `blog-topic-history-audit-v1`；排序依 SHA-256(`seed:canonicalId`) 由小至大選前二十筆。同母體、同種子可重現；不是依成果挑選，也不是用二十筆推估全站錯誤率。每列完整保存比對版本。

| 話題 | 新網址 | 舊網址 | 完整 topic ID | 90 天文章 | 歷史文章 | latestMatchingArticle.articleId | matcherVersion | observedAt（UTC） |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |
| 百萬夜景 | [可讀網址](https://blog.observe.tw/topics/%E7%99%BE%E8%90%AC%E5%A4%9C%E6%99%AF/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3Ad6b6fefad2704a355317478b6a569c9c2cac45c67699fede14385ec3538241eb/) | `tag:d6b6fefad2704a355317478b6a569c9c2cac45c67699fede14385ec3538241eb` | 2 | 4 | 576 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T18:11:58.000Z |
| 品牌 | [可讀網址](https://blog.observe.tw/topics/%E5%93%81%E7%89%8C/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3Afb9b835c28eef3bb2d9c107102da853e22ab617741cb7a2cb64974a7c1709659/) | `tag:fb9b835c28eef3bb2d9c107102da853e22ab617741cb7a2cb64974a7c1709659` | 47 | 75 | 4866 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T18:12:31.000Z |
| 原型食物 | [可讀網址](https://blog.observe.tw/topics/%E5%8E%9F%E5%9E%8B%E9%A3%9F%E7%89%A9/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3A971e251a3453ca8dbfc33f7ddb31b95f6dd35bb25a93a789f8386ebc19912a68/) | `tag:971e251a3453ca8dbfc33f7ddb31b95f6dd35bb25a93a789f8386ebc19912a68` | 3 | 5 | 1099 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T18:12:16.000Z |
| 教授 | [可讀網址](https://blog.observe.tw/topics/%E6%95%99%E6%8E%88/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3A456e01f9206141b93706e19df0e064f793e66046e737446dcb6aab1c73fe149e/) | `tag:456e01f9206141b93706e19df0e064f793e66046e737446dcb6aab1c73fe149e` | 4 | 15 | 20255 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T14:42:32.000Z |
| Chinese | [可讀網址](https://blog.observe.tw/topics/chinese/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3Ae2d3b41db9567ddf0334e14b2ff58556581630566061a0c643fec42d12c47122/) | `tag:e2d3b41db9567ddf0334e14b2ff58556581630566061a0c643fec42d12c47122` | 2 | 4 | 3914 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T14:22:33.000Z |
| 調查 | [可讀網址](https://blog.observe.tw/topics/%E8%AA%BF%E6%9F%A5/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3Aee956846f2a2bd0b5a42a4c40825bb425b30a7d9cf2849314ec1f38bf77fbd18/) | `tag:ee956846f2a2bd0b5a42a4c40825bb425b30a7d9cf2849314ec1f38bf77fbd18` | 12 | 27 | 8011 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T18:12:25.000Z |
| 風險管理 | [可讀網址](https://blog.observe.tw/topics/%E9%A2%A8%E9%9A%AA%E7%AE%A1%E7%90%86/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3Afae41b95cd333f5c70e6780449ba98681389e4bf8b279b1cb1fd6e87bff100a1/) | `tag:fae41b95cd333f5c70e6780449ba98681389e4bf8b279b1cb1fd6e87bff100a1` | 0 | 3 | 7161 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T14:11:28.000Z |
| OpenAI | [可讀網址](https://blog.observe.tw/topics/openai/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3A7d3194f79e645c42e4396dda38be04766810ec6a00d00aced3ffc2a0a1f1a9ef/) | `tag:7d3194f79e645c42e4396dda38be04766810ec6a00d00aced3ffc2a0a1f1a9ef` | 3 | 12 | 5603 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T18:12:17.000Z |
| 投信買超 | [可讀網址](https://blog.observe.tw/topics/%E6%8A%95%E4%BF%A1%E8%B2%B7%E8%B6%85/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3A15e271e1574c809af2673e6299b74e5e84bfc4479fa0b738da84e580d8b84a09/) | `tag:15e271e1574c809af2673e6299b74e5e84bfc4479fa0b738da84e580d8b84a09` | 1 | 1 | 17699 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T14:11:13.000Z |
| 說話 | [可讀網址](https://blog.observe.tw/topics/%E8%AA%AA%E8%A9%B1/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3Abac1c7f1038e244d590e913e27bd887de62b7cfed80183f3305e96757200955f/) | `tag:bac1c7f1038e244d590e913e27bd887de62b7cfed80183f3305e96757200955f` | 7 | 22 | 19899 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T14:32:34.000Z |
| Sport | [可讀網址](https://blog.observe.tw/topics/sport/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3Aec450786e26a5154173545c402bcc03b20e2e0477d6086fa632a55c85bdcdd83/) | `tag:ec450786e26a5154173545c402bcc03b20e2e0477d6086fa632a55c85bdcdd83` | 3 | 3 | 1096 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T18:12:15.000Z |
| 柬埔寨 | [可讀網址](https://blog.observe.tw/topics/%E6%9F%AC%E5%9F%94%E5%AF%A8/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3Ae6ff6d750de02e32e92c1b4b8a63d61748801a343481e7f2958eabbbf56e33d0/) | `tag:e6ff6d750de02e32e92c1b4b8a63d61748801a343481e7f2958eabbbf56e33d0` | 1 | 2 | 16770 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T14:22:33.000Z |
| 價格 | [可讀網址](https://blog.observe.tw/topics/%E5%83%B9%E6%A0%BC/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3A82090cdebbcd21713e46c39fadf8daa4fa07110de040c3e4138fd85d7fc3dc1a/) | `tag:82090cdebbcd21713e46c39fadf8daa4fa07110de040c3e4138fd85d7fc3dc1a` | 15 | 20 | 404 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T18:12:17.000Z |
| 劇中 | [可讀網址](https://blog.observe.tw/topics/%E5%8A%87%E4%B8%AD/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3Ac5afd1ec5201e4312c36131678b0916af946b9f702ffc0b38ad91ace70de30d2/) | `tag:c5afd1ec5201e4312c36131678b0916af946b9f702ffc0b38ad91ace70de30d2` | 3 | 5 | 6304 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T14:22:33.000Z |
| 降温 | [可讀網址](https://blog.observe.tw/topics/%E9%99%8D%E6%B8%A9/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3Ab0b7715bce912cab90ddf69ecb7524b6f7b91db303813682245e7dc4a7823074/) | `tag:b0b7715bce912cab90ddf69ecb7524b6f7b91db303813682245e7dc4a7823074` | 1 | 1 | 7006 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T14:11:10.000Z |
| 榴槤 | [可讀網址](https://blog.observe.tw/topics/%E6%A6%B4%E6%A7%A4/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3Adffdafd73e3fa05ae3f4e55eb08a6d64999540aec4f9da6840502fc7b08f3b20/) | `tag:dffdafd73e3fa05ae3f4e55eb08a6d64999540aec4f9da6840502fc7b08f3b20` | 0 | 1 | 799 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T14:11:15.000Z |
| 鋼琴 | [可讀網址](https://blog.observe.tw/topics/%E9%8B%BC%E7%90%B4/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3A25fb722ef596dd29378a87563152ce2f5eded9864bd1f25d8fbdbdad222fce91/) | `tag:25fb722ef596dd29378a87563152ce2f5eded9864bd1f25d8fbdbdad222fce91` | 4 | 18 | 1751 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T14:42:32.000Z |
| 任天堂 | [可讀網址](https://blog.observe.tw/topics/%E4%BB%BB%E5%A4%A9%E5%A0%82/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3Abb40df899e7f2339da013cc683974ab64701eddb0b3e775144f8a6df7ce81aef/) | `tag:bb40df899e7f2339da013cc683974ab64701eddb0b3e775144f8a6df7ce81aef` | 9 | 9 | 12115 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T18:11:50.000Z |
| 疲倦 | [可讀網址](https://blog.observe.tw/topics/%E7%96%B2%E5%80%A6/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3A8267ce8f6030bb9c2db04f719416224f972b5a697fd4d49dc135e91ac5d64c44/) | `tag:8267ce8f6030bb9c2db04f719416224f972b5a697fd4d49dc135e91ac5d64c44` | 3 | 5 | 1099 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T18:12:16.000Z |
| 變胖 | [可讀網址](https://blog.observe.tw/topics/%E8%AE%8A%E8%83%96/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3A4156494bed364b113dac77c3a058edbcc4f3aa809c435306885fce95e449a69f/) | `tag:4156494bed364b113dac77c3a058edbcc4f3aa809c435306885fce95e449a69f` | 2 | 3 | 19908 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T14:32:34.000Z |

## 三個真正位於 90 天外的歷史 fallback

本次 90 天界線為 `2026-07-14T18:43:15Z`。以下三例不只是 `articles90Days=0`：保留證據中 `observedArticles90Days` 也為 0，且最新發布日期均早於界線，因此不是近 90 天內 pending／高頻正文排除造成的假歷史案例。

| 話題 | 新網址 | 舊網址 | 完整 topic ID | 90 天文章 | 歷史文章 | latestMatchingArticle.articleId | matcherVersion | observedAt（UTC） |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |
| 風險管理 | [可讀網址](https://blog.observe.tw/topics/%E9%A2%A8%E9%9A%AA%E7%AE%A1%E7%90%86/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3Afae41b95cd333f5c70e6780449ba98681389e4bf8b279b1cb1fd6e87bff100a1/) | `tag:fae41b95cd333f5c70e6780449ba98681389e4bf8b279b1cb1fd6e87bff100a1` | 0 | 3 | 7161 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T14:11:28.000Z |
| 榴槤 | [可讀網址](https://blog.observe.tw/topics/%E6%A6%B4%E6%A7%A4/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3Adffdafd73e3fa05ae3f4e55eb08a6d64999540aec4f9da6840502fc7b08f3b20/) | `tag:dffdafd73e3fa05ae3f4e55eb08a6d64999540aec4f9da6840502fc7b08f3b20` | 0 | 1 | 799 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T14:11:15.000Z |
| 國際市場 | [可讀網址](https://blog.observe.tw/topics/%E5%9C%8B%E9%9A%9B%E5%B8%82%E5%A0%B4/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3A7807373b255215a68e880de472f0a215da0480ccddd57ed1fdf639fc255968ee/) | `tag:7807373b255215a68e880de472f0a215da0480ccddd57ed1fdf639fc255968ee` | 0 | 2 | 18874 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T14:11:28.000Z |
| 話題 | 30 天／90 天 | 歷史 confirmed／pending | 90 天內保留文章 | 最新發布日期（UTC） |
| --- | ---: | ---: | ---: | --- |
| 風險管理 | 0／0 | 3／0 | 0 | 2025-12-29T14:06:14.000Z |
| 榴槤 | 0／0 | 1／0 | 0 | 2026-06-29T04:31:42.000Z |
| 國際市場 | 0／0 | 2／0 | 0 | 2026-07-08T07:26:14.000Z |

### 正式 SSR 主內容證據

2026-10-12 約 18:44–18:45 UTC 循序取得上述三個正式可讀網址（請求間隔至少 600 ms），解析原始 HTML 的 `<main>`，不執行 JavaScript。三頁均 **HTTP 200**、`Cache-Control: private, no-store`，canonical 等於表列新網址，且 SSR 已有「過去觀測到的文章」區塊。這段 HTTP 核對晚於 18:43:15 的統計快照；以下只摘錄足以辨識歷史內容的公開標題與頁面日期（台北時間），不轉載文章正文。

| 話題 | `<main>` 顯示的數量與提示 | 公開文章標題節錄 | 頁面發布日期（台北） |
| --- | --- | --- | --- |
| [風險管理](https://blog.observe.tw/topics/%E9%A2%A8%E9%9A%AA%E7%AE%A1%E7%90%86/) | 過去觀測到的文章；共 3 篇（已確認 3／待重新確認 0） | 淺談 Salesforce 的 Agentic 成熟度模型 | 2025/12/29 22:06 |
| [榴槤](https://blog.observe.tw/topics/%E6%A6%B4%E6%A7%A4/) | 過去觀測到的文章；共 1 篇（已確認 1／待重新確認 0） | 高雄榴槤市集7/4、5盛大登場…（節錄） | 2026/6/29 12:31 |
| [國際市場](https://blog.observe.tw/topics/%E5%9C%8B%E9%9A%9B%E5%B8%82%E5%A0%B4/) | 過去觀測到的文章；共 2 篇（已確認 2／待重新確認 0） | 徐明星（Star Xu）是誰？從 OKCoin 創辦人到幣圈沉默的推手 | 2026/7/8 15:26 |

三頁預設期間為 30 天，均顯示「近 30 天沒有新的相關文章」，接著列出歷史內容與觀測於 2026/10/12 22:11 的標示；因此不再只有 200 的空白文章列表。90 天也為零由上方稽核資料證實，不以預設 SSR 的 30 天提示代替 90 天驗證。

## 拍照、Inside、預告片

三個指定案例在此驗收快照均為 public=true，有可讀網址及公開文章證據。Inside 的歷史 pending 一篇明列保留，沒有混入五篇近期 fresh 計數。

| 話題 | 新網址 | 舊網址 | 完整 topic ID | 90 天文章 | 歷史文章 | latestMatchingArticle.articleId | matcherVersion | observedAt（UTC） |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- |
| 拍照 | [可讀網址](https://blog.observe.tw/topics/%E6%8B%8D%E7%85%A7/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3A6e3a10ade7c74955ddb8875c3b94adb88aa94cc9ad4b6abe8de082156659c1a6/) | `tag:6e3a10ade7c74955ddb8875c3b94adb88aa94cc9ad4b6abe8de082156659c1a6` | 46 | 66 | 466 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T18:12:22.000Z |
| Inside | [可讀網址](https://blog.observe.tw/topics/inside/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3A106b086224a4d945eae25f7be3805a931a873270326dd868b0e41f71ee9fff72/) | `tag:106b086224a4d945eae25f7be3805a931a873270326dd868b0e41f71ee9fff72` | 5 | 13 | 5498 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T18:12:30.000Z |
| 預告片 | [可讀網址](https://blog.observe.tw/topics/%E9%A0%90%E5%91%8A%E7%89%87/) | [原 ID 網址](https://blog.observe.tw/topics/tag%3A05d182b74585b9ce5066f100b45089e3c555bfc9022778f7ac8e3b5fecc80da1/) | `tag:05d182b74585b9ce5066f100b45089e3c555bfc9022778f7ac8e3b5fecc80da1` | 2 | 3 | 6707 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5` | 2026-10-12T14:11:18.000Z |
| 話題 | 30 天／90 天 | 歷史 confirmed／pending |
| --- | ---: | ---: |
| 拍照 | 40／46 | 66／0 |
| Inside | 2／5 | 12／1 |
| 預告片 | 2／2 | 3／0 |

## 不將本次恢復冒充歷史 836 筆精確對帳

舊紀錄中的 4,012 → 3,176 差額為 836；當時完整 URL cohort 並未留存，因此不能把現行 21:05:23 UTC 的 4,769 個累積話題、838 個近期零篇話題，或本次恢復的例子，硬拆成那 836 筆的互斥原因。先前已做的同資料快照 SQL 對照只證實純標點排除一筆；滾動窗口、正文雜湊 freshness、詞退出再重入是另外已觀測到的資料生命週期問題。

詳見 [話題 sitemap 與空白頁鑑識](topic-sitemap-forensics-2026-10-13.md) 的「結論與證據界線」「同資料、不同程式的精確比較」「重入詞的命中遺失」。本報告驗收的是累積保留、公開可見性與歷史 fallback 的現行行為，不是捏造已遺失的歷史逐 URL 帳本。

## Sitemap 最終檢查

2026-10-12 18:44:56Z 起，index 與三個子檔 GET／HEAD 均 200，Content-Type 都是 `application/xml; charset=utf-8`，無 BOM、XML 宣告前無空白；每項均有 lastmod，沒有舊 tag-hash／discovered-hash 網址。pages **5** 筆、blogs **313** 筆、topics **4,769** 筆。網址仍為 `https://blog.observe.tw/sitemap.xml`，目前安全策略是 no-store。

## 42711cf 正式版重驗（取代前述舊 artifact 作為目前版本證據）

本次統計 UTC **2026-10-12T21:05:23.000Z**；HTTP 驗收結束 **2026-10-12T21:07:44.609Z**。執行前後核對 active blue generation 4、release **`42711cf18c452b406904af6000ccbf88a1ff6102`**、Next BUILD_ID **`GOv8HpPOwOSxlwvjwd6FB`**、Git source tree **`8d8ac1209aa1b7947c8eef714f6e99ba83fecdff`**；gateway 與 web 實際 child process 的 cwd 均指向該 immutable release。這次沒有建置、部署、瀏覽器或正式資料寫入。

- 完整結果：`/home/deck/.t3/projects/blog-observe-tw/.reviews/history-42711cf-20261012T2047/fixed-20-plus-3-http.json`
- 唯讀統計：`/home/deck/.t3/projects/blog-observe-tw/.reviews/history-42711cf-20261012T2047/audit-current.json`
- UTC 負載門檻、SQL 與逐次 HTTP 紀錄：`/home/deck/.t3/projects/blog-observe-tw/.reviews/history-42711cf-20261012T2047/events.jsonl`

累積可公開話題 **4,769**；近 30 與 90 天均無目前可確認文章 **838**；缺少可讀網址 **0**。舊 18:43 與中途 20:44 原始 artifact 均保留，只供歷史追溯；現行摘要統一以本次 21:05:23 UTC 的 4,769／838 為準。這是依序執行的唯讀 SELECT，不是同一個交易快照，也不是固定資料快照的版本差分；未保留舊全母體逐詞狀態，不能將跨時間數量變化擅自歸因為頁面移除、映射錯誤或某一類撤銷。

固定使用舊 artifact 的原二十個 topic ID，另加原三個真正 90 天外的案例；共 23 筆案例、21 個不同話題（風險管理、榴槤重疊），沒有重新挑選抽樣。每筆均舊網址單次 **301 → 新網址 200**、canonical 自指、沒有 noindex，且回應 release 為 42711cf。所有 HTML/API 回應均為 `private, no-store`、Cloudflare `DYNAMIC`。90 天 API 全部未截斷，其近期與歷史計數均與該次 SQL 記錄相符。

HTTP 單一並行、請求間隔 1.2 秒；每次 SQL/HTTP 前要求 1 分鐘 load ≤12，超過時排隊，不開瀏覽器。查詢為循序唯讀而非全程同一個 repeatable-read snapshot。完整版本與觀測時間逐筆保存在 JSON，以下表格摘列同一結果。

| 話題 | 新網址／舊網址 | Topic ID | 90 天／歷史篇數 | 最新命中文章 ID | 比對版本／命中 UTC |
| --- | --- | --- | ---: | ---: | --- |
| 百萬夜景 | [新](https://blog.observe.tw/topics/%E7%99%BE%E8%90%AC%E5%A4%9C%E6%99%AF/)／[舊](https://blog.observe.tw/topics/tag%3Ad6b6fefad2704a355317478b6a569c9c2cac45c67699fede14385ec3538241eb/) | `tag:d6b6fefad2704a355317478b6a569c9c2cac45c67699fede14385ec3538241eb` | 2／4 | 576 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T18:11:58.000Z |
| 品牌 | [新](https://blog.observe.tw/topics/%E5%93%81%E7%89%8C/)／[舊](https://blog.observe.tw/topics/tag%3Afb9b835c28eef3bb2d9c107102da853e22ab617741cb7a2cb64974a7c1709659/) | `tag:fb9b835c28eef3bb2d9c107102da853e22ab617741cb7a2cb64974a7c1709659` | 45／75 | 4866 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T18:12:31.000Z |
| 原型食物 | [新](https://blog.observe.tw/topics/%E5%8E%9F%E5%9E%8B%E9%A3%9F%E7%89%A9/)／[舊](https://blog.observe.tw/topics/tag%3A971e251a3453ca8dbfc33f7ddb31b95f6dd35bb25a93a789f8386ebc19912a68/) | `tag:971e251a3453ca8dbfc33f7ddb31b95f6dd35bb25a93a789f8386ebc19912a68` | 3／5 | 1099 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T18:12:16.000Z |
| 教授 | [新](https://blog.observe.tw/topics/%E6%95%99%E6%8E%88/)／[舊](https://blog.observe.tw/topics/tag%3A456e01f9206141b93706e19df0e064f793e66046e737446dcb6aab1c73fe149e/) | `tag:456e01f9206141b93706e19df0e064f793e66046e737446dcb6aab1c73fe149e` | 4／15 | 20255 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T14:42:32.000Z |
| Chinese | [新](https://blog.observe.tw/topics/chinese/)／[舊](https://blog.observe.tw/topics/tag%3Ae2d3b41db9567ddf0334e14b2ff58556581630566061a0c643fec42d12c47122/) | `tag:e2d3b41db9567ddf0334e14b2ff58556581630566061a0c643fec42d12c47122` | 2／4 | 3914 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T14:22:33.000Z |
| 調查 | [新](https://blog.observe.tw/topics/%E8%AA%BF%E6%9F%A5/)／[舊](https://blog.observe.tw/topics/tag%3Aee956846f2a2bd0b5a42a4c40825bb425b30a7d9cf2849314ec1f38bf77fbd18/) | `tag:ee956846f2a2bd0b5a42a4c40825bb425b30a7d9cf2849314ec1f38bf77fbd18` | 11／27 | 8011 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T18:12:25.000Z |
| 風險管理 | [新](https://blog.observe.tw/topics/%E9%A2%A8%E9%9A%AA%E7%AE%A1%E7%90%86/)／[舊](https://blog.observe.tw/topics/tag%3Afae41b95cd333f5c70e6780449ba98681389e4bf8b279b1cb1fd6e87bff100a1/) | `tag:fae41b95cd333f5c70e6780449ba98681389e4bf8b279b1cb1fd6e87bff100a1` | 0／3 | 7161 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T14:11:28.000Z |
| OpenAI | [新](https://blog.observe.tw/topics/openai/)／[舊](https://blog.observe.tw/topics/tag%3A7d3194f79e645c42e4396dda38be04766810ec6a00d00aced3ffc2a0a1f1a9ef/) | `tag:7d3194f79e645c42e4396dda38be04766810ec6a00d00aced3ffc2a0a1f1a9ef` | 2／12 | 5603 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T18:12:17.000Z |
| 投信買超 | [新](https://blog.observe.tw/topics/%E6%8A%95%E4%BF%A1%E8%B2%B7%E8%B6%85/)／[舊](https://blog.observe.tw/topics/tag%3A15e271e1574c809af2673e6299b74e5e84bfc4479fa0b738da84e580d8b84a09/) | `tag:15e271e1574c809af2673e6299b74e5e84bfc4479fa0b738da84e580d8b84a09` | 1／1 | 17699 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T14:11:13.000Z |
| 說話 | [新](https://blog.observe.tw/topics/%E8%AA%AA%E8%A9%B1/)／[舊](https://blog.observe.tw/topics/tag%3Abac1c7f1038e244d590e913e27bd887de62b7cfed80183f3305e96757200955f/) | `tag:bac1c7f1038e244d590e913e27bd887de62b7cfed80183f3305e96757200955f` | 7／22 | 19899 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T14:32:34.000Z |
| Sport | [新](https://blog.observe.tw/topics/sport/)／[舊](https://blog.observe.tw/topics/tag%3Aec450786e26a5154173545c402bcc03b20e2e0477d6086fa632a55c85bdcdd83/) | `tag:ec450786e26a5154173545c402bcc03b20e2e0477d6086fa632a55c85bdcdd83` | 3／3 | 1096 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T18:12:15.000Z |
| 柬埔寨 | [新](https://blog.observe.tw/topics/%E6%9F%AC%E5%9F%94%E5%AF%A8/)／[舊](https://blog.observe.tw/topics/tag%3Ae6ff6d750de02e32e92c1b4b8a63d61748801a343481e7f2958eabbbf56e33d0/) | `tag:e6ff6d750de02e32e92c1b4b8a63d61748801a343481e7f2958eabbbf56e33d0` | 1／2 | 16770 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T14:22:33.000Z |
| 價格 | [新](https://blog.observe.tw/topics/%E5%83%B9%E6%A0%BC/)／[舊](https://blog.observe.tw/topics/tag%3A82090cdebbcd21713e46c39fadf8daa4fa07110de040c3e4138fd85d7fc3dc1a/) | `tag:82090cdebbcd21713e46c39fadf8daa4fa07110de040c3e4138fd85d7fc3dc1a` | 14／20 | 404 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T18:12:17.000Z |
| 劇中 | [新](https://blog.observe.tw/topics/%E5%8A%87%E4%B8%AD/)／[舊](https://blog.observe.tw/topics/tag%3Ac5afd1ec5201e4312c36131678b0916af946b9f702ffc0b38ad91ace70de30d2/) | `tag:c5afd1ec5201e4312c36131678b0916af946b9f702ffc0b38ad91ace70de30d2` | 3／5 | 6304 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T14:22:33.000Z |
| 降温 | [新](https://blog.observe.tw/topics/%E9%99%8D%E6%B8%A9/)／[舊](https://blog.observe.tw/topics/tag%3Ab0b7715bce912cab90ddf69ecb7524b6f7b91db303813682245e7dc4a7823074/) | `tag:b0b7715bce912cab90ddf69ecb7524b6f7b91db303813682245e7dc4a7823074` | 1／1 | 7006 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T14:11:10.000Z |
| 榴槤 | [新](https://blog.observe.tw/topics/%E6%A6%B4%E6%A7%A4/)／[舊](https://blog.observe.tw/topics/tag%3Adffdafd73e3fa05ae3f4e55eb08a6d64999540aec4f9da6840502fc7b08f3b20/) | `tag:dffdafd73e3fa05ae3f4e55eb08a6d64999540aec4f9da6840502fc7b08f3b20` | 0／1 | 799 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T14:11:15.000Z |
| 鋼琴 | [新](https://blog.observe.tw/topics/%E9%8B%BC%E7%90%B4/)／[舊](https://blog.observe.tw/topics/tag%3A25fb722ef596dd29378a87563152ce2f5eded9864bd1f25d8fbdbdad222fce91/) | `tag:25fb722ef596dd29378a87563152ce2f5eded9864bd1f25d8fbdbdad222fce91` | 4／18 | 1751 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T14:42:32.000Z |
| 任天堂 | [新](https://blog.observe.tw/topics/%E4%BB%BB%E5%A4%A9%E5%A0%82/)／[舊](https://blog.observe.tw/topics/tag%3Abb40df899e7f2339da013cc683974ab64701eddb0b3e775144f8a6df7ce81aef/) | `tag:bb40df899e7f2339da013cc683974ab64701eddb0b3e775144f8a6df7ce81aef` | 8／9 | 12115 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T18:11:50.000Z |
| 疲倦 | [新](https://blog.observe.tw/topics/%E7%96%B2%E5%80%A6/)／[舊](https://blog.observe.tw/topics/tag%3A8267ce8f6030bb9c2db04f719416224f972b5a697fd4d49dc135e91ac5d64c44/) | `tag:8267ce8f6030bb9c2db04f719416224f972b5a697fd4d49dc135e91ac5d64c44` | 3／5 | 1099 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T18:12:16.000Z |
| 變胖 | [新](https://blog.observe.tw/topics/%E8%AE%8A%E8%83%96/)／[舊](https://blog.observe.tw/topics/tag%3A4156494bed364b113dac77c3a058edbcc4f3aa809c435306885fce95e449a69f/) | `tag:4156494bed364b113dac77c3a058edbcc4f3aa809c435306885fce95e449a69f` | 2／3 | 19908 | `topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5`／2026-10-12T14:32:34.000Z |

### 三個歷史 fallback：同一正式版的 SSR 與 90 天 API

目前正式版的 SSR 固定呈現預設 30 天；`?days=90` 的切換由 client 另外查 API。因此本次不把帶 query 的 HTML 說成 90 天 SSR：90 天零篇由該期間 API 與發布日期證據確認，HTML 僅驗證歷史內容已在伺服器輸出。完整 `<main>` 文字保存在每筆 `history90.mainText`。

| 話題 | 90 天／歷史篇數 | 最新發布 UTC | 歷史文章 ID（API） | SSR 實際內容 |
| --- | ---: | --- | --- | --- |
| [風險管理](https://blog.observe.tw/topics/%E9%A2%A8%E9%9A%AA%E7%AE%A1%E7%90%86/) | 0／3 | 2025-12-29T14:06:14.000Z | 7161, 7159, 7157 | 近 30 天沒有新的相關文章；過去觀測到的文章；共 3 篇（已確認 3／待重新確認 0） |
| [榴槤](https://blog.observe.tw/topics/%E6%A6%B4%E6%A7%A4/) | 0／1 | 2026-06-29T04:31:42.000Z | 799 | 近 30 天沒有新的相關文章；過去觀測到的文章；共 1 篇（已確認 1／待重新確認 0） |
| [國際市場](https://blog.observe.tw/topics/%E5%9C%8B%E9%9A%9B%E5%B8%82%E5%A0%B4/) | 0／2 | 2026-07-08T07:26:14.000Z | 18874, 1527 | 近 30 天沒有新的相關文章；過去觀測到的文章；共 2 篇（已確認 2／待重新確認 0） |

三例 `observedArticles90Days` 都是 0，最新發布時間皆早於本次 90 天界線；不是以 pending 或正文排除冒充歷史。這批通過的是 release 身分、固定話題映射、公開計數與 SSR 歷史內容，**不是新版手機版面或 topic 全部 UI 狀態通過**。方法說明收合仍待新的 candidate 建置與獨立畫面 review，磁碟凍結期間不建置。
