# 完整池的格式字元正規化與 hot-path 防護

此為離線 source 批次，正式未部署。full source exact-label ID／raw payload完全保留；派生canonical／比對改以NFKC、大小寫折疊、去Unicode format字元、空白整理。同 preview 的Cf處理對齊；包括已知U+200B前綴、U+200C/D、FEFF與wordjoiner，來源寫法合併為同一canonical，不從標籤池刪除。display保留出現最多寫法的大小寫，去format／trim，避免不可見或方向格式符號留在公開標籤文字。原noise／noEqual仍優先，pureformat仍被排除，原始詞可查原因。

NORMALIZATION_VERSION加strip-format-v1，改動傳入policy／matcher hash，不能重用舊cache／postindex版本冒稱已重配。新的fullpool缺ready policy時，`ensureTopicPolicy`明確failclosed，要求另走bounded staged preparation，避免worker hot-path掃473萬詞。ready policy仍一個SQL即返回；window原建置流程保留，沒有改current或新增scheduler。

root6suites60mocks通過（policy／hotpath／active／window／changes），獨立非作者Sol另跑3suites19mocks：`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/format-normalization-policy-independent-review.json`。六種TPBL原labels／IDs全部保留，derived只有一列且只命中一次；格式字元不會使source精確checksum改變。不是已做完整池重比對或正式前後排行驗收；新SHA仍須Mint同產物candidate。
