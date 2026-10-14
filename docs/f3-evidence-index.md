# F3 正式證據索引

正式green/gen21/b8c1350，BUILD_ID F_zSp1Bg_oZWzezesLRmQ；gen17與gen19圖片保留原實際SHA。gen21為pure API修正／n/a-ui，沿用同一份已review的前端artifact；不把舊看圖改標為新APP。

總索引：`/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/evidence-index-current.json`，SHA256 `e6f89c0fc61069ce421c71fb4c8df95da3646546d7e491b4b5c05d6a2d813026`。

每份capture-report.json的 `network.requests` 是逐請求去識別raw紀錄，不是HAR或封包側錄；DNT/GPC實測值、導航前Google/GTM阻擋、analytics.allowed0與逐圖hash在原檔。所有圖片在repo外。

gen17的原始切換/回滾/source privacy/candidate/formal明細見 [gen17歷史證據](f3-gen17-evidence.md)。gen19修正首頁成本后恢復F3；gen21只強化v1時間窗口的未發布邊界，沒有新的UI。全部route/狀態review仍未完成。

操作檢查更正：gen19的原localhost healthz測試誤要求edge才加的x-blog-release header；local identity由candidate的PID/socket/source archive證明。修正HTTP檢查是在switch後實測，`budget-local-check-corrected.json` 明確標post-switch，不冒稱pre-switch紀錄。

滾動清理只刪已核准且無unit/slot/cwd引用的五個release；當前b8、回滾af0與edge code930保留，所有backup/worktree/source/evidence不刪。

