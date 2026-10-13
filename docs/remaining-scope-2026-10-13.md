# 剩餘 scope 與可離線工作

盤點基底：本次 fetch 後 `origin/main` `00d050198e46de658ffe0b75b253bacf450bfe83`；最新 source 進度見末段，正式版不變。本文件依原使用者交辦、現有 source、既有 artifact 和 UI ledger；沒有新正式 HTTP／DB 查核，不把舊數量當即時數據。正式最後確認為 green／gen5 `4cc7bcd`。UTC10:10 起建置名額仍在 tag；SM 不新增建置或截圖，blog 不占 Mint 共用 DB／API 鎖。

**不是只剩等待。**完整詞庫切換、F3 搜尋資訊與正文索引接線、B2 consumer、引用解析與部分讀者功能仍有 source 缺口。下表的「可離線」是可以在沒有建置、capture、正式 probe 或 Mint 鎖時推進；最終畫面／正式資料驗收仍要依候選產物順序執行。

tag 的473萬詞池只代表上游曾有標籤，**不是 blog SEO 話題頁的母體**；頁面與 sitemap 仍依 blog 自己累積、目前可公開的文章命中證據。沒有 blog 文章命中的詞不建立頁面。

## Blog owner：F3、F4 與 B3/F1 consumer

| 項目 | 尚未完成／不等同已完成的部分 | 可離線做 | 一定要等的部分 |
|---|---|---|---|
| F4 被動輸入 | gen5 313站0detected／260unknown／53未觀測是舊正式結果；feed/history/favicon接線在64cbea3，未部署 | source／mock／已存HTML證據覆核已完成；可以補更多有真實證據的離線 fixture，不增加抓取 | Mint同產物candidate、被動既有正常回應寫入、Alina／Carol／timdream真實observedAt與版本證據，正式coverage與畫面 |
| F4 coverage與UI | source已有detected／unknown／failed／blocked／not-observed、CMS與CDN區分，但全狀態不是全部pass | 檢查欄位／多筆少筆／失敗保留的契約；缺source時先修mock | 新SHA／BUILD_ID的/tech/與blog技術區1280／390、兩色、表格互動與正式Chrome驗收 |
| F3 搜尋命中資訊 | 有界posting reader／producer在1af0b44；本輪已補前端歷史索引coverage與證據欄位，尚未部署 | **本輪source與mock已修**搜尋parser／coverage／articleId／matchVersion／contextSource，由既有Opus作者、Sol獨立review | 0023正式additive apply、同產物candidate隱私／成本、真文anise.tw/290726的『蛤蜊絲瓜』畫面；flag仍off |
| F3 正文索引接線 | manual最多10ID producer，加上default-off的content/RSS/history/relations真實commit後hook與既有BullMQ consumer；尚未正式啟用／完整回填 | [adoption契約與實際caller](search-index-adoption.md)已完成106 mocks與獨立review；仍需scoped repair／crash gap的實際運維，不以queue ack冒稱indexed | candidate、正式可公開body選定回填與成本／版本驗證；索引覆蓋不是全站全文完整性 |
| F3 relations coverage | 舊185／18838與失敗分類已盤點；不代表目前coverage提升，未知target仍多 | 用已存完整正文與parser version契約準備有界reparse；預算deferred、badbody、blocked分組，不重建relations | 正式小批reparse、觀測進度／分母；額外抓取仍守robots/SSRF/每日預算，不能以fixture改寫真coverage |
| F3 引用target／搬家 | 本地alias helper與原URL exact target ID不足以證明文章canonical或跨網域轉址；gojp→gogojp真證據仍待核 | canonical／alias trust規則與否定cases、target resolver的有界契約可先寫 | 正常許可抓取的逐跳redirect／ownership證據、gogojp↔bobowin兩方向原文章與各自日期；不猜alias，不包成同期間交流 |
| B2 三類證據 | 直接引用／非正文／共同native tags已有UI；文字相似default-off；profile已接最多3對／6篇的直接正文引用配對，非NxN | consumer與既有Opus UI完成47 backend／48 SSR和非作者source review；ready／unavailable／insufficient明列，preview只公開短摘要 | 同產物candidate各類證據畫面／隱私，真資料驗收後才考慮enable；不得做無界NxN、不得叫抄襲或交流 |
| F3 作者／person／網站 | luckbear作者與anise站點ID分離已保存；不是完整person／網站各自tags與文章證據bridge | 原生作者／站點tag契約與來源／版本／文章ID整合可以mock；不凭筆名跨站合併 | tag F1版本化person／共用標籤契約的實際可用範圍，candidate真資料映射與畫面；不等於新增人物圖像功能 |
| B3 / F1標籤consumer | client／store／manualsync／topic UI已有；0021–22已套，雙flag仍off且未同步 | 使用既有版本化契約mock补缺失／授權／canonicallabel cases，source修訂可做 | **上游tag F1 relations/visual正式版與契約確認**、隔離readiness、10標籤小批sync與ready/missing/unavailable畫面。完整詞庫端點不是F1替代品 |
| F2 | 本thread不是F2 owner | 如共同契約改動只修blog consumer | tag／YT owner完成其功能；不在blog重做另一站功能 |

