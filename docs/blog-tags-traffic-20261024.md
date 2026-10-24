# 部落格標籤改由 traffic.observe.tw 管理（2026-10-24）

部落格的「標籤」（原「部落格類型」，程式裡仍叫 genre）從這版起只存在 traffic.observe.tw（traffic repo `src/crowd.ts`，說明見其 `docs/README.md`「標籤投票」「服務 API」）。traffic 以網域為鍵，所有觀察站共用同一份標籤與票。blog 不再寫 `blog_genre_assignments`／`blog_genre_votes`；兩張表保留不刪，作為回滾依據（最後一筆寫入早於這版上線）。

## 對應方式

- 部落格 → 網域：`blogs.canonical_host` 經 `crawl/similarweb-client.ts normalizeSimilarDomain`（小寫、去掉 `www.`，與 traffic `publicDomain` 同一規則）。程式在 `app/src/blog-genres/traffic.ts`（`tagDomain`）。
- 服務：`http://127.0.0.1:18150/internal/v1/tags*`，token 與 Similarweb client 相同（`~/.config/observe-similarweb/blog-token`，或 `BLOG_SIMILARWEB_TOKEN`）。gateway 與 worker 同一個使用者，讀得到同一個檔，不需要新的 drop-in。
- 標籤 → 網址參數：traffic 的標籤名稱經 `genreKey` 轉成代碼，起始 20 個仍是 `food`、`travel`…（「美食」→ `food`、「3C」→ `gadgets`），所以舊的 `/blogs/?genre=food`、`/articles/?exclude=food` 照舊有效。其他標籤用自己的折疊文字（「個人」→ `?genre=個人`）。標籤長度上限改為 traffic 的 32 字。
- traffic 編輯清單（`site_metadata` 或試算表）的標籤，例如「個人」「科技」，來源顯示「編輯」，一律顯示，可以投票但票數不影響顯示（traffic 規則）；在目錄可以篩選，也列入目錄的標籤 chip。

## 讀與寫

- 部落格頁：每次讀這一個網域（新鮮）。目錄、最新文章（overview）與管理頁的部落格表共用一份「所有已驗證部落格」的快照，1 分鐘內不重讀；traffic 沒回應時沿用 10 分鐘內的上一份，再久就顯示「標籤資料暫時無法使用」（`unavailable`）。投票、新增、覆寫成功後，回傳的新標籤會直接寫進快照。
- 寫入：路由、CSRF、Origin 檢查、登入要求與每人每分鐘 30 次不變，代理到 traffic；投票者是登入者的 Google email。管理員只看 traffic 回的 `voter.admin`（`TRAFFIC_ADMIN_EMAILS`），不再用 blog 的 isAdmin。traffic 無法連線回 503；traffic 拒絕時照狀態碼回 400／403／404／429。
- 管理員覆寫仍寫一筆 `admin_audits`（`genre.set|hide|release`），讓帳號頁的「標籤裁定」計數繼續有效；traffic 的 `tag_log` 才是完整紀錄。
- 帳號頁「標籤投票」計數（gen103 起）：`POST /internal/v1/tags/voters { voters, via: 'blog' }`，只算經 blog 投的票；traffic 沒回應時表格照常顯示，說明裡註明這次沒讀到。
- AI 初判：`tools/apply-blog-genres.ts --apply [--slug <slug>]` 呼叫 `PUT /internal/v1/tags/ai`（每 500 個網域一次），只取代 blog 自己的 AI 初判；gen103 起每個標籤帶自己的理由（`{ tag, reason }`）。
- 政治傾向（藍、綠、藍營…）是 traffic 的保留字：新增或指定顯示時 traffic 回 400 `reserved_tag`，blog 照碼轉回，畫面顯示「政治傾向不是標籤，不能新增或指定顯示。」
- traffic 還不認得的新部落格（blog worker 同步 watches 有時間差）：寫入回 404 `unknown_domain`，畫面顯示「這個部落格的標籤資料還在準備中，請稍後再試。」
- 管理員不投票（gen104，traffic 0ea2840）：管理員按的同意／不同意／收回與新增，traffic 直接轉成指定顯示／隱藏／解除覆寫／新增並指定顯示，`voter.votes` 回的是覆寫狀態。部落格頁對管理員顯示「顯示」「隱藏」（按下後「已指定顯示（解除）」「已隱藏（解除）」），新增框寫「新增標籤並指定顯示」；原本的「管理員覆寫」輸入框功能重複，已拿掉（`/genres/:genre/admin` 路由保留）。blog 在寫入前帶 voter 讀一次，管理員的每個動作都記一筆 `genre.set|hide|release` 稽核。
- 管理員覆寫時標籤的寫法：先用這個網站在 traffic 的寫法，其次任何部落格快照裡的寫法（iPhone），再其次管理員輸入的原文（body `tag`，須與網址的代碼相同），最後才是代碼本身。

