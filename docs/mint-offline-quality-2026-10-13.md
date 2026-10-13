# Mint 排隊期間的品質與首頁 source 修正

基底為 fetched `origin/main` 的 `b96ef9b9f77de86abdd45d3c821c743082c88761`。本批只改原始碼、mock 與既有隔離 MariaDB 18169 的小型合成 fixture；沒有新建置、capture、正式 probe、restore、staging 或正式資料寫入。正式版本仍 green／gen5 `4cc7bcd`，不是本批新畫面的驗收。沿用既有三個 Sol reviewer／作者 instance，以及既有 Claude Code session，沒有新增 agent。

## 深色次要文字

以 gen5 實際 CSS、既有 1280／390 深色 PNG 的指定文字與背景像素核對，zinc-500 `#71717b` 對 `#0a0a0a` 為 **4.1012:1**；zinc-400 同底預估 **7.5481:1**。修改 TopicDetail、TopicRanking、BlogTopics 沒有既有 dark override 的次要文字為 `dark:text-zinc-400`。這不是全頁 WCAG 通過：透明背景、未確定祖先、其他文字與新候選實際 computed style 仍須逐頁重驗。

前端由既有 `claude-opus-5-5` session 實作，另一個 GPT-6.1 Sol 獨立複審。CSS／舊圖 SHA、像素與計算證據在 `/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/dark-secondary-contrast-audit.json`；獨立數學與前端契約複審在同目錄 `frontend-contract-fix-and-contrast-independent-review.json`、`frontend-opus-final-source-followup.json`。舊 PNG 不是新 source 的畫面，不回填 BUILD_ID 或 DNT。

## Capture 的真實隱私證據

新版 manifest 分開記錄 expected SHA／BUILD_ID 與每頁實際 identity、guard 註冊／newPage／導航的 UTC、HTTP／WebSocket attempted、policy denied、真正成功 abort／close、allowed、action failure。guard 在任何導航之前安裝；abort／close 失敗即停止，不算成功攔截或存新圖。最多 500 筆安全網路列，超過仍繼續計數並標 truncated，不保存 query、cookie、token、response body 或完整外連。

`privacyConfiguration` 只代表設定；document DNT／Sec-GPC、navigator DNT／GPC 是另行觀測。DNT init override 明記來源，GPC true／false／null 如實記，不造值。舊 manifest 缺欄仍 unverified。GA/GTM 的零 allowed 只證明瀏覽器攔截層未允許，不是封包側錄或收件證明。

必要的三站首頁 HTML 健康 gate 不會因 candidate 是本機而跳過。它由 Node fetch 執行，在 `globalHomepageProbes` 另記 UTC、固定 host、attempt／status／time_total 與 configured DNT，**不混入 browser GA counter**。因此零允許 analytics 不等於零所有外送。private 路徑檢查含大小寫、percent decoding、dot normalization 與 reader，malformed／過深編碼拒絕。完整欄位見 [capture 工具說明](../tools/ui-capture.md)。這輪只有 mock，沒有真的 probe 或 capture。

## 首頁：減少工作量，不恢復共享快取

新增僅供首頁的 `/api/overview?view=home`、`/api/topics?days=30&view=home`。

- overview 只回 7 篇文章、30 個 native tag、8 位作者、10 個最近更新部落格，`blogs` 為空；不再讓首頁下載整份站點目錄與不用的欄位。完整 overview 路徑與其他消費端契約維持。
- 話題排行回前 8 筆與 sentinel，略過完整詞庫／coverage／額外 COUNT。單一 fresh-post CTE 在 join 詞條之前驗公開狀態、日期、正文版本與 hash；不先切掉可能進榜的詞，不改排行算法。
- 先 SSR 首頁主內容與最近文章，話題側欄以 server Suspense 串流；載入骨架只有空列，不假造排名或數字。失敗會進 error boundary，不能冒充空結果。若主體已串流，晚失敗可能仍是 HTTP 200，需在 Mint 候選驗錯誤畫面。
- 保留 `force-dynamic`、`no-store`、零 TTL、無跨請求 promise 共享與原容量限制。每個新請求都重新檢查 public predicate；沒有恢復 Cloudflare 或 Next 共享快取。

真 SQL 比較新／舊排行與 EXPLAIN 的小型證據：`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/home-compact-ranking-fixture.json`。同目錄 `home-compact-ranking-barrier-fixture.json` 涵蓋 seed／rejected／moved／delete／future／body-hash 六種變更：A 讀到舊資料後卡 barrier、另一交易 commit、B 新讀排除變更、最後才放 A，沒有 sleep、retry 或 TTL。A 在 commit 前開始讀的結果可完成，B 不承接 A 的 promise。

非作者 review 為同目錄 `home-compact-independent-review.json`、`home-compact-independent-followup.json` 與前端 final receipt。latestPost 缺欄的 P2 已採納，compact 驗證會拒不完整欄位；null／省略／合法 no-id 支援，full 契約不放寬。這些合成 fixture **不是正式容量或正式提速百分比**。正式／候選各五次 time_total、來源 SQL 時間與新畫面仍待同產物候選。原 blog 3.085s baseline 包含 Cloudflare、網路和 origin，不能寫成精確 origin 渲染時間。