## 原 scope：仍欠 source／資料完成或驗收

| 項目 | 剩餘工作與現況 | 可離線做 | 一定要等的部分 |
|---|---|---|---|
| 完整詞庫初次匯入 | active preview44,852並非完整4,733,073匯入；舊完整validator上限2M | **已修10M安全閥、single-copy-v1單份2GiB計費、原SHA原子續跑checkpoint、compact及5000group adapter**；手動full caller已接；SQLwarmup／atomiccutover／worker full排程仍需補完 | 上游版本化完整fixture相容確認；Mint容量／隔離DB／名額與實測量測後才stage正式，不整份進RAM |
| 10分鐘changes／每日對帳 | 正式仍window15分鐘；full ready不切current，changes不是正式同步consumer | read-only changes validator/client已完成37 mocks；chain仍unverified，尚需上游chain catalog契約、watermark／overlay／冪等、409重full及atomic發布 | 上游changes實際契約／世代可用性、candidate及正式配額／耗時；之後10分鐘poll＋daily full reconciliation，不自行重排tag |
| 話題品質／升溫 | NFKC／雜訊／高文件頻率title-only、365日baseline與recentShare/baselineShare/lift及UI已有source；完整詞庫切換後基準coverage仍需驗，文章本身tag的高頻命中通道也須核對 | corpus baseline／ratio契約與零分母／新站補收／缺資料測試，native category對應與人工來源優先；保留排除詞可查 | 同條件正式前後20名、基準coverage與版本、排行UI／候選驗收，不能用文章數冒稱比率 |
| 歷史文章遍歷 | 可續跑RSS/Atom/WP/Blogger/sitemap游標已正式，完整全站遍歷仍背景低速進行 | 邊界／中斷／分片缺口fixtures與停機／續跑文件 | 正式後台實際遍歷進度；robots/403/無官方索引是外部限制，不能繞過，也不把有限批次叫完整 |
| discovery循環 | blogblog/blogroll/正文候選、深度3、預算、自動驗證已做；所有低信心候選不是已收錄 | 去重／新來源／身份與台灣繁中優先規則／AI輔助契約可測，不變相交整批給使用者人工 | 真候選低頻驗證／收錄再探索、RSS/robots與daily budget；有證據才升格，不猜來源 |
| 9個unresolved種子 | 舊紀錄有無feed、商店、WAF/403、DNS等原因；不當成可以硬補的source缺口 | 用既有候選／證據核對，不對缺證據站直接收錄 | 官方索引、DNS或抓取許可變化後合法驗證；不需使用者替我找網址 |
| 圖示／文章圖片 | 原7失敗已修5、2受robots；圖示/API修正已驗。WebP/AVIF／正確尺寸的PSI改善仍欠source與量測 | 本站revision/srcset與轉換策略、尺寸/缺圖mock、平台圖示所有權測試可做 | native sharp新產物smoke、合法圖刷新、candidate各清單及行動Lighthouse/PSI三次中位數；受限兩站維持預設，不補文章佔位圖 |
| sky-quality AI | personal/簡介/topic、預算快取retry與人工覆寫已有 | evidence/self-description／prompt注入與modelalias／預算回歸；分類來源可覆核 | 實際合法小批資料、分類品質／繁中personal prioritization；不以AI結論替代身份/RSS/ownership或公開正文許可 |
| Similarweb與導流 | 已改tag唯一供應商client；blog不直打provider。traffic沒有direct/referral/search/social或referring sites | 既有client fixture／null/no-data/pending與UI說明可補 | **tag欄位提案與人類決定／上游API欄位**，未回欄位就缺值，不改tag；Similarity結果只候選 |
| 認證／reader/admin | Google/角色sub綁定、blog follow、個人RSS/OPML/API key已有，但真人登入與有權限UI未完成驗收 | 既有mock/isolated auth/CSRF/role/audit測試，anonymous/403樣式source可做 | 使用者本人Google授權、合法既有session/admin權限下畫面；不建立帳號/新權限，不把302當callback成功 |
| 作者/tag/community | scoped作者與provenance／admin manual tag已有；一般reader社群tag投稿流程未實作 | 權限／provenance／人工覆寫契約source可補 | 按原reader階段範圍落地後candidate/session／audit驗收；爬蟲不覆蓋人工標籤 |
| 原評估的reader延伸 | 收藏／tag與author訂閱／私人文章動態／可解釋推薦／公開curated collections在reuse規劃，尚無完整source | 後續source工作可做，但**與本輪F3/F4硬性驗收分開**；不把搜尋建議當推薦或follow當收藏 | 若納入原reader延伸階段，仍要candidate／合法session與畫面，不憑建議清單宣稱已完成 |
| 公開API | v1/OpenAPI/docs/限流/CORS/key/no-store已正式驗；新B2是experimental/internal而非v1 | schema／產生文件一致性與consumer測試；新欄位／新版本說明可做 | 新產物candidate及正式curl；不把API200當UI完成、不外送全文/私人資料 |
| SEO與GSC | 可讀URL/一跳301/canonical/sitemap/robots/累積話題已驗；Googlebot可信訪問log不足，沒有證據證明抓取 | 修過時文件、schema/JSON-LD／canonical／301 fixtures、Googlebot可信驗證方案只讀設計 | 候選與正式三類頁meta/JSON-LD/canonical、根據可驗IP/DNS的access資料才交可信摘要；GA/GSC後台由root，不自驗property |
| 薄頁noindex | 使用者尚未選門檻，這是決策hold，不能偷改 | 依既有分布與URL證據準備說明 | 人類決定；**不是F3/F4上線的必要条件**，現有sitemap政策維持 |
| GA | 元件、ID、safe events/opt-out已有；DNT/機器不能做收件驗證，不能送合成GA | consent/host/敏感參數剝除／eventpayload fixtures | 正常真人瀏覽的UTC事件與root後台對照；不以自動化合成事件補證 |

