# F1 共用標籤離線契約

來源：tag-f1-release commit `b8d030c747f87c997800371e33e1ab2d168ad257`，`app/src/v1/openapi.ts:1816` relations、`:1755` visual、`:1653` person；API major 1（API_INTRO）。semantic.ts/publicRelations 與 tag-visuals.ts/imagePath 交叉確認欄位。tag main `d034b09f90819f11424891e9aecf7f510fb4c780` 尚無此 relations 契約；離線來源不證明正式部署。

新增純 parser 與合成 mock tests，不接 routes/sync、沒有 fetch 或 token。is-a 有向、多重分類；related/alias 對稱但不合併 ID。保留 approved、source/detail、inherited/depth、truncated；createdAt=null 不補時間。來源只有最多200筆新關係，祖先群組另外計；本機5000總項安全上限超過即 missing，不截斷假稱完整。

visual 保留公開帶版本圖片路徑及 Commons 授權／作者；source=null 不虚構授權，不等於可任意使用。僅允許已知 public visual-image path/query，禁止 credentials query。人物 person/avatar 已找到契約但本輪尚未實作 parser，明列 missing。payload 沒有 revision/asOf，故未知；source commit 不是資料版本。

未新增實際 client transport；consumer no-store、credentialed private/no-store 是後續接線要求而非已實測。公共頁可在 optional parser failure 時維持頁面，顯示 missing，不能捏造空結果或沿用資料。未建立帳號/授權、未讀token、未HTTP/DB/build/capture；未部署；GPT-6.1 Sol 獨立 source review 已完成，修正 pathname、Unicode 及容量三項 P2 後複審通過（`.reviews/b0-f4/f4-independent-source-review.md`）。12 個 mock tests 通過。

Parser 修正：上游 semantic validSemanticTag 的 Cc/Cs 驗證，不刪除 Cf、不正規化標籤。target tag60/group32、visual label120/emoji64/wikidata16、sourceDetail16、license64/artist255/pageURL512/licenseURL255依 schema widths；ID/path額外本機上限128/1024。原始object（含extra fields）用descriptor traverse檢查2MiB保守UTF8 JSON budget、depth16/node50000，拒絕getter/proxy/toJSON/cycles/bigint，不先執行任意JSON序列化。此2MiB是consumer安全budget，不是聲稱上游response limit。URL resolved pathname必須等於原pathname，dot segment不接受。
