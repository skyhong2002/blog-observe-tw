# 隔離 SQL 整合測試

使用 Node 24，在本機獨立 MariaDB `127.0.0.1:18169` 執行：

```sh
npm run test:integration -- --env-file /path/to/private-clone.env
```

憑證檔必須是目前使用者擁有、權限 `600` 的一般檔案，包含測試伺服器的 `BLOG_DB_URL`。不得使用正式站 `.env`；runner 不自動載入環境檔，也不採用繼承的資料庫 URL。測試帳號需有建立／移除資料庫的權限。

Runner 會建立隨機命名的 `blog_observe_integration_<24 hex>` 資料庫，套用 legacy baseline 與全部 Drizzle additive migrations。測試只使用合成 fixture、HTTP 與 AI gateway 替身，涵蓋預算並行／回滾、快取、候選准入與 AI 引用攻擊、關係替換／深度／上限、詞庫與排序、管理員權限與稽核。成功或失敗都會移除該隨機資料庫；不修改既有 clone 資料庫。若程序被強制終止，可能留下該前綴的測試資料庫，需由測試伺服器管理者清理。

輸出只包含測試結果、失敗階段與錯誤碼／程式位置，不顯示連線字串、SQL 錯誤內容或憑證。請勿提交憑證檔與真實資料庫匯出。
