# F1 共用標籤離線契約

來源：tag-f1-release commit `b8d030c747f87c997800371e33e1ab2d168ad257`，`app/src/v1/openapi.ts:1816` relations、`:1755` visual、`:1653` person；API major 1（API_INTRO）。semantic.ts/publicRelations 與 tag-visuals.ts/imagePath 交叉確認欄位。tag main `d034b09f90819f11424891e9aecf7f510fb4c780` 尚無此 relations 契約；離線來源不證明正式部署。

新增純 parser 與合成 mock tests，不接 routes/sync、沒有 fetch 或 token。is-a 有向、多重分類；related/alias 對稱但不合併 ID。保留 approved、source/detail、inherited/depth、truncated；createdAt=null 不補時間。來源只有最多200筆新關係，祖先群組另外計；本機5000總項安全上限超過即 missing，不截斷假稱完整。

visual 保留公開帶版本圖片路徑及 Commons 授權／作者；source=null 不虚構授權，不等於可任意使用。僅允許已知 public visual-image path/query，禁止 credentials query。人物 person/avatar 已找到契約但本輪尚未實作 parser，明列 missing。payload 沒有 revision/asOf，故未知；source commit 不是資料版本。

未新增實際 client transport；consumer no-store、credentialed private/no-store 是後續接線要求而非已實測。公共頁可在 optional parser failure 時維持頁面，顯示 missing，不能捏造空結果或沿用資料。未建立帳號/授權、未讀token、未HTTP/DB/build/capture；未部署；GPT-6.1 Sol 獨立 source review 已完成，修正 pathname、Unicode 及容量三項 P2 後複審通過（`.reviews/b0-f4/f4-independent-source-review.md`）。12 個 mock tests 通過。

Parser 修正：上游 semantic validSemanticTag 的 Cc/Cs 驗證，不刪除 Cf、不正規化標籤。target tag60/group32、visual label120/emoji64/wikidata16、sourceDetail16、license64/artist255/pageURL512/licenseURL255依 schema widths；ID/path額外本機上限128/1024。原始object（含extra fields）用descriptor traverse檢查2MiB保守UTF8 JSON budget、depth16/node50000，拒絕getter/proxy/toJSON/cycles/bigint，不先執行任意JSON序列化。此2MiB是consumer安全budget，不是聲稱上游response limit。URL resolved pathname必須等於原pathname，dot segment不接受。

## 依賴注入 client（未接線）

shared-label-client.ts 僅明確注入 fetcher，不預設觸發global fetch；沒有頁面/worker caller、DB或result cache。重用TagApiTransport，新增精準 encoded單詞 relations/visual allowlist；origin仍限兩個、redirect:error、cache:no-store。單kind parser核expectedTag，schema mismatch→unavailable；404→missing（未支援端點）；5xx/傳输/bytecap/429→unavailable，不能當空結果。原有connection-only fallback、loopback/public spacing、public-only service token、beforeRequest計費、兩次429 retry皆保留。client共享Retry-After defer，在wire前重驗，避免已排隊另一kind繞過長限流。這是限流约束，非將relations失敗當visual缺資料。

payload revision/asOf仍missing，未保存不存在的版本。public token只在transport header，不回result/錯誤；沒有讀服務token或真HTTP。mock tests 7＋既有transport12共19pass，未部署/接線，待獨立review。

## B3 client 獨立review修正

上游schema/tag mismatch屬unavailable，不視為不存在；只有404或未發送的unsupported輸入是missing。既有純optionalSharedLabel helper未接線且新client不使用；不要用其missing結果替代client狀態。Retry-After保留完整可表示日期；超Date極值的數字安全defer到最大Date，不縮成7天提早重試。JSON串流fatal UTF-8 decoding拒非法序列。Caller必須重用同一client與共享beforeRequest budget，instance-local cooldown尚無跨實例協調；本輪沒有新鎖/新caller。

追加mock覆蓋direct public token與tokenread rejection、fallback後持續public、HTTP-date及10天冷卻到期/極值、短retry sleep期間另一kind不計budget、200空body/204/null/array JSON、非法UTF8；client17＋既有transport12共29pass。其餘redirect任意exception與stream timeout/cap原transport suite涵蓋；未真HTTP/DB/build。

最終獨立 review：Opus actual `claude-opus-5-5`、finish_reason=stop（`.reviews/f3-f4-independent/b3-client-opus.json`）；採納 B1 及 N1/N2，N3 以未接線及 caller reuse/budget 契約明列。Sol 非作者 instance 複審全部修訂無 blocker（`.reviews/b0-f4/b3-client-independent-review.md`）。client commit `ffe63cd`；正式資料與頁面接線仍未完成。
