# 搜尋引擎索引

## Sitemap

Search Console 可提交 `https://blog.observe.tw/sitemap.xml`。它是 sitemap index，依類型分成：

- `/sitemaps/pages.xml`：首頁、部落格目錄、話題、API 文件、關於。
- `/sitemaps/blogs.xml`：有有效網址、slug 且 verified 的部落格頁。
- `/sitemaps/topics.xml`：近 90 天在已驗證部落格有有效文章比對證據的 canonical 話題。

每份子檔最多 10,000 個網址；超出時產生 `blogs-2.xml`、`topics-2.xml` 等，並自動列入 index。XML 另檢查 50 MB 上限。資料的 lastmod 取文章資料修改時間；固定頁取對應程式來源的修改時間。公開網址固定為 HTTPS 正式網域、結尾斜線、不含 query；私人閱讀清單、管理頁、未驗證來源、原始文章全文都不列入。

`robots.txt` 允許公開內容，排除私人、登入、管理、搜尋及 API；明確允許 `/api/` 文件與 OpenAPI 規格。robots 只是爬蟲指引，私人內容仍由伺服器授權保護。

檔案由 Fastify 提供，GET/HEAD 都可用；來源及共享快取 300 秒，stale-while-revalidate 600 秒。資料查詢採 300 秒 single-flight 快取，避免多個爬蟲重複掃描。帶私人認證的請求仍遵守既有 private/no-store 策略。

## 驗收

```sh
python3 tools/seo/verify.py
# 同份正式 canonical，在隔離預覽驗證：
python3 tools/seo/verify.py http://127.0.0.1:18165
```

驗證 robots/index/每個子檔 HTTP 200 與 XML 格式，列出各檔數量，並抽第一、中間、最後三個網址確認 200、自我 canonical 與無 noindex。不存在的合法格式話題必須真正 404；Next 的上游錯誤保持錯誤／舊 ISR，不轉成不存在。

公開頁 metadata 與 JSON-LD 由 Opus 實作，沿用新文易數的來源與 MIT 聲明；保持 ISR，沒有引入 cookies、headers 或伺服器 searchParams。
