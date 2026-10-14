# F3 gen17 正式證據與後續回滾

gen17於UTC2026-10-14T20:00:27.606Z切到green，APP `7ffd036fd7a968f228e0f8ebf7539d2dd94edc63`；正式HTML與candidate的Next BUILD_ID均為 `F_zSp1Bg_oZWzezesLRmQ`。

**現況：UTC20:27:33.445Z已回滾blue／gen18／af0e73c**。小批次回填第14批的首頁guard取得500並自動取消；其後正式首頁有curl exit28，三次中位數仍超過6.17秒，因此依規則回滾，兩slot與新索引／gzip備份保留。worker恢復af0，新的完整正文producer已停止；資料cursor為24418。回滾後三站均200，blog中位數2.68596秒。這份證據是gen17當時的實際驗收，不代表gen18仍有F3新功能。

正式資料查詢與全文讀取沒有共用promise／快取；candidate 53 barrier＋60 SSR/RSC另配28項真正啟用全文旗標的HTTP隱私檢查。搜尋公開counts只計目前可公開／owner、hash均驗證通過的項目，沒有公開過期候選計數；原始Opus發現與最後Sol審查分列。節流delta的原始review仍是changes_requested，其中舊adoption缺guard已由7ffd修正，並釐清CLI大量回填與worker小量歷史對帳的分工，不把原始review改標pass。

截圖由自己的DNT1工具取得，導航前安裝Google／GTM傳輸層阻擋；每個capture-report.json的 `network.requests` 是逐請求去識別紀錄，`network.analyticsEvidence.allowed=0`。這不是HAR或封包側錄，也不是GA後台收件證明；DNT、GPC實測值、HTTP/SHA/BUILD_ID及逐圖hash均在manifest。1280／390首屏與手機scroll400歷史結果的獨立review分開。全部頁面／狀態review仍pending，沒有把條件式首屏通過說成全站通過。

私有總索引：`/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/gen17-evidence-index.json`（SHA256 `fe99e08ab708747ee1b924b67f352a36a670be4d15a8135c86f5382d3c342c5d`）。

