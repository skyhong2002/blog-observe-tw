# 可讀網址：核准範圍與部署條件

本批以使用者指定的 `249bbc7` 草稿為基礎，合併遠端 `origin/main` 的 `a1a226d`，保留正式 `d6fd44a` 的 GA 隱私保護。使用者核准可讀網址，**尚未核准薄頁 noindex 門檻**；原型中的 3 文／2 站、低頻及 seed 額外索引門檻已移除。

- 部落格與話題改用持久化 canonical key，舊 hash／discovered 網址一次 301 到最終頁；ID、API slug、favicon key 不變。
- 使用者明確核准公開 v1 部落格 `url` 改為本站頁面、原站改用 `sourceUrl`；話題新增本站 `url`，不另加 `pageUrl`。文章 `url` 仍連原文，內部 API 的原站網址保持不變。遷移日期與受影響端點列在產生的 API 文件。
- sitemap 保留原有內容集合，僅網址遷移及使用者核准的空白／純標點噪音排除。
- 已發布 key 不因顯示名稱、大小寫代表寫法或例行回補而改變。明確改名的維護流程见 `docs/seo.md`，所有舊 key 直接解析到最終 canonical。
- Migration 0018 僅新增 registry／alias，已備份與回補；舊正式版本不讀取這兩張表，回滾不需刪資料。

所有 web 修改由 `claude-opus-5-5` CLI 實作；Codex 負責後端、交叉審查、整合測試與部署。部署前必須通過隔離 SQL 測試、clean build，以及實際 HTTP 單跳與 canonical 驗證；不可把單元測試當作已部署的證明。

任何大檔建置／備份／release 複製前先執行 `node tools/disk-space.mjs`，低於 10 GiB 就暫停。2026-10-12 使用者本人僅另准清理 `blog-completion-release` 與 `blog-icon-fix` 中的 `node_modules`、`web/node_modules`、`web/.next` 六個目錄；已清理。其餘候選、正式 release、回滾與備份一律保留，後續清理需本人另准。

## 目前發布狀態

2026-10-12 最後容量檢查再次低於 10 GiB，因此**尚未切換正式服務**，正式 release 仍是 `d6fd44a35da4ac92052e04bff670c6c161e50b3d`。可讀網址預覽已完成 5 個部落格與 5 個話題的 301→200、自我 canonical、Unicode／雙重編碼、三類 metadata／JSON-LD 及相容回滾測試。最新 API 欄位意義依使用者最終決定已更新規格與文件，`/api/` 自動讀取同一份產生的規格；仍須在容量恢復後重新建置該文件頁並完成正式網址驗收。

備份後補齊期間新增的 registry／alias，未修改文章 ID／原站 URL／favicon。這些新增表在 d6 正式版中尚未被使用。下一次先 fetch origin、確認此分支的最新 commit、檢查空間，通過建置與全部驗證後再合併 main／push／切換；不得拿本狀態文件當成已部署證明。