## 共同上線與品質尾端

| 項目 | 可離線做 | 一定要等 |
|---|---|---|
| 首頁compact/Suspense＋dark修正 | 7405f00/c11a304等已source＋review；可以補晚失敗/稀疏狀態mocks | Mint同一產物candidate、前後各5次time_total、真實dark computed contrast≥4.5與畫面；未宣稱正式提速 |
| 所有UI逐頁review | 已存在且SHA可驗的圖可繼續離線review；沒有圖則missing。24項仍pass0/fixed3/issues8/pending11/n-a2 | 新SHA/BUILD_ID全22UI模板、1280/390兩色、資料量/empty/error/權限/表格互動/tag對照；非作者真看圖、babysit正式Chrome驗收 |
| DNT/GPC capture證據 | 新runner完成mock/source；不回填舊欄位 | Mint capture，guard先於導航、DNT/GPC真觀測、GA/GTM零allowed網路與SHA/BUILD_ID；三站global Node HTML gate另列 |
| 原生sharp/SWC／worker | 路徑契約與gen5運行證據已review；可寫ELF/符號/realpath核對工具 | Mint產物、glibc2.39→SM2.41符號／incoming isolated smoke；不可import worker入口或借舊release依賴 |
| 新candidate B0回歸 | 小型barrier／mock／18169現有isolated可做，不碰Mint共用鎖 | 實際即將部署SHA／BUILD_ID同產物的HTML/API/RSC/Next-data/sitemap/search/graph撤下後下一請求驗收，no-store不改 |
| 同產物部署 | owner可離線準備receipt／slot對／rollback／additive migration清單 | tag→YT→blog名額、APP/OPS SHA/isolatedreadiness/globalguard，Mint一次建置→candidate獨立review→inactiveblue18174/18172→atomic switch；SM不build/capture |
| 正式驗收 | 整理既有receipt，不新增正式probe | owner獲准後三站200/healthz/OAuth/HSTS/no-store/CF DYNAMIC或BYPASS、正式畫面；舊release/rollback/備份保留 |
| 公開快取恢復 | 三層失效方案／privacy barrier source可做 | origin/Next/CF全部可靠失效與人類/root協調；兩CF規則維持Disabled，**不是本輪功能上線必要条件** |

