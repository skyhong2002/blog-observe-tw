# 首頁正文引用與 tag 詞庫展示品質

本批 source 基底：fetch 後的 `origin/main=43d17900c24efae6879bf075d1c576ba74d6a3e8`。
正式仍為 blue/gen12/43d；使用者在 UTC12:05 已驗收首頁8筆話題、entity顯示、
1280/390與opt-out GA0。這份 source 尚未建置／部署，部署名額在 tag；
不把 source/mock/唯讀SQL當 candidate或正式新畫面通過，F3歷史全文仍pending。

## 首頁

移除中欄最新文章（最近發文hero與列表）及底部我的閱讀、沿著連結兩區。
中欄改文章→部落格的正文直接引用：來源站／圖示、原文標題與連結、
目標站與網域、證據類型、來源文章日期；觀測日期、解析版本、上下文
放收合的核對區。既有右欄最新更新部落格保留。只有直接連結證據，
不將共同標籤或文字相似叫成交流，不假造同期間的雙向互惠。

與 /relations 共用 `PUBLIC_RELATION` predicate；每個請求fresh SQL、
來源文章真實歸屬、來源／目標 verified、90天且非future、admin覆寫、
reparse-pending與無成功觀測排除。已知目標文章被刪或未來才發布時也排除；
不輸出原target文章URL或全文。contextSource固定公開enum body，
不選取或輸出內部extraction／正文digest。目標網域表示目前已收錄站的
home URL，不冒稱是當初外連URL／轉址或目標文章的完整原始證明。ROW_NUMBER先依文章ID＋目標部落格去重，
再取8筆＋1筆截斷訊號；unknown target、sidebar/blogroll/comment不出現在
此正文清單。外連只接受無credentials的HTTP(S)，不猜網址。

Homeoverview保留既有shape但posts/tags為空，加required mentions；
因此首頁不再查七篇最新文章或原生RSS標籤聚合。Fulloverview、作者／網站
metadata與原始標籤皆不改。既有讀取容量8、no-store、不共享promise維持。

## 不維護通用詞黑名單

所有文字雲使用本站已比對的新文易數tag-vocabulary排行，拒絕RSS或未知
來源列；不再直接把原站分類變成文字雲。不刪任何來源詞、原分類或人工
標籤。首頁用30天的home8；部落格頁保留原90天，文字雲與話題列表共用
同一個request-scoped public read；render不呼叫tag上游、不增加同路徑fetch。
標語／logo SSR，只有文字雲在Suspense中等資料。

不能直接以tag新聞24h前500詞作白名單：本輪唯讀查到其中不含美食、景點、
旅行，也沒有每天/blog/Uncategorized/未分類；這會過度排除部落格主題，
更不能作話題頁的存在母體。使用的仍是完整來源池在本站的已發布active
projection、原tag noise/noEqual規則，以及下述tag門檻，沒有另造詞典。

移植來源 `afe0a653fa8aae7e25a04a1d9fe87bf0400a2a39`
`app/src/jobs/tag-qualification.ts` 的broad門檻：至少3站、2站各至少2篇、
1站至少3篇。再沿用現有FREQUENCY_POLICY的2%文件頻率門檻，作用於
本次7/30/90天窗口：符合broad且超過2%文章命中的詞，排行只計標題命中。
判斷在SQL LIMIT之前，不把同一篇的title/body重複計。既有365天基準的
高頻詞規則仍存在，兩種規則的來源／期間明確分開；沒有新增排除詞清單。

這項window gate作用於該查詢的母體：全站排行可符合3站門檻；
單站profile排行先縮至該站，因此不會觸發3站的window gate，仍保留
既有365天基準與tag noise/noEqual。文字雲改為tag-vocabulary provenance，
不是對單站另套一套通用詞黑名單。

只有ranking使用此read-time gate；topic detail、累積歷史證據、SEO話題集合
仍讀原證據，不改noindex／sitemap薄頁門檻，不因退出排行就消失。
POLICY25670024...／MATCHER4fbe490e...與normalization、upstream vendor／
no-equal檔皆不改，避免重演讀不到舊資料的gen8回歸。

API `matchingPolicy.displayGate` 提供來源、版本、門檻；排行row的
`matchingReason=high-window-document-frequency-title-only` 說明正文降權。
若詞落到顯示上限之外，owner可用唯讀指令查核正面證據與門檻：

```sh
# BLOG_DB_URL由既有私密env注入，不把值貼到輸出或Git。
npm run topics:display-audit -- '每天' 30
```

查核在READ ONLY transaction，query有5秒上限；資料只計verified、公開日期、
原比對版本及正確文章hash的證據，沒有正式寫入。連線錯誤不印URL／key。
本文的upstream「已維護池」仍是blog實際published observed-window projection；
473萬詞全量匯入／切換尚未完成，不冒稱已用全量tag快照。

## 同條件唯讀SQL預覽（不是最終build驗收）

UTC 2026-10-14T12:34:59.322Z–2026-10-14T12:35:04.803Z，同一個READ ONLY transaction、30天、同一now、limit100。Before/after皆100，首頁引用5筆。原始preview未帶最終releaseSHA/BUILD_ID，因此不能當候選產物證明。

