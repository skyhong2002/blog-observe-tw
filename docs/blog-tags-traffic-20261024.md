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
- 帳號頁拿掉「類型投票」計數：traffic 沒有給服務查每個投票者票數的 API，舊表又已凍結。
- AI 初判：`tools/apply-blog-genres.ts --apply` 改為呼叫 `PUT /internal/v1/tags/ai`（每 500 個網域一次），只取代 blog 自己的 AI 初判。traffic 每個網站只存一個理由，所以各標籤的理由以換行併成一段。

## 介面文字

一律叫「標籤」：部落格頁區塊標題「標籤」、「新增標籤」、「標籤資料暫時無法使用」；目錄 chip「全部標籤」，拿掉「未分類 N」（`?genre=-` 不再是篩選，會顯示全部）；最新文章「隱藏標籤」。管理頁原本的部落格標籤改稱「人工標籤」以免混淆。

## 回滾

1. `tools/deploy-blue-green.sh switch <前一個 slot>`，回到 e40f2b2（gen101）。舊程式讀寫兩張舊表，那裡停在切換當下：這段期間在 traffic 投的票、新增的標籤不會出現在舊版。
2. 需要保留的話，從 traffic 的 `tag_votes`／`tag_assignments`（`via='blog'` 或 `actor='service:blog'` 以外的）手動補回；traffic 端的資料不用動，下次再切過來時 traffic 仍是最新。
