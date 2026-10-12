# 搜尋引擎索引

## Sitemap

Search Console 可提交 `https://blog.observe.tw/sitemap.xml`。它是 sitemap index，依類型分成：

- `/sitemaps/pages.xml`：首頁、部落格目錄、話題、API 文件、關於。
- `/sitemaps/blogs.xml`：有有效網址、slug 且 verified 的部落格頁。
- `/sitemaps/topics.xml`：維持原有近 90 天至少 1 篇有效文章的話題集合，網址改為可讀 canonical；原有雜訊、inactive 詞與高頻詞證據規則不變，另排除空白及純標點／符號。

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

本次只發布可讀網址，不新增薄話題 noindex 或 sitemap 門檻。少文、單站、低頻及原本存在的部落格頁維持原有索引行為；計數僅供內容覆蓋說明。話題詳細頁預設仍為 30 天，sitemap 沿用原有 90 天證據窗口。未知及空白／純標點話題 HTML 回真正 404；詞庫原始資料與排除原因仍保留可查。

本批 additive registry 已有備份且完成初次回補；往後程式／API 部署沿用最近備份，不因一般回補另建完整備份。`tools/backfill-public-routes.ts --kind blog|topic|topic-alias --limit 100 --after-id <cursor> --apply` 每批最多 500 筆、可從回傳 cursor 續跑。正式 worker 每 15 分鐘各補最多 100 個缺少的 blog／topic／alias，不重寫已建立的 canonical。正式 GET 不寫資料庫。回滾保留兩張新增表、不刪資料；301 發布後優先使用下節的相容 web-only 回滾，避免新網址在舊 UI 上變成 404。

## 主機空間

建置、備份、快照或 release 複製前須 `df -h /home`，至少保留 10 GiB 可用空間。`npm run web:build` 已在刪除／產生建置檔之前強制檢查；其他大檔工具先執行 `node tools/disk-space.mjs`，不足時停止。既有 releases、worktrees、node_modules 與備份的清理需先取得使用者本人明確批准（babysit 或其他協助者不能代為同意）；保留正式版、可回滾版及審查證據，不以自動刪除掩蓋空間不足。

## Explicit canonical URL maintenance

Public HTML routes are independent of API IDs, `blogs.slug` and favicon keys. Routine
backfill, title/name edits and vocabulary refreshes never change an existing
`public_page_routes.canonical_key`.

A future explicitly authorized rename must first back up the registry, then, in one
transaction, lock the page row, claim the new `(kind, route_key)` in
`public_route_keys` for the **same entity**, and update that page's `canonical_key`.
Reject a key already owned by another entity. Keep every old key; do not create
alias-to-alias records. The composite foreign key enforces canonical ownership.
Every alias lookup joins directly to the final page row, so an uncached old URL
redirects straight to the new canonical URL in one 301.

After such maintenance, invalidate gateway redirect/API caches (or restart the
gateway) and invalidate relevant CDN caches. Previously issued browser redirects
can remain cached for their 300-second TTL; verify the single-hop result after that
grace period as well. This release does not provide a rename CLI or perform any
automatic canonical rename. The SQL integration fixture covers explicit maintenance
of both blog and topic routes, retained legacy IDs and subsequent routine backfill.

## Emergency web-only compatibility rollback

Permanent redirects remain HTTP 301. Once a browser has cached an old-to-readable
redirect, rolling the entire stack back to a pre-registry gateway/UI can make that
readable URL return 404. Prefer this temporary compatibility mode when only the
new web release has failed:

1. Keep the new gateway and additive route tables. Point the web service to the
   previous release (worker rollback is independent).
2. Set `BLOG_UI_LEGACY_PAGE_PATHS=true` in the gateway environment and restart the
   gateway. The default is disabled; no database changes are needed.
3. The gateway still redirects legacy URLs once to the readable canonical with
   301. For an already-canonical blog/topic GET or HEAD, it resolves the stable
   entity ID and proxies internally to the old UI's stable-ID route. It preserves
   the query exactly and encodes the stable path segment once; it never redirects
   visitors back to the legacy URL, mutates the request body, or rewrites APIs,
   authentication, unknown pages or other frontend routes.
4. Verify old URL → 301 → readable URL → 200, both blog and topic pages, query/HEAD
   behavior, OAuth, `/healthz`, and the sister sites. Existing SPA/RSC sessions may
   need a full reload after switching web releases.
5. After restoring the new UI, remove the flag/restart the gateway and verify
   self-canonical metadata again.

This is an availability bridge, not a permanent SEO configuration: the previous
UI can temporarily emit its old canonical/link metadata. If the gateway itself
must also be rolled back for safety, perform the full rollback and explicitly
report that cached browser 301 responses can still lead to unreadable new paths;
server-side cache purges cannot remove browser-held permanent redirects.

## 備份限制（2026-10-12 使用者更新）

- 只有破壞性 migration 或刪除資料前才建立新的完整備份；程式、API 欄位及一般 additive 變更沿用最近一份。
- 建立前估算輸出大小，確認完成後 `/home` 仍至少有 10 GiB；僅看開始前大於 10 GiB 不足以通過。無法保守估算或餘額不足時停止。
- 以 `mariadb-dump` stdout 直接串流進 gzip，僅寫 `.sql.gz`；不得先產生未壓縮 `.sql`。憑證只由受保護環境／臨時設定傳入，不寫 Git 或日誌。
- 既有備份全部保留；清理必須由使用者本人明確批准。旧 `.reviews/completion/backup.mjs` 未壓縮 helper 已停用，不能繼續沿用。