## 介面文字

一律叫「標籤」：部落格頁區塊標題「標籤」、「新增標籤」、「標籤資料暫時無法使用」；目錄 chip「全部標籤」，拿掉「未分類 N」（`?genre=-` 不再是篩選，會顯示全部）；最新文章「隱藏標籤」。管理頁原本的部落格標籤改稱「人工標籤」以免混淆。

## 上線紀錄

2026-10-24 06:24（台北時間）gen102 blue `46a2cd7`，前一版 gen101 green `e40f2b2` 保留為回滾。worker 沒有移動（這版沒有改 worker 會跑的程式），仍在 `98-release-e40f2b2.conf`。

- 上線前在乾淨 source worktree 跑完整 vitest（157 檔 1573 項）、web node test 249 項、render spec 208 項、兩個 tsc 全過；改到的檔案 biome 無錯（HEAD 本來就有 40 個檔案 lint 錯，與這次無關）。
- 切換前重跑 traffic `tools/import-blog-tags.ts`：876 筆 AI 初判、3 票，沒有新列（舊表最後異動 2026-10-19 22:41 UTC，917 筆 assignment、3 票）。
- 正式站匿名：`/blogs/`、`/blogs/?genre=food`、`/blogs/kocpc/`、`/articles/` 200，頁面有「標籤」、沒有「類型」「未分類」；`/api/catalog` 48 個標籤，`?genre=food` 與 `?genre=美食` 同為 68 個部落格（gen101 為 66：traffic 編輯清單的「美食」也算進來）；匿名投票與 `/api/me/blog-genres/kocpc` 回 401。
- 正式站登入（擁有者帳號，臨時 session 用完即刪）：`/api/me` 回 `admin: true`（traffic 判斷）；跨來源投票 403；對 kocpc「3C」投同意後 traffic `/api/v1/tags/kocpc.com.tw` 同意 0 → 1，收回後回到 0。

### gen103（2026-10-24 14:39，green `e41eac1`）

帳號頁投票數、每個標籤的 AI 理由、`reserved_tag` 與「還在準備中」的訊息、管理員覆寫保留 traffic 的寫法。前一版 gen102 blue `46a2cd7` 保留為回滾。乾淨 worktree 完整 vitest 1577 項中 2 項是已知的負載逾時（snapshot-full-caller、runtime-icons），單獨重跑通過；web 249、render 208、tsc 通過。

- 帳號頁（臨時 session，用完即刪）：擁有者「標籤投票」0 → 投一票後 1 → 收回後 0，與 traffic `/internal/v1/tags/voters`（via blog）一致；`votesUnavailable: false`。
- 對 kocpc 新增「藍營」→ 400 `reserved_tag`，traffic 沒有留下這個標籤。
- april-aries.github.io（blog 519）：traffic 已認得，讀取 200（目前沒有標籤）；對它不存在的標籤投票回 `genre not proposed`，不再是 `unknown_domain`。
- `tools/apply-blog-genres.ts --apply --slug kocpc`（在 release 目錄執行）：3C、軟體介紹、新聞三筆 AI 初判各自保留自己的理由，`updated_at` 更新為 06:40:21 UTC，`changed: 0`（標籤組合不變）。

## 回滾

1. gen103 有問題時 `tools/deploy-blue-green.sh switch blue` 回到 gen102 `46a2cd7`（標籤仍在 traffic，只少了這次的調整）。要完全回到舊表，再切回 e40f2b2（gen101，需重新 prepare）。舊程式讀寫兩張舊表，那裡停在切換當下：這段期間在 traffic 投的票、新增的標籤不會出現在舊版。
2. 需要保留的話，從 traffic 的 `tag_votes`／`tag_assignments`（`via='blog'` 或 `actor='service:blog'` 以外的）手動補回；traffic 端的資料不用動，下次再切過來時 traffic 仍是最新。