| 名次 | 修正前 | 篇數 | 部落格數 | 修正後 | 篇數 | 部落格數 |
|---|---|---:|---:|---|---:|---:|
| 1 | 美食 | 216 | 46 | 美食 | 216 | 46 |
| 2 | 每天 | 144 | 68 | 景點 | 87 | 36 |
| 3 | 景點 | 87 | 36 | AI | 67 | 21 |
| 4 | 飲料 | 172 | 57 | 餐廳 | 59 | 21 |
| 5 | 歷史 | 146 | 62 | 住宿 | 82 | 21 |
| 6 | 品牌 | 165 | 57 | 人氣 | 57 | 20 |
| 7 | 甜點 | 134 | 51 | 傳承 | 52 | 33 |
| 8 | 遊戲 | 140 | 51 | 飯店 | 69 | 17 |
| 9 | 拍照 | 166 | 54 | 老字號 | 57 | 31 |
| 10 | 旅行 | 164 | 58 | 牛肉麵 | 56 | 24 |
| 11 | 火車 | 148 | 52 | 人生 | 56 | 34 |
| 12 | 海鮮 | 152 | 47 | 復古 | 54 | 34 |
| 13 | 伴手禮 | 129 | 42 | 咖啡 | 32 | 18 |
| 14 | 吃到飽 | 134 | 40 | 療癒 | 55 | 32 |
| 15 | 排隊 | 143 | 41 | 信義 | 52 | 29 |
| 16 | 經典 | 166 | 54 | 發展 | 54 | 35 |
| 17 | 自由 | 162 | 45 | 東區 | 52 | 26 |
| 18 | 口味 | 177 | 46 | 親子 | 26 | 18 |
| 19 | 天氣 | 133 | 54 | 太陽 | 53 | 33 |
| 20 | 標準 | 127 | 56 | 綠色 | 56 | 34 |

每天由第2名、144篇／68站移出前100；不是刪詞。另一個時間点audit UTC 2026-10-14T12:46:22.978Z：公開母體2896篇、144命中／11title／133body、68站，35站至少2篇、最大13篇，比例0.049724>0.02，所以只保留11篇標題排行貢獻。兩筆不同now不是同一交易，數字不得混合為同一快照。

Uncategorized/blog在當時published canonical pool未找到；未分類已存tag-noise；
三者仍可在原始RSS/分類資料查核，但不送入共同詞彙文字雲。沒有人工
新增「每天」等黑名單，其他泛用詞若有明確標題證據可能保留，不宣稱語意
上的所有通用詞都已消失。

## 驗證與發版

目前416backend＋8個隔離目標安全檢查／223Node／167SSR與app/webtypecheck、API生成文件check通過。
首次失敗是舊home7篇文章的source/mock期待，已改為新正文引用契約，但
保留fresh-read barrier、容量限制、future/hidden SQL、malformed payload與
真consumer render檢查。Opus5.5作者不做自審；既有Sol做全批整合source
review，另Opus5.5只審Codex backend。獨立Sol初審提出DN1內部hash與DN2驗證缺口，兩者均採納。
Opus5.5後端審查的三個條件式疑慮，分別由觀測表主鍵、既有刪除／
可見狀態模型、文章＋詞的GROUP BY確認不成立；保留理由，不把初審
無blocker當成未發現DN1的證明。

新增home-display隔離suite（尚未執行）：真SQL測2%以下／等於／以上、
title/body去重與title保留；existing relation-visibility fixture對新home SQL
測seed/rejected/moved/future/delete/owner的A讀取→commit→fresh B完成→A
放行，含未受影響內容保留、admin hide、nonbody/unknown去重。原ranking
freshness與policy golden保留，兩種查詢計畫用相同gate比較，不拿掉容量
或fresh-read斷言。需先交核對才能跑18169拋棄schema，絕不跑正式DB。
初次大批測試過度並行有5次5000ms timeout，原log保留；降低至兩個worker
後416/416通過，沒有修改timeout或刪測試。

所有review在ignored .reviews或私有
userdata，source review不是實際看圖；新candidate1280/390/dark、B0同
BUILD_ID barrier/SSR/RSC仍待取得名額與 exact命令核對後執行。

新程式沒有migration，code-only發版沿用既有備份，不新寫完整SQL備份。
目前正式blue43d/green4cc不動；green的服務、release、回滾、備份與所有
worktree全部保留。先交build命令；只能在babysit核對與名額放行後起跑；
candidate以同產物做B0／主要圖非作者review，切換另交核對。CF/WAF/
兩條Disabled規則、no-store/DNT/零GA與所有既有閘門照舊。


## 獨立 source review 完成（仍非 candidate UI 驗收）

既有非作者 GPT-6.1 Sol 的修後 GO：
/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/display-noise-home-independent-source-followup.json
SHA-256 fea3bc9f9b2430806a8278f5c4e22cbe4cc94858c0a4473f0cf87312e0e607fc。
逐檔 hash、model、UTC、raw log 均在收據；reviewer 自行
16 backend／28 SSR／20 Node 通過。另 guard test delta：
/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/display-noise-home-guard-delta-review.json
SHA-256 4270c309c484c3ad149856751c70f9a8fc46a3859e16fcb312bfb4377fce9d5a。
兩項 fixture review 建議也採納：SQL integration 入口先驗證拋棄 schema，
A 的 early SQL failure 會 reject，不讓 barrier 卡住；cleanup drain 不跳過 restore。
以上是 source/mock review，沒有任何新 BUILD_ID／截圖／正式切換。


## 真 SQL 執行補證

2026-10-14隔離18169的home-display suite先抓到完整coverage查詢的排序欄位
blogs歧義（ER_NON_UNIQ_ERROR）。修正為ranked.blogs/score/posts/topic_id；
保留失敗log，沒有切正式站。修後4個suite全通過：2%上下界oracle9 assertions、
persisted namespace compatibility、relation visibility69 assertions（首頁6種
commit/barrier）、ranking freshness11次SQL比較＋6種commit/barrier。
原始log在本worktree的 .reviews/display-noise/isolated-home-display-sort-qualified.log。
這是拋棄schema真SQL，不是正式DB或畫面驗收；新source須用新的產物SHA建置，
不變造先前f091的BUILD_ID。
