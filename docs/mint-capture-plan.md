# Mint candidate 的逐頁截圖清單

狀態：**planned／pending，不是建置或 capture 許可**。SM 不新增 build、capture 或 restore；正式仍維持 gen5。Mint slot 順序 tag → YT → blog；root 確認 exact APP／OPS SHA、隔離 gateway／DB readiness、全站名額與 guard 後才可執行。唯一交接檔為 `/tmp/babysit/mint-queue/blog.md`。

所有 UI 頁面均拍 **1280×900、390×900，各 light／dark**。表格另拍手機橫捲終點與垂直捲動表頭，確認第一欄固定／縮小、每列單行、頁面本身不溢出。每個資料狀態按表分批，不能只拍首頁或拿 component review 代替逐頁 review。

## 優先批次（不縮減全站 scope）

| Route／候選例子 | 必須涵蓋的資料／互動狀態 |
|---|---|
| `/` | 真實形狀的多筆與少筆 fixture；compact overview；話題載入的 Suspense fallback、完成與失敗；無圖文章；登入導覽匿名狀態；不自動預取大量 RSC |
| `/tech/` | 多筆、少筆、detected、unknown、failed、blocked、not-observed；版本 unknown；只有 CDN／主機；failed 保留上次成功；篩選空筆、503、flag off；頁碼／排序／表格右端；方法展開 |
| `/blogs/alinalife-tw-567/` | 部落格標頭／圖示、最新文章、WordPress 證據或 unknown；不能用 fixture 猜正式版本 |
| `/blogs/carol-691/` | Blogger 證據或 unknown；相同頁面模板的少筆狀態 |
| `/blogs/blog.timdream.org/` | 只有保存的 generator 真實寫明版本才可顯示；技術、文章與方法 |
| `/relations/` | 正文方向箭頭、互相引用的各自日期；共同標籤不能叫交流；不同期間、空資料、錯誤、圖的上限；排行／方法／手機表格 |
| `/blogs/<gogojp-slug>/`、`/blogs/<bobowin-slug>/` | 由隔離 registry 提供實際 canonical path，不猜 slug。正文、blogroll／側欄／留言分開；同篇對同 target 只計一次；雙方日期相隔多年不能叫同期間互惠；未知 target 原因 |
| `/articles/?q=蛤蜊絲瓜` | 正文明確命中、文章 ID、match version、上下文來源／短摘要、原文連結；metadata 命中、沒有結果、索引不完整、timeout、隱藏後下一個請求；不送合成 GA |
| `/topics/風險管理/`、`/topics/榴槤/`、`/topics/國際市場/` | 90 天外的歷史 fallback、日期、已確認／待重新確認；30／90 天切換；方法初始收合／展開；深色來源／日期／同步次要文字對比度至少 4.5:1 |
| `/topics/<近期話題>/` | 多筆／少筆、歷史下一頁、空／missing／503／404；B3 off、missing、unavailable；若另行核准 B3 才拍 ready 上位／相關詞與授權圖片 |

## 全部頁面與狀態

