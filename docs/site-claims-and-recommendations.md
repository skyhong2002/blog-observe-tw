# 網站認領、具名推薦與重查

## 第一批範圍

登入帳號、網站控制權、作者署名、收錄資格與文章索引分別處理。
Google 登入只證明持有登入帳號；認領證明當次能修改指定 publication。
`relationship` 是使用者聲明的作者／管理者關係，不是實名或文章著作權認證。
認領與推薦都不自動改寫既有作者、文章署名、公開名稱或 Google 個資。

讀者可從 `/queue/` 的網址表單與網址搜尋結果進入；帳號選單的 `/my/sites/`
載入私有的認領、推薦與重查紀錄，提供驗證續作、進度更新及撤回。
未登入者可看既有公開狀態，新增證據與重查必須登入且符合 same-origin。

### 認領

`POST /api/me/sites/claims`：`url`、`method`（`about`、`meta`、`file`）、
`relationship`（`author`、`manager`、`both`）、`confirm: true`。
確認聲明網站為符合本站收錄範圍的個人、作者共筆或社群部落格。

- 256-bit 隨機碼綁定帳號、publication、方式與 24 小時有效期。
- `meta`：首頁 head 的 `meta[name="weblog-verification"]`，content 必須完全相同。
- `file`：該 publication 路徑下的 `weblog-verification-<token>.txt`，
  內容須完整等於 `weblog-verification: <token>`（可有前後空白）。
- `about`：首頁實際連結的同 publication 關於頁，在內容開頭、第一個 h2～h6 之前
  的第一個直接子層 p 段落（驗證碼放在既有介紹前）。排除留言、討論、表單、訪客區與 script，不掃描整頁任意文字。
- 不能以其他網站、其他作者空間或任意轉址目的地的驗證碼取得權限。
- Medium 等共享路徑平台，尚無專用 adapter 時回傳 422；不能以任意貼文或留言冒充認領。
  可繼續具名推薦，認領爭議聯絡本站。子網域 publication 仍獨立驗證。
- 每帳號滾動 24 小時最多 10 個申請、30 次檢查；同申請檢查間隔 60 秒。

`POST /api/me/sites/claims/:id/verify` 在網路前先保留一次檢查。
網路使用既有 politeFetch：公共 DNS 釘選、每跳 URL/IP 檢查、識別 UA、robots 記錄、
延遲、timeout 與 body 上限，不在網路期間持有交易。
驗證後重新開交易並核對申請狀態、期限、人工決定及既有管理者。
同 publication 的 candidate row lock 序列化不同帳號的認領；後來者不能覆蓋已驗證管理者。
保存 proof URL、內容 SHA256、驗證時間與 append-only audit，token 不含帳號個資。
驗證碼可以公開，不是登入憑證。

### 具名推薦

`POST /api/me/sites/recommend`：`url`、`confirm: true`，可附最多 500 字 `reason`。
每帳號滾動 24 小時最多 5 個新的／重新啟用的推薦；同帳號同站只有一筆，重送不累積票數。
可補充既有推薦理由；補充本身不重設抓取冷卻。帳號歸屬供內部追溯，不公開 Google 姓名、
Email 或帳號 ID。推薦者不取得控制權，不代作者授權全文使用或公開聯絡資料。

### 重查與撤回

`POST /api/me/sites/recheck`：`url`。
新推薦、驗證成功及明確重查都可排入 `site_review_requests`。
每帳號滾動 24 小時最多 10 次新排程；同候選一小時最多重排一次，已 pending 的請求合併。
完成收錄的網站回傳 listed，這個 API 不等同強制重抓文章。

worker 的既有五分鐘候選排程先處理最多 10 筆讀者請求，再執行一般背景檢查。
讀者 HTTP 每 UTC 日有獨立 500 次額度，保留每 host 40 次上限；
帳號證據支持的新站每日最多 50 個，和背景發現、名錄及 operator 重查額度分開。
實際 budget／deadline 中止或寫入失敗保留 pending；host／准入額度用完等下個 UTC 日續跑。
重查結果只在 writer 成功保存後標為 completed，公眾待查清單的 pending 請求顯示等待。
沒有保證每筆五分鐘內完成。

