# 未發布原型：等待 SEO 決策

2026-10-12 使用者改為先審閱薄話題頁的分布與內容證據。此分支保存先前已完成的可讀網址／noindex／sitemap 原型，**不是正式版，不可直接合併或部署**。

正式服務仍是 `d6fd44a`。正式 noindex 與 sitemap 規則未套用本分支的新門檻。正式 DB 的 0018 只新增網址 registry／aliases 並完成回補，正式服務尚未讀取，原始 slug／ID／favicon／文章資料不變。

下一步先依 main 的 `docs/seo-audit-2026-10-12.md` 與使用者決策調整：若只核准可讀網址，必須把薄頁索引政策從本分支拆除，保留既有 sitemap 成員與 noindex 行為後再驗證。不能把這份原型視為使用者已核准 3 篇／2 站門檻。

已完成：600 個 backend unit、149 個 web tests（含後續 d6fd44a 隱私 guard）、23 個隔離 SQL suites；尚未做整合 clean build／公開網址切換驗收。所有 web 修改由 claude-opus-5-5 CLI 實作，Codex 處理後端與整合。