| 類別 | 絕對路徑 | SHA-256 |
| --- | --- | --- |
| 部署／回滾 | `/home/deck/.local/share/blog-observe/edge/transitions/17.json` | `7a4429ec0e0665dc6f65da3ddc5e16faa8e2f2411660801710ebc2cba9d44ff0` |
| 部署／回滾 | `/home/deck/.local/share/blog-observe/edge/transitions/18.json` | `8f7f09b554ef107802e899f5cd8cd0874f4b189c392c05b9da1677b0faf08002` |
| 部署／回滾 | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/formal-acceptance-final.json` | `86f08f03d9cff220b7c345e9e877056214b2dc4564ef8526e0af0be0fb46459c` |
| 部署／回滾 | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/switch-final.log` | `f3b3dec44435382611e78cbdf49ab7380f7ee1575cccf6e8898a3e7456b6d0f4` |
| 部署／回滾 | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/rollback-after-backfill-health.log` | `962d5d51db1edfec205476281fd41f152dc4d32820fe2d6bcb99a20677e3966c` |
| 部署／回滾 | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/after-rollback-health.json` | `7599f464b8d057bfadf50db62ff491f5678a6f2f40f944efc0bb526d8c51b45a` |
| review／隱私 | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/backend-cli-review.log` | `b2328f5b95f236dda30b433354a17ee247fe9e874da3a22791ac28f83579d6ee` |
| review／隱私 | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/backend-sol-final-review.json` | `73522f03921c0882f26f054dd8edbe22f3890ae2810aa88e30db1b9b55c986f3` |
| review／隱私 | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/throttle-sol-review.json` | `aa8a5eebe6ed7894c419f4fdc4b1d11a3a36ec788645346b49b5791dbede4d6b` |
| review／隱私 | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/candidate-ui-independent-review.json` | `182ae2d2e1dda492d2973fe264e6471c5f3f1c5befd0b10b5f16a8829599ea74` |
| review／隱私 | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/formal-ui-independent-review.json` | `5ba745a49f0ad1a242e89878a2a6fcc4880349edc6c285db91d1e450e4c4e4cc` |
| review／隱私 | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/formal-history-mobile-independent-review.json` | `8cd8f5142200e97e67279e64096439317752b0ca57b1724a7ad8bba7cbc2cfda` |
| review／隱私 | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/isolated-api-runtime-final-result.json` | `626c892f26092dbcb7b88e063c3409b7f8c09b86cea8f420d7a76bd8be872673` |
| review／隱私 | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/integration-final.log` | `2a5142f00223407445f39170b4a0799daa8aa40e50270def0e2457bb05a32d89` |
| B0 | `/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-final-barrier/7ffd036fd7a968f228e0f8ebf7539d2dd94edc63/runner-result.json` | `ffd70f0b628b98e1c0d2ef14aea2d219be081cd9f1546801ee5a8cce925047fa` |
| B0 | `/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-final-barrier/7ffd036fd7a968f228e0f8ebf7539d2dd94edc63/barrier-result.json` | `7c6c22292dc21c5225fc43df0854aa69c2fb40e64a6fe34537da8a48ba4d9640` |
| B0 | `/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-final-barrier/7ffd036fd7a968f228e0f8ebf7539d2dd94edc63/sequence-result.json` | `b7bd4f8b9136de67da4a485648098eab3c400e3721d4bd2e566c995ea3a8b996` |
| 正式manifest／raw network | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-home-topics/capture-report.json` | `42897a2e00c4c3c341f174836512593fd41f96f23dbea57193246bf3c35306a2` |
| 正式截圖 | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-home-topics/page-1-1280-light.png` | `107c1b4141353d1d9c02dce6fe01507f4744334eea20319fc700a2827ddbb377` |
| 正式截圖 | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-home-topics/page-2-390-light.png` | `d0a5f1d2f1fa67d87bfb83422ad56f1bffc703885758ab52741a3ba4ea04969a` |
| 正式截圖 | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-home-topics/page-3-1280-light.png` | `f9dbb16e2222dc4e8257040515df6605bebb22eee240baf9f74b93f35ac25d9b` |
| 正式截圖 | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-home-topics/page-4-390-light.png` | `9d93e6d828633642695df89c7bccc591487f45e966d9d9917b5598407055a263` |
| 正式manifest／raw network | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-tech-relations/capture-report.json` | `c6a4ec6d4fa8eaf53f994f6c2335d493d7d8b250ddc74e55a56a394ac01830f6` |
| 正式截圖 | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-tech-relations/page-1-1280-light.png` | `dc9845ee499ed610bfef7f84e625faf54e6f9c8d9b397688a47760594b94e172` |
| 正式截圖 | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-tech-relations/page-2-390-light.png` | `1efbe184a25446b5d42de9d0189515e5776fd080d6fd075028916b0abd076934` |
| 正式截圖 | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-tech-relations/page-3-1280-light.png` | `4d06c0b629bdeffbb31e8ca7d669b6b3ca68e5127018cd0b0e3ada5fd17ff126` |
| 正式截圖 | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-tech-relations/page-4-390-light.png` | `78b0ad7624e2626c5c1ec4b4c85c32dfd4fec78e9225e1428db57ef9914a96e7` |
| 正式manifest／raw network | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-blog-search/retry-correct-published-slug/capture-report.json` | `0ae780fe0a94c03163e54879584e137c02de03a658256856ad690d8ee0d113c5` |
| 正式截圖 | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-blog-search/retry-correct-published-slug/page-1-1280-light.png` | `0d844e3628df478405005e47412bc72c86f390c7cb333ad65631d1161c35203a` |
| 正式截圖 | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-blog-search/retry-correct-published-slug/page-2-390-light.png` | `d2528ad8525b79d92d24c6b065c1659fb27c6ca6f3b76870487050a0ede55464` |
| 正式截圖 | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-blog-search/retry-correct-published-slug/page-3-1280-light.png` | `1b879899481dfc7b6af8fb4c50207946a8f10df90f8cf96d1406ddbfb37cd0fa` |
| 正式截圖 | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-blog-search/retry-correct-published-slug/page-4-390-light.png` | `eb7f2c7b38e01d1049b3201b3274909d5ee045a044cdce2471750f380af06eeb` |
| 正式manifest／raw network | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-search-history-mobile/history-card/capture-report.json` | `0e89899396b2db6af6602ff59254156f9d3ca0ab9980762913e6a04c26454073` |
| 正式截圖 | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-search-history-mobile/history-card/page-1-390-light.png` | `5d89fc9eac93270ac1eb6871f2d5b753dc8892d20e113db3de8e3871aafe315a` |
