# B2 部落格 profile：有界文字前段比對 consumer

基底 `00d050198e46de658ffe0b75b253bacf450bfe83`。三種證據分開：正文直接連結引用、共同原生標籤、文字前段重疊。後兩者不是引用／交流；文字重疊也不是語意相似或抄襲判斷。flag `BLOG_TEXT_SIMILARITY_ENABLED` 預設關閉，不因本批source完成自動開啟。

profile 只從原有最近20條正文連結中，選本站向外、已知目標文章且owner吻合的最多3組獨立配對，最多6篇文章。相同文章對去重，不掃全站、不猜URL、不做NxN。目標ID是relation_links.target_post_id與posts owner／非future的LEFT JOIN；相同ID的target改換到另一公開owner時，reader仍須符合選取時expectedTargetBlogId。原始citation觀測、文章計數與blogroll／sidebar／comment完全不變。

reader兩次fresh公開／日期／正文status／bodyowner URL／hash重讀，沒有結果或promise cache；撤下後的新請求不接舊promise。body前段≤4096codepoints、raw≤64KiB、trigram Dice；摘要preview僅公開post summary≤240字，正文與hash不進publicDTO。

UI由既有Opus5.5 instance撰寫；not-enabled／no-selected-pairs／unavailable／insufficient-text都不冒充0%或『無相似文章』。ready列雙方文章ID、各自日期、觀測、版本及公開摘要；只保留allowlist。外連拒username/password，合法原文章query保留，不能猜剝參數而改錯文章。選取限制／截斷收在說明展開區。較舊gateway的not-analysed仍有相容說明。

獨立Sol review發現並採納兩項P2：expectedtarget owner遺漏、UI URL credentials。raw作者logs：`.reviews/offline-quality/b2-consumer-opus.jsonl`、`b2-fix-vocab-plan-opus.jsonl` taskA、`b2-credential-fix-opus.jsonl`，actualmodel均claude-opus-5-5、success。後兩次author fix不是selfreview。backend followup：`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/b2-profile-independent-followup.json`；UI source review：`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/b2-opus-ui-independent-followup.json`。

本批43 backend mocks／48 SSR、web no-emit通過。新增既有isolated SQL fixture涵蓋pair去重、目標換owner、非公開summary不回；source已review，**此提交時SQL尚未跑**，不把它當實測。沒有capture/newBUILD_ID/正式畫面，ledger依舊pending。Mint須同產物完成多筆／少筆／無目標／insufficient／unavailable／disabled，以及1280／390兩色的非作者真看圖才可候選驗收。