`POST /api/me/sites/claims/:id/revoke` 或 `recommendations/:id/revoke` 僅撤回自己的紀錄。
撤回不刪除網站、文章或歷史稽核。已取出的候選證據在准入交易內再次核對，
撤回後不能繼續用快取證據收錄。已收錄網站不因推薦者撤回而自動撤下。

## 收錄判定 v6

- 首頁自介可來自唯一 h1 同層的介紹段落，不再限定 bio／intro class。
  仍排除文章、文章列表、留言及使用者 profile；以自我介紹語意取代「我」出現次數。
- 關於我們、複數敘述本身不再等同企業；單人自介規則仍不採複數聲音，
  作者共筆／社群網站可由有效帳號證據支持。明確企業／媒體／商店證據仍不通過。
- 新鮮且仍有效的認領／推薦可替代個人自介證據，其他 publication／內容檢查保留。
  不會把任何登入或勾選動作直接當成驗證成功。
- 帳號證據只支持相同 publication；轉到其他首頁路徑或網域時不沿用，須重新確認。
- 首頁明確宣告、RSS 身分及文章均屬於該 publication 的訂閱來源可以使用不同標題。
  沒有首頁宣告的猜測 feed 仍需完整名稱核對。跨站文章、留言 feed、空 feed 保持拒絕。
- 舊 discovery anchor 名稱可以由這次首頁的站名更新；原始探索證據保留。
- 具名直接提交可作為深度 1 的獨立發現來源，不受舊間接連結的失效父節點限制。
- 全部人工決定、已拒收的相同身分與 owner-exclusion 保留；准入 writer 仍短交易重查。
- `blogs.status_label` 是當時的收錄依據，不是目前管理權的即時徽章。

驗證與推薦不會修復沒有 RSS／文章 sitemap 的網站；現有 scraper 管線仍依原規則執行。
本批沒有新增 DNS、平台專用驗證、共同管理邀請、移交、爭議裁決、自動控制權續驗、
站主修改公開 metadata 或強制重抓文章。這些屬於後續管理功能，不能用聲明繞過驗證。

## 部署與既有候選重審

先套用 `0036_site_claims.sql` 再啟動本版 gateway／worker；兩者與 web 應使用同一 release。
migration 只新增四個表，不變更既有候選狀態、作者、文章或准入資料。
回滾程式時保留新表與稽核，不自動 drop，亦不自動撤下已收錄站點。

政策版本更新後既有候選會進入例行重審。需要優先處理舊誤擋時可先 dry-run：

```sh
node --env-file=/private/blog.env tools/recheck-personal-candidates.ts --limit 25
node --env-file=/private/blog.env tools/recheck-personal-candidates.ts --limit 25 --apply
```

工具只挑舊政策的個人身分不明、名稱核對失敗等候選；避開人工處理，
仍沿用 writer、鎖與 operator 每日額度，不直接批次 UPDATE 為 approved。
本次實作沒有部署、沒有套用正式 migration，也沒有對正式候選執行 apply。

## 驗證

```sh
npm run typecheck
npx vitest run app/src/site-identity.spec.ts app/src/ai/gateway.spec.ts app/src/crawl/candidate-validation.spec.ts app/src/crawl/candidate-promotion.spec.ts app/src/crawl/candidate-review.spec.ts app/src/blog-suggestions.spec.ts
node tools/test-integration.mjs --env-file /private/clone.env --suite site-claims
npm run test:topic-ui
npm run web:build
```

整合測試只允許 127.0.0.1:18169 的隨機 disposable database，套用所有 migrations。
含不同帳號同時認領、CSRF、登入、token 隱私、到期、冷卻、額度、撤回競爭、
不同 RSS 標題、獨立讀者佇列、人工決定與站主排除；並連同原准入交易測試執行。
Hawks 類型首頁有固定回歸案例，另以實際保存的首頁確認可取到原本漏失的自介。

本批驗收：後端 1,477 項（`npm test -- --maxWorkers=4`）、前端渲染 205 項、
網頁契約 251 項、隔離資料庫 103 項斷言通過；TypeScript、變更檔案 Biome 與乾淨的
Next standalone 正式建置通過。SQL writer registry 的新增動態參照僅來自認領／推薦
表的固定白名單與既有查詢插值，沒有新增話題寫入路徑。
