# 完整池的格式字元正規化與 hot-path 防護

此為離線 source 批次，正式未部署。full source exact-label ID／raw payload完全保留；派生canonical／比對改以NFKC、大小寫折疊、去Unicode format字元、空白整理。同 preview 的Cf處理對齊；包括已知U+200B前綴、U+200C/D、FEFF與wordjoiner，來源寫法合併為同一canonical，不從標籤池刪除。display保留出現最多寫法的大小寫，去format／trim，避免不可見或方向格式符號留在公開標籤文字。原noise／noEqual仍優先，pureformat仍被排除，原始詞可查原因。

NORMALIZATION_VERSION加strip-format-v1，改動傳入policy／matcher hash，不能重用舊cache／postindex版本冒稱已重配。新的fullpool缺ready policy時，`ensureTopicPolicy`明確failclosed，要求另走bounded staged preparation，避免worker hot-path掃473萬詞。ready policy仍一個SQL即返回；window原建置流程保留，沒有改current或新增scheduler。

root6suites60mocks通過（policy／hotpath／active／window／changes），獨立非作者Sol另跑3suites19mocks：`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/format-normalization-policy-independent-review.json`。六種TPBL原labels／IDs全部保留，derived只有一列且只命中一次；格式字元不會使source精確checksum改變。不是已做完整池重比對或正式前後排行驗收；新SHA仍須Mint同產物candidate。

## 2026-10-14 發布版本相容修正

`9888ebf` 正式驗收時，話題排行由 100 筆退化為 0 筆；已立即回滾 green。
原因是上述 Cf 功能改變 policy/matcher namespace，但當時正式已發布的
24,499 個 canonical terms 與 5,496 篇成功比對文章全部仍使用舊 namespace。
HTTP 200、隱私 fixture 和視覺空狀態都不能取代既有資料的功能相容驗收。

`BLOG_TOPIC_FORMAT_NORMALIZATION_ENABLED` 預設 `false`。缺省／false 模式完整沿用
已發布的 NFKC、英文大小寫、空白整理算法，display label 原封保留；由相同算法
計算相同 policy／matcher／frequency 版本，並保留精確版本、正文 owner/hash、
公開狀態、日期、每次 fresh read 與 no-store 條件。沒有重寫正式證據或接受任意版本。
設定在 module 初始化只解析一次，reader/writer 共用同一個 immutable profile，
不在請求中切換。gateway、web 與 worker 必須保持相同設定與 Node 工具鏈。

只有 exact `true` 才使用新格式字元算法／新 namespace。目前僅供離線與隔離驗證，
`NODE_ENV=production` 配合 true 會拒絕啟動。等完整池 staging 的新 canonical terms、
文章 indexes、比對證據與切換流程均完成驗收，才能另行移除此限制及啟用功能；
不能讓新版算法冒用舊 namespace，也不能先開 writer 覆寫 current 再補資料。

回歸測試 `policy-compat.spec.ts` 在 fresh process 釘死兩組實際發布 hash、SQL 與
API metadata。`policy-compat.integration.ts` 使用寫死的歷史 hash（非從受測版本
動態生成）建立隔離 fixture，套用完整排行／明細／站點／舊別名／版本不符排除
測試，避免再次讓「新版 reader + 全新版 fixture」掩蓋正式舊資料歸零。

隔離測試（只使用私有 clone credential、loopback 18169 的拋棄式 schema）：

```sh
node tools/test-integration.mjs --env-file <private-clone-env> --suite topic-policy-compat
NODE_ENV=test BLOG_TOPIC_FORMAT_NORMALIZATION_ENABLED=true node tools/test-integration.mjs --env-file <private-clone-env> --suite topic-policy-compat
```

建置／candidate／切換仍須依既有交核流程，不因 source 測試通過而自行部署。
下一候選必須與 green 在同一資料、同一時間條件比較 `/api/topics?days=30`、
首頁 `view=home`、話題明細與部落格話題，確認非空結果及實際版本相符；再跑
該 SHA／BUILD_ID 的 B0 barrier／SSR／RSC，以及主要頁面的非作者實際看圖。
本修正不更改薄頁 noindex 門檻、Cloudflare／WAF 或公開快取策略。
