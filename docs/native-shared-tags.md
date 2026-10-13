# Native shared-tags 離線實作

`loadSharedTags(pool,{sourceBlogId,days:7|30|90})` 已接部落格 relations profile，須 `BLOG_SHARED_TAGS_ENABLED=true` 才執行（預設關閉）；無fetch、無新表。matchVersion `native-post-tags-v1` 是演算法版本，不是payload revision。只使用既有 tags/post_tags/posts/blogs；不查AI生成內容、topic詞庫或正文相似度。共同標籤不代表引用、交流或正文相似。

公開條件於target SQL重驗兩側verified blog、現存且非未來期間文章、active post-tag及public active tag。日期NULL不入期間；source blog指定，target排除同站。每個distinct tag以MAX(articleID)選一個確定代表，不稱最近發布文章。來源最多30 tags，回傳最多100 article-pair/tag edges（故unique target articles亦不超100）；31/101筆探測截斷，sourceTagsTruncated與truncated明列，沒有假total。

保留sourceArticleId、targetArticleId、targetBlogId、tagId/label，兩側post-tag sourceType/lastSeenAt、tag sourceType/lastSeenAt。文章URL/title/publishedAt由final public JOIN取得；標題SQL截至240字，targetBlogSlug/name保留，canonical站內連結由接線端解析。不輸出tag provenance的raw來源URL、evidence、actor、body或帳號。每次新讀，無cache或singleflight；接線者必須維持private/no-store、optional unavailable不能冒充empty。

每SQL MariaDB SET STATEMENT max_statement_time=0.25（250ms），driver500ms、整體1500ms。每pool最多2 admissions；expired acquire保留槽直至底層settle；晚到connection不執行SQL；query失敗/逾時只destroy自有connection。錯誤固定shared_tags_unavailable；對外DTO unavailable。

mock tests驗provenance/SQL條件/截斷/admission/逾時，不替代真SQL。optional runSharedTagsIntegration入口需assertEphemeralDatabase 127.0.0.1:18169 disposable名；集中 runner 已在既有隔離 DB 執行，14 checks 通過（`.reviews/f3-f4-isolated/review-fixes-sql.log`）；mock 6 tests 通過。未 HTTP／正式 DB／build／capture 或部署。獨立 GPT-6.1 Sol source review 由非作者 instance 執行，見凍結批次交付紀錄。