## Worker 與 B2

worker 路徑契約要求 WorkingDirectory、單一 NODE_PATH 和 caller 提供的 resolved dependency realPath 都位於同一 release，不借舊版／全域 sharp。工具不 import worker 入口、不建 pool／job，回傳 nativeCompatibility=`not-tested`。既有 gen5 runtime／設定 review 補證保留；新 Mint ELF 與隔離 target smoke 尚待，Node ABI 相同不代表原生相容。

B2 增加預設關閉的單一明確文章配對 route；profile 仍是 `not-analysed`，沒有隱性 NxN 或自动配對。私有正文僅供有界 lexical prefix 計算，公開 DTO 明列允許欄位，預覽只來自已公開 `post.summary`，缺摘要不回退正文。版本、文章 ID、各自日期與來源分開；文字重疊不是引用、抄襲或交流。詳見 [B2 限制](../app/src/relations/text-similarity.md)。

沿用既有 Opus 的非自審安全 review：`/home/deck/.t3/projects/blog-observe-tw/.reviews/offline-quality/nonself-backend-security-opus.jsonl`，實際 model `claude-opus-5-5`、success／end_turn，排除它自己寫的前端。採納公開摘要預覽、raw bytes SHA（包含 BOM）、private route／Node probe 獨立記錄；不採逾時立即釋放容量 slot，因 uncancellable pool wait 仍在執行，提前釋放會累積無界 waiter。也不採跳過 candidate 三站 health gate，因使用者的全站資源限制仍適用。這兩項是有理由的取捨，不當作已關閉的 availability 風險。

B2 隔離 SQL fixture驗兩側 BOM、公開摘要、私有 prefix 不外送、撤下／future，保留 `A-read → commit → B-complete → A-release → A-complete`。較早原始 log `/home/deck/.t3/projects/blog-observe-tw/.reviews/offline-quality/final-allowlist-isolated.log`：8 suites／23 migrations，B2 14 checks；只有 disposable schema，不是新 build 的 HTML／RSC 驗收。

最後已把首頁 freshness fixture 接入同一個 `test:integration` 的 default all 與 `--suite f3-f4`，不讓隱私測試只存在於一次性的作者腳本。最新組合 log `/home/deck/.t3/projects/blog-observe-tw/.reviews/offline-quality/final-home-barrier-and-b2-isolated.log` 為 **9 suites／23 migrations**：首頁 9 次 golden SQL 比對與 6 組 barrier、B2 14 checks，其餘 F3／F4 皆保留。這個新結果不覆寫先前 8 組原始檔。

## 後續部署與仍待驗收

最終離線檢查：6 suites／50 focused backend tests、208 web node tests、5 suites／116 server-render tests、60 tools tests，app／web TypeScript no-emit 通過。31 個 app／web／新 pure tools 檔案 Biome 通過；既有 capture 檔的完整 format／import 排序尚未整理，略過這兩項的 lint 仍保留原有 optional-chain 建議，**不宣稱全 repo lint 通過**。各原始 log 在 `/home/deck/.t3/projects/blog-observe-tw/.reviews/offline-quality/`：`final-fixed-source-unit-tests.log`、`final-web-unit-tests.log`、`final-all-web-ssr-tests.log`、`final-fixed-tools-tests.log`、`final-app-typecheck-fixed.log`、`final-web-typecheck.log`、`final-app-web-pure-lint.log`、`final-capture-lint.log`。不把先前失敗／舊修訂 log 覆寫為通過。

完整 [Mint capture 清單](mint-capture-plan.md) 包含所有 22 UI 模板與兩項 n/a-ui，不縮小既有 scope。權威 [ledger](ui-review-ledger.md) 仍 pass 0／fixed 3／issues 8／pending 11／n/a-ui 2；source review 不能升為 UI pass。

唯一交接檔 `/tmp/babysit/mint-queue/blog.md` 需釘最終乾淨 APP SHA／tree、root 提供的實際 OPS SHA、隔離服務、global guard 與名額，不能用正式 API 代替 readiness。Mint 建置一次→新 SHA／BUILD_ID candidate 真實獨立看圖→同產物 incoming native smoke→inactive blue gateway18174／web18172 readiness→atomic switch；blue/green 是否仍相同由 owner 切換前重驗。若失敗保留 gen5，不在 SM 重建。code-only 不新增完整 DB 備份，沿用既有備份；0023 additive schema 仍未套正式，另經正式 schema／fixture 驗收才啟用歷史正文搜尋。

F4 真實三站被動新觀測、F3 anise 真文『蛤蜊絲瓜』、所有頁面與權限／空／錯誤／深色狀態、B3（仍 off）及正式效能都尚待驗收。沒有新正式站探測、沒有改 Cloudflare／WAF、沒有刪 release／rollback／備份／worktree，也沒有宣稱 scope 完成。