## 本輪直接接續與證據

1. 完整池cap：兩個source檔的小修已做，4 suites／47 mocks、app typecheck通過；獨立既有Sol reviewer證據 `/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/vocabulary-capacity-independent-review.json`。10M是安全閥而非匹配RAM容量，保留2GiB stagedbytes、96MiB matcher；它不保證所有10M詞manifest都小於4MB，page內嵌manifest仍受2MB。沒有fullimport/cutover或changes啟用。
2. F3搜尋顯示：既有Opus5.5 session完成前端parser／coverage／文章證據與mock，非作者Sol已獨立review。原始執行log `.reviews/offline-quality/search-coverage-opus.jsonl`；兩項finding（prop漏接、metadata說明不精確）由同作者修正，兩份follow-up raw logs同目錄保留。SSR新檔的Write因工具限制失敗，root精確materialize作者tool input再機械格式化，另一Sol比對格式化原內容與現檔完全一致，沒有由root改寫UI。最終212項web node、6 suites／128 SSR、web typecheck與7檔Biome通過。證據 `/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/search-coverage-opus-independent-final-review.json`；source通過不是新BUILD_ID畫面通過，也不是正式『蛤蜊絲瓜』命中。
3. 這份清單合併兩個既有Sol instance的唯讀盤點，原始paths/model/UTC/hash在 `/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/original-scope-source-inventory.json` 與 `/home/deck/.t3/userdata/blog-sprint-4cc7bcd/remaining-f3-b2-scope-0a/audit.json`。沒有新agent、正式probe或Mint鎖操作。
4. 採納既有Opus非自審review的錯誤分類finding：固定byte-cap／invalid JSON回failed並記安全原因碼，既有staged run不排下一次抓取；network/503等仍保留有界defer，不保存raw message、不改current。補9 mocks（含fixture錯誤DB零SQL guard），既有18169小型snapshot suite保留已完成頁cursor／last-good並驗兩個wire失敗，全部只在disposable schema。未建立自動full scheduler；沒有已知snapshot ID的manifest失敗由caller看failed停止，不能宣稱已跨程序禁止任何未來manifest重抓。原logs `.reviews/offline-quality/snapshot-cap-and-wire-final-units.log`、`snapshot-wire-failure-guarded-isolated.log`，新runtime仍需candidate。

### 完整池正式 stage 的阻擋項

Opus原始非自審review `.reviews/offline-quality/scope-vocabulary-nonself-opus.jsonl` 為actual `claude-opus-5-5`、success／end_turn，沒有審它自己寫的搜尋UI。採納以下風險說明／排程順序，未把推論當實測：

- 早期legacy stagedbytes同時計入term JSON與page receipt；4.733M×雙份JSON可能先超2GiB（single-copy-v1已另解，legacy未改）。10M只放寬詞數validator，**不是已能stage完整池的容量承諾**。用上游版本化isolated fixture實測字節／DB大小後決定策略，不盲放寬磁碟上限。
- 每頁驗證目前要求帶完整manifest；pages/changePages與tier等額外欄位可能先超page2MB或manifest4MB。完整page實際契約（含label60限制／日期／origin／checksum）仍待對照，active preview不能證明完整page相容。若需改上游契約交tag owner，不自行修改tag。
- 早期全量checksum沒有跨批checkpoint；此缺口已由ce0a1a1的single-copy-v1原子標準SHA续跑修正，legacy契約保留。warmup與cutover仍是**可離線做**的source項，必須先於warmup／cutover完成，且保持上游原始sha256整體驗證；不能拿另一種hash當相同checksum。
- tiers/active/statistics/largePages目前是**未驗證的opaque原樣metadata**，會參與整個immutable manifest比較；不是可信active詞集合或已驗API欄位。暫不採猜測可變欄位而忽略身份差異／自行刪掉欄位的建議，先核版本化上游契約。後續consumer不得用cast把它當已驗資料。