| 類別 | 絕對路徑 | SHA-256 |
| --- | --- | --- |
| 切換／回滾 | `/home/deck/.local/share/blog-observe/edge/transitions/17.json` | `7a4429ec0e0665dc6f65da3ddc5e16faa8e2f2411660801710ebc2cba9d44ff0` |
| 切換／回滾 | `/home/deck/.local/share/blog-observe/edge/transitions/18.json` | `8f7f09b554ef107802e899f5cd8cd0874f4b189c392c05b9da1677b0faf08002` |
| 切換／回滾 | `/home/deck/.local/share/blog-observe/edge/transitions/19.json` | `1959953f5e26692c30dfb1d07e66c68b29dcec8972442ac276643e2a6bba70c4` |
| 切換／回滾 | `/home/deck/.local/share/blog-observe/edge/transitions/20.json` | `8e5eb411897991deb75f038ead8e292b60028276ba0b7fe87404735971a8f7af` |
| 切換／回滾 | `/home/deck/.local/share/blog-observe/edge/transitions/21.json` | `b4222dd83f1276bf2f173e1cec472e275cb3353f423a75e06dcb6395a0abe427` |
| 驗收／review | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/formal-acceptance-final.json` | `86f08f03d9cff220b7c345e9e877056214b2dc4564ef8526e0af0be0fb46459c` |
| 驗收／review | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/formal-acceptance-budget.json` | `1078e0f2b70a5fc889ee752fbfaee043353e4fff3c7b5840c2ceeb1b1409b582` |
| 驗收／review | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/formal-acceptance-future.json` | `4f394b7b99d6f6d03caec860681eaaed8eabaaf50e9fe0e41f6973fdb00bdcdf` |
| 驗收／review | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/backend-cli-review.log` | `b2328f5b95f236dda30b433354a17ee247fe9e874da3a22791ac28f83579d6ee` |
| 驗收／review | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/backend-sol-final-review.json` | `73522f03921c0882f26f054dd8edbe22f3890ae2810aa88e30db1b9b55c986f3` |
| 驗收／review | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/isolated-api-runtime-final-result.json` | `626c892f26092dbcb7b88e063c3409b7f8c09b86cea8f420d7a76bd8be872673` |
| 驗收／review | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/isolated-api-future-result.json` | `51b450a7ed39332a356775fa10566c1368b2bdce2a91a36f5affb058174b6983` |
| 驗收／review | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/public-title-future-opus-review.json` | `535db92da1dbc73861830688d6c8baebd2d0b1008f37d3bc4b39a93d0b56a79e` |
| 驗收／review | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/public-title-future-integration-final.log` | `51925bfbaea2ec4eca3cdd3364aa8065c8fca0dbf4ca03ce039f8edc31551d22` |
| 驗收／review | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/candidate-budget-independent-review.json` | `a517a4b1e302fd30ef79bce87c9c39264093b921d68463fd28c1650c433335c3` |
| 驗收／review | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/formal-ui-independent-review.json` | `5ba745a49f0ad1a242e89878a2a6fcc4880349edc6c285db91d1e450e4c4e4cc` |
| 驗收／review | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/formal-gen19-independent-review.json` | `c12564cd357f488667221a46475477a0200b1ce6143717c0866a03f3f5509f8f` |
| 驗收／review | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/rolling-release-cleanup-result.json` | `ba9c92a3e5a9e13e7f27d1a4f98de25651391a4e377987d9fe45c9659a6e6e95` |
| 驗收／review | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/future-preflight-raw.json` | `c8270ec15c7bacb8d6318fbe976fb9cb2b1e8c80a93037d513083c22770e53bc` |
| 驗收／review | `/home/deck/.cache/blog-home-cloud-b3-20261014/.reviews/f3-fulltext/budget-local-check-corrected.json` | `aec345785d7217793e89f71f30e591b0b23e7d7ebcfbc759b39283a7c1ac441e` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-blog-search-correct/capture-report.json` | `3c05100cb1596113f536de748f6830f40c0ccca9906d9a37c2408483dc040832` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-blog-search-correct/page-1-1280-light.png` | `dbfd78530ae2d9568b2db5570057126ffc07e98cee9c738d0e687af1a7bead1b` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-blog-search-correct/page-2-390-light.png` | `f8e9807f4cf3254ed7c96bf94eba777f6f0b890853558270cab1610d4f5d223a` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-blog-search-correct/page-3-1280-light.png` | `e94ef54446405d851ea330b357cea5f06a1d3bba3847387a6fbdcb6104cebbe7` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-blog-search-correct/page-4-390-light.png` | `70aff70f9d35dd771e1cc39da21e3b82aace00f74d838a89f26ca04c7edc2457` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-home-topics/capture-report.json` | `80bec86f92ae3f5f049a95d4edadd84cea671cbecfe81002df9d546260a569fa` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-home-topics/page-1-1280-light.png` | `a2db9009c97826f2773e45960a7861ea8cf6f4f79de85acfa02a703d0a28491b` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-home-topics/page-2-390-light.png` | `5164aa8ce62165206c983e091c12ce53ac0f20abb293ba7ba0a2a1ecf2331527` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-home-topics/page-3-1280-light.png` | `006bcea09120dd24038de94ba2ff44f5ef81bc3e1229b1f5f2723f5a7300a0c9` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-home-topics/page-4-390-light.png` | `087d6d72b27c4865f6a9e5fccab7d9f6745cb83ecd7ad08ab975a9dbeb1193a3` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-tech-relations/capture-report.json` | `f5a987f6e3d54238e2b45f8082ec9ea63cee6375e11fdb9839181d2df4ce5062` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-tech-relations/page-1-1280-light.png` | `23f48c7052e473e497bf33a5007115472e0bec1647470223895f88ca940adf9a` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-tech-relations/page-2-390-light.png` | `a83b7ee83c0cb93683846121eb0ad6de6391e53199e07fc089e98461d2a225e7` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-tech-relations/page-3-1280-light.png` | `511674a70de690de7e6be40907ea11060ddef7aaa70d73ec094b153e824493f1` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-gen19/formal-tech-relations/page-4-390-light.png` | `ad6ad74969c1cfe6610d4702dead0e2b85d1f2b0ab9b8049c1c43d893f0c3a9b` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-home-topics/capture-report.json` | `42897a2e00c4c3c341f174836512593fd41f96f23dbea57193246bf3c35306a2` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-home-topics/page-1-1280-light.png` | `107c1b4141353d1d9c02dce6fe01507f4744334eea20319fc700a2827ddbb377` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-home-topics/page-2-390-light.png` | `d0a5f1d2f1fa67d87bfb83422ad56f1bffc703885758ab52741a3ba4ea04969a` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-home-topics/page-3-1280-light.png` | `f9dbb16e2222dc4e8257040515df6605bebb22eee240baf9f74b93f35ac25d9b` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-home-topics/page-4-390-light.png` | `9d93e6d828633642695df89c7bccc591487f45e966d9d9917b5598407055a263` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-tech-relations/capture-report.json` | `c6a4ec6d4fa8eaf53f994f6c2335d493d7d8b250ddc74e55a56a394ac01830f6` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-tech-relations/page-1-1280-light.png` | `dc9845ee499ed610bfef7f84e625faf54e6f9c8d9b397688a47760594b94e172` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-tech-relations/page-2-390-light.png` | `1efbe184a25446b5d42de9d0189515e5776fd080d6fd075028916b0abd076934` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-tech-relations/page-3-1280-light.png` | `4d06c0b629bdeffbb31e8ca7d669b6b3ca68e5127018cd0b0e3ada5fd17ff126` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-tech-relations/page-4-390-light.png` | `78b0ad7624e2626c5c1ec4b4c85c32dfd4fec78e9225e1428db57ef9914a96e7` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-blog-search/retry-correct-published-slug/capture-report.json` | `0ae780fe0a94c03163e54879584e137c02de03a658256856ad690d8ee0d113c5` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-blog-search/retry-correct-published-slug/page-1-1280-light.png` | `0d844e3628df478405005e47412bc72c86f390c7cb333ad65631d1161c35203a` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-blog-search/retry-correct-published-slug/page-2-390-light.png` | `d2528ad8525b79d92d24c6b065c1659fb27c6ca6f3b76870487050a0ede55464` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-blog-search/retry-correct-published-slug/page-3-1280-light.png` | `1b879899481dfc7b6af8fb4c50207946a8f10df90f8cf96d1406ddbfb37cd0fa` |
| 正式截圖／raw network manifest | `/home/deck/.t3/userdata/blog-f3-fulltext-20261015/formal-blog-search/retry-correct-published-slug/page-4-390-light.png` | `eb7f2c7b38e01d1049b3201b3274909d5ee045a044cdce2471750f380af06eeb` |
| 當前runtime B0 | `/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-final-barrier/b8c1350e38a118c26a67fe67fc1336814e3685f0/runner-result.json` | `29c4a0ba26f531f39fcd8574bf70a300d5977c53b3436bf9be29a1b232ddebfa` |
| 當前runtime B0 | `/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-final-barrier/b8c1350e38a118c26a67fe67fc1336814e3685f0/barrier-result.json` | `05726a292a8369c68187a6af39070253457147c433c681cf5c75e6de11100515` |
| 當前runtime B0 | `/home/deck/.t3/projects/blog-observe-tw/.reviews/b0-final-barrier/b8c1350e38a118c26a67fe67fc1336814e3685f0/sequence-result.json` | `daa4b78118bea9a92a6c8c098c6b57740a986336f8ff0c720279bbe4382d5406` |
