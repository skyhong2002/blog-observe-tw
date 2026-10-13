# 完整詞庫 caller（source 接線，正式未啟用）

本批基底 fetched origin/main `00d050198e46de658ffe0b75b253bacf450bfe83`，沿用既有importer、
topics lease與600/day persistent scope。這是離線source能力，不是正式stage／Mint工作許可。
worker仍15分鐘window，不新增排程；完整473萬池、native成本、warmup、current切換未驗收。

## 明確契約與預設

`runFullSnapshot` 預設disabled且零DB／wire。必須同時enabled=true、sourceMode=large5000、
largeContract=tag-a89908a-large5000-compact-v1、payloadMode=single-copy-v1；新路徑拒絕
legacy/small／未知factory契約。legacy低階sync相容API仍保留，CLI舊--full-snapshot於
config／DB前拒絕，避免無意啟動雙份payload的舊full模式。full工廠明示
transport-before-wire-v1並接同beforeRequest；這是可信caller契約，不是任意JS sandbox。

## 計費與續跑

只有transport每一次actual wire扣款，含429 retry／loopback連線失敗後public fallback、
large byte-cap後small fallback。importer每500logicalpage不重扣：5000group重用10logicalpages
仍1wire；failed large另計，不能把small cap10誤叫總wire10。source從persisted manifest恢復
page pin，active A即使current變B也續抓A，fresh source不為resume重抓/current。

full在共用600計數器上只允許used<=504，餘下96留給window；**不是每天各自504＋600**，
也不保證window每15分鐘都取得名額。window先消耗會減少full可用數，所有unknown outcome
保守不退款。full-start原1/day不變。每批最多50原小頁的scan＋validation；另policy有界
交易與deadline。預設120秒、最多600秒，lease／signal／deadline在wire與commit邊界驗。

只要有ready但未published的完整run，回ready-pending-publication，不讀/current、不開第二份
base；後續要由publication階段明確處理。此pause不代表所有ready的存在都可自動publish。
blocked／failed／deferred／conflict只回白名單status/reason及有界cursor／UTC retryAt，不輸出
raw message、body、token或DB URI。ready仍becameCurrent=false。

CLI必須明確--sync --full及source/payload/contract參數，並且
BLOG_VOCABULARY_FULL_STAGE_ADMITTED恰為字串true；否則在config／DB前回disabled。
此admission不由工具自動設定，也不取代owner／資源／隔離驗收許可。CLI才可進新路徑；它是手動source入口而非
scheduler，操作前仍需owner、資源、固定上游fixture／保留期／實際大小和隔離readiness閘門。
只執行未admitted的disabled-child fixture，未執行正式CLI或任何寫入，也沒有把新路徑偷偷改成background full同步。

## 驗收範圍與下一步

actual LargeSnapshotSource＋mockfetch驗1wire/10logicalpages、11wire的bytecap fallback、2wire
429retry，每次wire核對budget exactly once；不是單純重叫callback冒充接線。deadline用可控
clock，不靠sleep。未知契約／bounds／ready／lease／safeDTO與現有window回歸也保留。
非作者原始model／hash／UTC／transcript：
`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/full-snapshot-caller-independent-review.json`。
Opus拆解raw `.reviews/offline-quality/full-caller-cutover-plan-opus.jsonl`，actual claude-opus-5-5、success；
採納A1–A7（單次wire計費、ready防重開、明確模式、pinned resume、safeDTO、窗口餘額、CLI），
無worker重排／放寬quota。root最終測試log在 `.reviews/offline-quality/full-caller-root-admitted-final-units.log`。

下一批staged warmup必须獨立target/expectedCurrent/POLICY/MATCHER/CLEANUP pin、有界keyset與
fresh public/owner/date/body revision。不可改current來借runTopicsBatch，不可用globalhistory
writer或bulkcarry冒稱warmup完成；publication/CAS/changes overlay仍需獨立source與隔離驗證。

最新root驗證：full caller／large／transport／window／wire五組72 mocks，app no-emit通過。
採OpusN1增加CLI技術admission，N6補safe reason。未採N2繞deadline寫failure：仍守lease與deadline，
末段failure若未落DB只deferred，下次受控重驗，未知結果不造failed persistence。N3保留低階legacy
兼容測試API（worker不走它）；N4只在顯式手動入口查head並照常計費，不自行加scheduler／負面cache。
N5 exhausted只有caller assertion，未來SQL必須證keyset真的到底，純contract不能當正式隱私證據。

純publication續跑另完成9 mocks／非作者review：snapshot-publication-contract固定版本pins、水位、
keyset≤50、current/epoch conflict與capped/unresolved分離；永久canVerify=false，最多scanned-as-of。
沒有SQLwarmup／mutationdirtyhooks／schema0025／publication journal／current CAS。其原rawmodel/hashes：
`/home/deck/.t3/userdata/ui-review-blog-20261013/home-perf-independent/snapshot-publication-contract-independent-review.json`。
