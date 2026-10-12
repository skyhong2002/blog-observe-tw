# 完整詞庫切換前的活躍子集 preview

來源為 tag snapshot `e8a99a56-3008-4da8-86c6-64d1ff468b3f`。此測試不寫正式 DB、不切換同步來源，也不建立話題頁。473 萬詞池不是部落格索引頁母體。

- 90 頁、44,852 詞，逐頁與整體 checksum 通過；耗時 48.17 秒。
- NFKC／小寫／去除 Cf 後 44,448 canonical，合併 404 筆；其中 6 筆帶零寬字元。
- 依既有規則排除 411（noEqual 205、數字 193、日期 12、標點 1）；96 MiB 保守估算預算另留 9,322 詞於不啟用集合。
- Trie 34,715 詞、72,022 nodes、127,176 codepoints；建立 275ms，估算 100,662,784 bytes，GC 後 heap 增 31,293,472 bytes（29.84 MiB）；整個 preview peak RSS 225.6 MiB。
- 97 次 HTTP，20,046,915 bytes，單一並行、最短 500ms；未使用 fallback、未遇 429。
- 三輪 changes 皆 200：第一輪 4 頁 328 entries／1.663 秒，後兩輪零 entries／各約 0.5 秒。409 重讀要求由 fixture 驗證，實測未遇到。

活躍端點的 30 天 ≥3 篇條件不等於部落格原設定的 ≥3 篇或 180 天；此 preview 不能冒稱全部詞已匯入。完整 4,733,073 詞仍需逐頁寫入、世代／增量原子發布與容量控制，再切換正式同步；目前 15 分鐘文章窗口仍為正式来源。新詞與 changes 的正式補比對尚未啟用。

重跑：`node --expose-gc tools/preview-vocabulary-active.ts`。執行前確認磁碟與主機餘裕；不得印出服務 token。原始報告放忽略版本控制的 `.reviews/history/`。
