# 詞庫 writer 漂移檢查

`npm run audit:topic-writers` 與兩份 `app/test/topic-writer-audit*.spec.ts` 只讀 source，
將 `app/src`／`tools` 的 JavaScript／TypeScript literal／template 中四個表的寫入，
以及不能靜態確認的 query expression，對照 `data/topic-writer-registry.json`。
目前 161 個 reference，127 個標為 dynamic；包含 read-only wrapper，因此不是實際
writer 數量，也不是 barrier 覆蓋率。

新增路徑、SQL fragment、同 fragment 的 occurrence 或動態 expression 改變時，檢查
失敗。registry 更新必須跟相關 source 一起獨立 review；登記不是安全批准，工具沒有
自動更新 registry 或授權發布的模式。輸出只有檔案路徑、digest、表名與計數，不含
原 SQL、正文、URL、設定或密鑰。

TypeScript 7 的 root export 沒有舊 compiler parser API，工具直接使用既有 Next lockfile
中的 compiled Babel parser；不安裝另一套 parser。先安裝兩個 workspace 的 lockfile
依賴才能執行。這是開發檢查，不由 gateway／worker 載入。

## 有界讀取與限制

- 僅排除明確 spec／test／integration／fixture 路徑與兩支既有 test runner；一般檔名
  含 test 的 production helper 仍納入。
- 來源樹入口與目錄不能是 symlink；檔案在讀取前再次檢查，使用 `O_NOFOLLOW` 的 owned
  descriptor、fstat／實際 byte sentinel，再核 source identity，最後關閉 descriptor。
- 每檔上限 1 MiB、合計 64 MiB、樹 entry 8192、單檔 AST node 500000；超限、語法錯誤、
  缺檔、UTF-8 錯誤或換檔均失敗，不以較短 registry 宣稱通過。
- computed method／拼接／不明 query argument 保守登記為 unresolved；SQL modifier 或
  comment 使表名無法直接解析時亦保守登記，不默默視為沒有寫入。

**這不是 DB write-admission，也不是完整的 SQL 語意分析。**非 JavaScript／TypeScript
source、外部載入 SQL、operator／restore、未改 SQL 卻改 caller/barrier 的情況仍是盲點。
使用 owned、不可變、釘 SHA 的 checkout；父目錄被有權限的惡意程式同時替換不在此工具
的 OS sandbox 保證內。所有 writer 的同交易 dirty event／shared barrier 與 finalizer
的 locking read 尚未實作；不能因這份檢查通過而發布完整詞庫。

本輪 review 發現的 computed query、comment／modifier SQL、symlink 換檔三項均採納修正；
測試使用 mock filesystem，沒有建立真 symlink 或讀取外部檔案。原始 findings／model／
hashes 位於私有 review receipt，沒有加入 Git。
