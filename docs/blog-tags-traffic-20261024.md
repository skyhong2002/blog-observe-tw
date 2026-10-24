# 部落格標籤改由 traffic.observe.tw 管理（2026-10-24）

部落格的「標籤」（原「部落格類型」，程式裡仍叫 genre）從這版起只存在 traffic.observe.tw（traffic repo `src/crowd.ts`，說明見其 `docs/README.md`「標籤投票」「服務 API」）。traffic 以網域為鍵，所有觀察站共用同一份標籤與票。blog 不再寫 `blog_genre_assignments`／`blog_genre_votes`；兩張表保留不刪，作為回滾依據（最後一筆寫入早於這版上線）。

## 對應方式

- 部落格 → 網域：`blogs.canonical_host` 經 `crawl/similarweb-client.ts normalizeSimilarDomain`（小寫、去掉 `www.`，與 traffic `publicDomain` 同一規則）。程式在 `app/src/blog-genres/traffic.ts`（`tagDomain`）。
- 服務：`http://127.0.0.1:18150/internal/v1/tags*`，token 與 Similarweb client 相同（`~/.config/observe-similarweb/blog-token`，或 `BLOG_SIMILARWEB_TOKEN`）。gateway 與 worker 同一個使用者，讀得到同一個檔，不需要新的 drop-in。
- 標籤 → 網址參數：traffic 的標籤名稱經 `genreKey` 轉成代碼，起始 20 個仍是 `food`、`travel`…（「美食」→ `food`、「3C」→ `gadgets`），所以舊的 `/blogs/?genre=food`、`/articles/?exclude=food` 照舊有效。其他標籤用自己的折疊文字（「個人」→ `?genre=個人`）。標籤長度上限改為 traffic 的 32 字。
- traffic 編輯清單（`site_metadata` 或試算表）的標籤，例如「個人」「科技」，來源顯示「編輯」，一律顯示，可以投票但票數不影響顯示（traffic 規則）；在目錄可以篩選，也列入目錄的標籤 chip。

## gen106 起：blog 不投票，導流到 traffic

比照 tag.observe.tw（/media/<media>/），部落格頁不再提供投票：

- 標題下第一行只有收錄說明（收錄狀態・資料來源與計算方式）。第二行是「標籤」、每個顯示中的標籤一個 chip（同 /blogs/ 目錄的標籤 chip，連到 `/blogs/?genre=<key>`），最後是「編輯標籤」，連到 `https://traffic.observe.tw/site/<domain>/#tags`（gateway 的 `tagsUrl`，網域同上）。連結只寫這四個字；網域只放在 title。沒有顯示中的標籤時寫「尚無標籤」；從來沒讀到過標籤時只顯示連結，不顯示錯誤。
- 右側的「標籤」卡片、同意／不同意、新增框、管理員覆寫與 `/api/me/blog-genres` 的前端呼叫都拿掉（「無法載入投票功能」不會再出現）。`/api/me/blog-genres/:slug`、`/genres/propose`、`/genres/:genre/vote|admin` 一律回 410 `{ error: 'tags_moved', url }`，url 是這個部落格在 traffic 的標籤區。帳號頁不再計標籤投票，也不再呼叫 `/internal/v1/tags/voters`。
- 讀取：部落格頁也讀目錄那份快照。有快照後沒有請求會等 traffic：過期的快照立即回答、背後重讀，重讀失敗就繼續用上一份；只有服務啟動後第一次讀取會等（失敗則 `unavailable`，頁面只顯示連結）。
- 部署檢查（`tools/deploy-blue-green.ts`）：`/blogs/kocpc/` 必須有「編輯標籤」；kocpc 的標籤在冷啟動時可能還沒讀到，最多等 30 秒，等不到只記 `slot_tags_pending` 警告、不判失敗。
- 右側「部落格標籤」卡片（作者在 RSS 用的標籤，連到 /tags/）是另一種資料，保留。

以下「讀與寫」中關於投票、新增、管理員覆寫與投票數的段落是 gen102–105 的行為，留作紀錄。

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

### gen104（2026-10-24 15:36，blue `ee77193`）

管理員的按鈕改為覆寫（traffic 0ea2840）。前一版 gen103 green `e41eac1` 保留為回滾。乾淨 worktree 完整 vitest 1578 項、render 208 項、web 249 項、tsc 全過。

- 正式站管理員（擁有者帳號，臨時 session 用完即刪）：`/api/me` 回 `admin: true`、`votes: { news: -1 }`（kocpc 已轉換的「新聞」隱藏）。對 kocpc「3C」按隱藏（vote −1）→ traffic `/api/v1/tags/kocpc.com.tw` 的 3C 為 `source: admin`、`adminOverride: "hide"`、同意／不同意仍是 0／0（沒有留下一般票）；`/api/me` 多了 `gadgets: -1`。按解除（vote 0）→ 回到 `source: ai`、`adminOverride: null`、顯示。稽核多兩筆 `genre.hide`、`genre.release`。
- kocpc、tech-girlz、soft4fun 的「新聞」隱藏前後完全相同（top1health 不在 blog 的已驗證部落格裡）。

### gen106（2026-10-24 21:16，blue `0c2892e`）

blog 不投票、導流到 traffic（見上方「gen106 起」）。前一版 gen105 green `0e6620d`（另一個 session 的「誰提到了」）保留為回滾。乾淨 worktree 完整 vitest 1571 項、render 203 項、web 250 項、tsc 全過。prepare 沒有出現 `slot_tags_pending`（冷啟動第一次就讀到標籤）。

- 正式站（headless Chromium，等 6 秒讓前端載完）：wiwi.blog「標籤 個人 生活 日記 技術 編輯標籤」、kocpc「標籤 個人 科技 3C 軟體介紹 編輯標籤」、april-aries.github.io「標籤 尚無標籤 編輯標籤」；三頁桌面 1280 與手機 390 都沒有橫向溢出，沒有「無法載入投票功能」，沒有同意／不同意。「編輯標籤」連到 `traffic.observe.tw/site/<domain>/#tags`，三個 traffic 頁都是 200 且有 `id="tags"`。截圖：`~/.cache/blog-observe-shots/gen106-tag-line/{wiwi,kocpc,april-aries}-{desktop,mobile}.png`。
- `/api/blogs/kocpc/genres/gadgets/vote` 與 `/api/me/blog-genres/kocpc` 回 410 `{ error: 'tags_moved', url: 'https://traffic.observe.tw/site/kocpc.com.tw/#tags' }`；目錄 `?genre=food` 68 個、49 個標籤照舊。

## 回滾

1. gen106 有問題時 `tools/deploy-blue-green.sh switch green` 回到 gen105 `0e6620d`（同時保留「誰提到了」；投票介面與右側標籤卡片會回來）。gen104 以前：`switch green` 原本回到 gen103 `e41eac1`（管理員又會看到同意／不同意，但 traffic 仍會把管理員的票轉成覆寫）。再往前的 gen102 `46a2cd7` 已不在 slot 上，需重新 prepare。要完全回到舊表，再切回 e40f2b2（gen101，需重新 prepare）。舊程式讀寫兩張舊表，那裡停在切換當下：這段期間在 traffic 投的票、新增的標籤不會出現在舊版。
2. 需要保留的話，從 traffic 的 `tag_votes`／`tag_assignments`（`via='blog'` 或 `actor='service:blog'` 以外的）手動補回；traffic 端的資料不用動，下次再切過來時 traffic 仍是最新。