adopted-body純契約也已直接接續完成：只保留已提交事件的primitive ID metadata、cap10、dedup，default-off／未接caller。排隊ack≠indexed，未知queue結果需repair、不重播也不rollback原文。非作者review實測兩個P2（ack自訂iterator／event getter重讀），原作者改為一次擷取local值再驗，原21 mocks加5個回歸全部保留。三檔最終hash/rawmodel/UTC在 `/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/search-index-adoption-independent-followup.json`。root同時跑adoption／producer／body-index測試与app no-emit，沒有DB/Redis/HTTP。不能把純helper當成durable queue、SQL commit proof或產品hook完成。

下一批離線順序：adopted-body **實際caller/queue接線** → B2有界consumer → 完整池契約/checksum續跑/warmup與changes → target canonical/轉址trust契約。person/shared-label的網路同步等F1明確契約與readiness；所有新UI仍由既有Opus作者，另一個既有Sol review。這些不是Mint新build/capture許可。

唯一handoff `/tmp/babysit/mint-queue/blog.md` 會引用本檔並釘每次提交後乾淨SHA。**目前有可離線source工作，不能標示「只剩等待名額／上游」**。每完成一小批commit/push、獨立review後更新source切點；是否併入第一份Mint候選由owner依完整契約及review決定，不為等功能擴張阻塞已安全可驗的首頁/F4修正。

## 最新離線批次：接線與續跑已做，正式仍未切換

這段取代上面保留的早期缺口描述。source commits均已push main及work/blog-mint-queue：

- `7c63f7d`：content commit/release後索引通知、既有BullMQ consumer／NX claim；預設off。
- `7e2817d`：RSS每source／history每task／relations批次的真實transaction staging與flush。
  root與非作者各106 mocks，另9 suites／24 migrations既有18169小型SQL通過。不是outbox；
  crash gap、partial cap與unknown結果需operator選定IDs repair，未驗nativeRedis。
- `8edbf12`：B2有界profile／Opus前端consumer，47backend＋48SSR；target owner freshcheck。
  source與SQL通過，不是candidate圖或正式全文命中。
- `9d8bfe0`、`ce0a1a1`：compact原manifest pin、可序列化標準SHA、single-copy-v1單份
  logical2GiB＋receipt8MiB，checkpoint/cursor原子commit。67mocks及1001詞小型SQL通過。
  0024 additive尚未正式apply，ready不切current；合作writer immutable，不宣稱hostileDB/TOCTOU。
- `8b77956`：read-only changes client，37mocks；after/target pin、409保留current，chain未驗
  不發布；不是已實作delta overlay或10分鐘scheduler。
- `80fa61c`：strip-Cf/NFKC/case alias，原raw labels不刪；full policy非ready時禁止hotpath重建。
- `c6822aa`：default-off 5000compact SOURCE；原500chunk checksum、2MB cap不變，bytecaponly
  有界fallback。45mocks／非作者review；P5 caller尚未接。總wire另含large attempt，不是只10。

throughput與保留期仍是正式stage阻擋項：nominal947large wire，scan約47.5小時，再另47.5小時
localvalidation＋policy/warmup；600/day與window共用，retry／中途resume／fallback會加成本。
現階段沒有full4.733M preview、RAM實測、上游已部署fixture或cutover，不以小fixture假裝容量通過。
原始model/transcript/hash/test paths見各功能文件與私有review索引。UI ledger狀態不提升。

下一批正在做full caller／policy／warmup／atomic cutover的拆解與非作者review，接著實作source；
changes跨世代catalog需上游明確契約，未取得以前保留read-only。仍有離線source工作，**不是只剩等待**。

### 實際 full caller 與單世代 changes 接續

`beb624c` 已接手動full source入口：explicit large5000＋single-copy-v1、CLI admission預設off，
共用600/day wire counter的full上限504，不double-charge原500logicalpages。18caller／root合併72
mocks、app no-emit、非作者Sol及Opus backend runtime通過；只是source，worker仍window15分鐘。
ready-pending-publication零wire，不再自動開第二份base；採N1技術admission，不在正式env開旗標。
詳見 [full staging限制與review取捨](vocabulary-full-staging.md)。

