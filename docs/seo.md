# 搜尋引擎索引

## Sitemap

Search Console 可提交 `https://blog.observe.tw/sitemap.xml`。它是 sitemap index，依類型分成：

- `/sitemaps/pages.xml`：首頁、部落格目錄、話題、API 文件、關於。
- `/sitemaps/blogs.xml`：有有效網址、slug 且 verified 的部落格頁。
- `/sitemaps/topics.xml`：近 90 天至少 3 篇有效文章、來自至少 2 個已驗證部落格的 active canonical 話題；雜訊、inactive 詞與不符合高頻詞標題命中規則的證據不計入。

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

## 可讀網址與薄頁

`public_page_routes` 與 `public_route_keys`（additive migration 0018）分開保存穩定實體 ID、canonical key 與永久別名。部落格的 `discovered-<hash>` 改用網域／平台作者路徑；話題使用 NFKC 正規化文字，必要時加穩定碰撞後綴。已發布的 canonical 不因改名而漂移。原 API slug／話題 ID、favicon 檔名不變；舊 HTML 網址一次 301 到新相對路徑，API 路徑維持相容。搬家僅在舊網址有唯一 verified 擁有者時解析到最終目標，不依筆名猜測。

話題是否索引由 `/api/pages/topics/:key` 與 sitemap 共用同一份 300 秒快取的 90 天證據。未達 3 文／2 站仍可閱讀、回 200、自我 canonical，但 `noindex,follow` 並從 sitemap 排除；未知詞回 404。部落格不套用文章數／站數門檻，低頻站仍可索引；未驗證或網址無效的既有頁保留但 noindex。

初次回補先備份 blog_observe，再執行 migration。`tools/backfill-public-routes.ts --kind blog|topic|topic-alias --limit 100 --after-id <cursor> --apply` 每批最多 500 筆、可從回傳 cursor 續跑。正式 worker 每 15 分鐘各補最多 100 個缺少的 blog／topic／alias，不重寫已建立的 canonical。正式 GET 不寫資料庫。回滾只切回舊 blog release，保留兩張新增表；舊服務完全不讀它們，不需要刪除資料。

## 主機空間

建置、備份、快照或 release 複製前須 `df -h /home`，至少保留 10 GiB 可用空間。`npm run web:build` 已在刪除／產生建置檔之前強制檢查；其他大檔工具先執行 `node tools/disk-space.mjs`，不足時停止。既有 releases、worktrees、node_modules 與備份的清理需先取得使用者同意；保留正式版、可回滾版及審查證據，不以自動刪除掩蓋空間不足。