| Route／模板 | 追加的逐頁驗收 |
|---|---|
| `/blogs/` | 多筆／少筆、搜尋／分類／排序／分頁、空結果、錯誤、每筆圖示 |
| `/blogs/[slug]/` | 除優先例子，再拍無文章／無技術／未知／搬家／拒收／不存在；引用區、方法與截斷提示 |
| `/authors/` | 多筆／少筆、空／錯誤、作者與站名分離、圖示／排序／分頁 |
| `/articles/` | 原始列表多筆／少筆、圖／無圖、搜尋／分頁／日期與錯誤；不得用佔位圖替代沒配圖的文章 |
| `/topics/` | 7／30／90 天排行、多筆／少筆／空／錯誤；詞庫來源與方法，不把排除詞當刪詞 |
| `/topics/[id]/` | 近期與歷史兩個模板；新／舊 URL 與 canonical；真正不存在回 404／410，合併回一跳 301 |
| `/tags/` | 詞彙多筆／少筆、排除原因／高頻詞、空與錯誤；不可把缺資料當零 |
| `/ranking/` | 多筆／少筆／空／錯誤；手機數字欄與長站名、排序／篩選 |
| `/traffic/` | 有資料／缺值／只有一個月份／來源受阻、圖表與比較／排序；數值缺失不補零 |
| `/about/` | 完整說明、資料來源、收錄／版權／聯絡、桌機／手機長頁 |
| `/api/` | 與同一 OpenAPI 產生文件一致；表格與範例長行／手機右捲、快取與限流說明 |
| `/api/status`（HTML） | 用途與狀態的手機完整文字、錯誤狀態；不能只拍 JSON |
| `/login/` | 匿名、錯誤、登入導向；真 Google 登入仍由使用者本人驗證 |
| `/my/` | 匿名導向、合法既有 session 的追蹤／OPML／RSS／API key 管理；不新增帳號或權限 |
| `/observe/opt-out/` | 初始／啟用／停用狀態、鍵盤；GA/GTM 仍全阻擋，不用收件驗證 |
| `/admin/` | 匿名、既有非 admin 的 403、合法既有 admin；沒有合法條件標 missing |
| `/admin/discovery/` | 同上，加多筆／少筆、篩選／批次／audit／空／錯誤；不對正式候選做測試寫入 |
| `not-found.tsx` | 候選真正 404、桌機／手機／深色與回主站連結 |
| `error.tsx` | 隔離 synthetic 503／串流晚失敗，明記合成；不故意打壞正式服務 |

`/healthz`、`/api/v1/openapi.json`、JSON `/api/status`、其他純 JSON 契約為 n/a-ui，附測試與 HTTP receipt，不能算替代 HTML 頁面的 review。完整模板／狀態的權威進度仍由 [UI ledger](ui-review-ledger.md) 記錄；目前沒有新 candidate 圖可以升 pass。

## 必須保存的證據

- 先安裝網路 guard 再建立 page／導航：HTTP 與 WS 的 GA/GTM attempted、policy denied、實際 abort／close、allowed、action failure；零 allowed 只證明攔截層未允許，不冒稱 packet trace。
- 三站全站 HTML health gate 由另一路 Node fetch 執行，保存 `globalHomepageProbes`，不混入 browser counters；configured DNT 不能冒稱觀測 wire header。candidate 仍須通過這個 gate，零 analytics allowed 不等於零所有外送。
- `privacyConfiguration` 與 document DNT／Sec-GPC、navigator DNT／GPC 的實際觀測分開；DNT override 明記 configured，GPC 不造值。舊圖缺欄仍 unverified。
- exact source SHA／tree、Next BUILD_ID、隔離 HTTP／DB ports、UTC、viewport、theme、PNG hash／大小、網路記錄、同產物實際 reviewer model／原始 transcript。圖片放 Git 外私有目錄，合法私人頁面遮蔽個資。
- 前後記 load、磁碟與三站首頁 HTML 時間；baseline blog 3.085s／tag 0.256s／YT 0.289s，閘門 6.17s／2s／2s。它是 Cloudflare／網路／origin 的 time_total，不是精確 origin render。全站最多一個 build／兩個 browser；load≤12、任一 5xx 停止，開始40GiB／低於30GiB暫停自己的建置。
- 標記外部圖片／字體被 default-deny 的限制；沒有圖示不能立即當成產品 bug。對比度用實際 computed style 與可確定背景；unsupported／opacity 不確定保持 unknown，不批量宣稱 WCAG pass。

本批每四張預算 1–8MiB，先拍優先狀態再補全部模板；全清單估算沿 ledger 保留 384MiB 截圖／文字餘裕，不含 node_modules、build 或 release。超過就停止重估，不刪既有任何版本、圖或備份。

先由非作者看實際 candidate 圖，通過後使用同一份產物部署，再交正式瀏覽器驗收。首頁排行晚失敗時，Suspense 可能已送出 HTTP 200 主體，之後交 error boundary；必須驗錯誤 UI，不拿狀態碼當「空結果成功」。

B2 profile新增狀態：`/blogs/<known-pair>/` outgoing已知target多筆與cap3、少筆、雙方各自文章日期／ID／版本；disabled、no-selected-pairs、insufficient-text、unavailable／撤下；展开方法與原文連結。1280/390各兩色，使用mock/candidate，不新增正式抓取或登入權限；計入原22UI模板與384MiB預算，未產生新圖。