`7da7ab5` 單世代changes verifier完成：只有target.previousId===after才驗target原catalog；
after===target／零變更要明確empty ack，多代仍hold，fullbase transition需rebase。34選定mocks，
包含Node子process序列化續跑；wire-complete不表示overlay已套用，cutover/applied/published皆false。
[chain提案](vocabulary-changes-chain-proposal.md)仍待上游協調；可區分已驗full-image與本地base＋
verified-deltas身份，不強求先新增tree，但後者仍需overlay/count/provenance／daily對帳契約。

`cdb6151` 純publication v1完成9mocks；pins/highwater/keyset50/current/epoch/capped分離，
永久canVerify=false／scanned-as-of，不提供SQLfreshproof或current切換。後續scan-v2 DAO設計
將generation-local掃描與cutover predecessor分離，避免window每15分鐘前進使19k逐批掃描
反覆conflict；**不放寬v1 strict契約或刪測試**。dirty hooks未齊前仍不能verified／publish。

原scope仍34項，UI24項狀態不變。沒有新BUILD_ID/圖/正式probe、也沒有full4.733M容量實測。
本批source commits均push main/work分支；正在接SQLwarmup與F3 canonical trust的離線方案，
不把待Mint名額、上游契約與真人Google驗收混成已完成，也不標『只剩等待』。

### Staged SQL、canonical 與發布前界線

以下是接續離線成果，取代前段「尚未有 DAO」的描述，沒有改變正式 gen5：

- `9baf408`：純 target canonical resolver；獨立 Sol 88 項 mocks。只接受目前公開的
  primary publication、精確文章身份及完整已存逐跳 assertion，不根據 final URL 猜
  redirect。尚未接 native proof store／reconcile，真 gojp → gogojp 證據仍缺。
- `dc3f56e`：正文搜尋 producer 與 reader 都核對同一篇文章的 identity，保留 tracking
  正規化、意味 query ID 與 exact origin。32 項測試／獨立審查；仍是 4096-codepoint
  prefix index，不等於完整全文覆蓋或正式『蛤蜊絲瓜』驗收。
- `bb297b1`：generation-local staged scan DAO、0025 additive 與隔離 SQL fixture。
  28 mocks、18169 disposable schema／25 migrations／94 checks／九個 writer-commit
  barrier 通過；實際 500001-byte sentinel、window A→B→C、游標／命中原子性已驗。
  首三份失敗 artifact 保留，fixture 的 prepared `execute` array `IN (?)` 清理錯誤改用
  driver `query` 展開，新增真正空 corpus 斷言，未放寬 runtime／counter。
- `ba201fc`：纯 cutover intent，55 項 mocks／非作者 Sol；固定 predecessor、版本、
  TTL 與 retention claims。相符仍 hold、canPublish／canVerify 永遠 false，沒有 SQL
  CAS、dirty hooks 或 worker full 排程。採納 Opus M1–M4，但依賴仍不能以 metadata 代替。
- `8ccf284`：writer source drift 檢查，16 項 mocks／非作者 Sol，161 references／127
  dynamic（包含 read-only wrappers，不是 writer 數或覆蓋率）；symlink／descriptor／
  computed-callee 漏掃已修。它不是 DB write-admission，非 JS/TS、operator／restore、
  外部 SQL 與 caller/barrier 修改仍須另有契約。

私有正式 source／SQL proof：
`/home/deck/.t3/projects/blog-observe-tw/.reviews/offline-quality/staged-scan-v2-committed-proof.json`。
這不是最終 Next build 的 B0 HTML／RSC artifact，沒有借用舊 BUILD_ID 宣稱候選已驗。
source 與 review 說明見 [staged scan](vocabulary-staged-scan.md)、
[writer drift](topic-writer-audit.md)。0024／0025 均未在正式資料庫套用。

下一個可離線 source 項目是新 full generation 的 reader 相容契約與 dirty writer／
barrier 接線；先釐清 title-only／legacy fallback hash、owner/provenance 與 cleanup
版本，不能放寬 freshness 來讓 warmup 過關。完整池 preview、changes 跨世代 catalog、
overlay／watermark／daily reconciliation 及 candidate／UI／正式驗收仍 pending。
UI ledger 維持 24 項：pass 0、fixed 3、issues 8、pending 11、n/a-ui 2。
