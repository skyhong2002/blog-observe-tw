# 下一批同產物 release

依使用者「先部署，逐頁 review 部署後補」決定，candidate 通過以下技術閘門及主要
頁面非作者看圖後即可提請切換。不是略過逐頁 review：其餘頁面仍列 pending，
部署後繼續，不宣稱全 scope 完成。這份文件是準備清單，不是執行授權。

來源是 fetched `origin/main` 的 `5c15d995bc5ed3eba2b9bf3f10798f22f11f34b0`。
本批僅追加發版文件；最終 release 的完整 SHA／tree 由 commit 後寫入唯一交接檔
`/tmp/babysit/mint-queue/blog.md`。建置開始後凍結此 SHA，不偷偷併入其他改碼。
從最終release SHA寫入隊列起，到switch及觀察期完成，**凍結origin/main，連文件也
不再push**；其他source工作留在自己的未整合分支。工具逐步核main，若仍有人推進
就停止交核，不reset main、不繞過檢查、不自行重建已審產物。

## 本批內容与不啟用項目

| 內容 | 已審 source | 此次正式行為 |
|---|---|---|
| 深色次要文字、話題方法收合 | `c11a304` 及既有 Opus UI／Sol review | 新產物重驗實際對比度與手機文章優先呈現 |
| 首頁 compact overview／話題與 Suspense | `7405f00`、fresh barrier | 減少首頁資料量、串流主內容；no-store／zero TTL／不共用 promise |
| F4 被動接線 | `64cbea3` | 只觀察原有合法 crawler 回應，不另外抓站；不能把上線等同 coverage 已提高 |
| F3 搜尋與正文 posting | `1af0b44`、`ec8daf5`、`7c63f7d`、`7e2817d`、`dc3f56e` | 同篇 identity／owner／版本與 coverage；歷史正文搜尋及索引 adoption 未開的仍 off |
| B2 profile | `8edbf12` | 直接引用／非正文／共同標籤分開；文字相似 off，不稱抄襲或互惠交流 |
| B3、完整詞库 staging/proofs | 既有 source／private SQL evidence | 雙旗標 off；不切 current、不發布 full、不啟動新工作 |
| body owner guard | `ac8c04b` | 收窄公開條件，不放寬隱藏、拒收、搬家或未來文章的排除 |

正式 flag 按既有私有設定保存，**不得整份以 candidate fixture env 取代**。
`BLOG_SEARCH_HISTORICAL_BODY_ENABLED`、`BLOG_SEARCH_INDEX_ADOPTION_ENABLED`、
`BLOG_TEXT_SIMILARITY_ENABLED`、`BLOG_SHARED_LABEL_SYNC_ENABLED`、
`BLOG_SHARED_LABELS_PUBLIC_ENABLED`、`BLOG_VOCABULARY_FULL_STAGE_ADMITTED` 保持 off。
F4 collection/publication 分別核既有值，不因本批 source 已審就自動開新旗標。
不改 GA、DNT guard、Cloudflare／WAF，不啟第二個 worker。

## Candidate 必要證據

1. Mint 名額順序 tag → YT → blog；exact APP／OPS SHA、隔離 API／DB readiness
   與全站 guard 由 owner 核定。沒有 DB/API 時禁止拿正式服務替代。
2. Node 24.15.0／npm 11.12.1，鎖住 lockfile；nice 19、ionice c3，Next workers ≤2。
   全站 1 build／2 browser；磁碟起始 ≥40 GiB、低於30停自己建置，load1 ≤12、
   任一站 5xx 不開新工作，HTML time_total blog ≤6.17s、tag/YT ≤2s。
3. 一次建置記 source SHA／tree／BUILD_ID／compiled blue rewrite（gateway18174、
   web18172），完整 primary/standalone/dependencies manifest。capture 前後比對
   同一份 bytes；部署僅複製，不 npm ci、不 rebuild、不借其他 release 套件。
4. Mint glibc2.39 → SM2.41，逐 native ELF 符號需求／realpath／依賴與記憶體 sharp
   smoke；SWC 存在時也驗。不能只看 ABI137，不 import worker 入口、不連正式 DB。
5. **這個 SHA／BUILD_ID 的 B0**：barrier A開始讀→mutation commit→B完成→A放行；
   seed／hide／rejected／moved／delete／future、HTML/API/RSC（含 `_rsc`）、
   sitemap/search/graph 全覆核。保留原測試，不能以69項 private inspector代替。
   artifact 記 UTC事件、DB與gateway/web port分開、source tree、BUILD_ID、SHA。
   現有 private wrapper 固定18176/18177；使用前須接妥 blue compiled18174與
   隔離 gateway，不可直接宣稱舊wrapper已適用Mint。接線命令另交核，禁止正式fallback。
6. 首頁、`/tech/`、`/relations/`、一個 blog profile（含 F4/B2）、`/articles/`
   搜尋狀態及近期／歷史話題，各1280與390、兩色；主要 new feature off 狀態也驗。
   既有非作者 reviewer 實際看圖，無 blocker 才可上線。DNT=1、導航前 GA/GTM
   transport deny、zero allowed、真 DNT/GPC 欄位、network log、SHA/BUILD_ID manifest。
   其餘24項 ledger不自動升pass，部署後繼續 review。
   現有 `ui-capture.mjs` 的私有路徑是SM的 `/home/deck/.t3/userdata`；Mint 的
   capture runner／私有根／瀏覽器鎖需由OPS接妥并審過，不能直接把SM命令搬过去
   或为了截图改变owner/permissions。此项 readiness 仍pending。
7. candidate／正式首頁各五次 time_total 取中位數；記串流晚錯誤、no-store與非HIT。
   這是含網路／Cloudflare／origin的HTML時間，不是精確origin渲染或INP。

## SM 切換命令範本（只準備）

完整 SHA 對應的展開命令另存私有 command packet。下列命令中的 release、source
均须 realpath與immutable hash核定；不能以變動分支路徑混入未提交工作。

唯一順序：candidate技術與主要頁面通過 → 唯讀查pending migration → gzip備份並
驗證 → green仍active時套additive → 驗green在新schema仍健康 → 核舊green ready／
BUILD_ID／privacy floor與新SHA祖先關係 → 停inactive blue → record／prepare-built
→ switch → web觀察 → 單worker另批handoff。任何前置失敗都不能跳到switch。

```bash
bash tools/deploy-blue-green.sh status
# 確认 green仍active、blue確為inactive後，才停止blue舊pair；不刪舊release。
systemctl --user stop blog-observe-gateway@blue.service blog-observe-web@blue.service
# 產物回SM後比較Mint已審manifest與native smoke，才記錄／anchor既有bytes。
bash tools/deploy-blue-green.sh record-built "$BLOG_RELEASE_DIR" "$BLOG_SOURCE_DIR"
bash tools/deploy-blue-green.sh prepare-built blue "$BLOG_RELEASE_DIR" "$BLOG_SOURCE_DIR"
bash tools/deploy-blue-green.sh switch blue
```

**不能執行 `prepare` 或 `npm run web:build` 作為 SM 部署步驟。** `record-built`
只記既有bytes，不證明由誰建置；須另比對Mint provenance／capture manifest。
若 receipt已存在，禁止覆寫／重跑record；核驗既有receipt與anchor，另交核操作。
切換後留 green pair運作以供立即回滾，不 restart edge，不先停 active listener。

```bash
# 用本批已審工具，重新健康驗證舊green再切回，generation必須增加。
bash tools/deploy-blue-green.sh rollback green
```

F4被動接線也在 worker caller，不能只換web/gateway就聲稱已生效。最後已知單一
worker使用gen5及同release standalone NODE_PATH；本批應另交核worker設定handoff。
native smoke及migration成功後，先停止**唯一**worker並確認PID0，保留原drop-in，
新增較後序的release-specific設定只更換WorkingDirectory／NODE_PATH，旗標不變；
daemon-reload／start後至少60秒驗PID、cwd、sharp解析、NRestarts與健康，不以瞬間
active當成功，不開第二個worker。不能import worker入口充當無副作用smoke。
立即回滾須同時恢復worker至 `4cc7bcd688d2cf3d56f5cf1a796d0ff92aa150b8`
與其standalone NODE_PATH，原drop-in不刪。worker drop-in建立／回復的exact命令
及queue drain界線仍需補成受審packet；未就緒就保留舊worker，F4只算web source上線。
這是明確的worker hold，不把gen5 worker上的F4 source改動報成正式已生效。

## 備份與 migration

使用者本次要求 **先備份，再 additive migration**，優先於較早「additive不另備份」
的決定。最後已知正式套用至0022；實際pending須唯讀查ledger，不能按舊紀錄盲跑。
預計0023–0026只additive，包含前後版相容的索引／新表，沒有反向migration。

新增備份要直接gzip串流，owned新檔／0600、驗gzip與hash，估算完成後仍≥40GiB；
不寫未壓縮SQL、不刪舊備份，不自動restore。備份程式／私有credential option file與
實際大小仍需owner安全接妥，**尚沒有已核定可執行的backup命令**；不得用舊未壓縮
`.reviews/completion/backup.mjs`。backup精確命令、migration前後ledger和結果另交核。
確認新備份有效後，才於指定release執行：

```bash
node --env-file=/home/deck/.config/blog-observe.env tools/migrate-drizzle.mjs
```

此命令會處理所有尚未journaled檔案，故先核pending列表／SQL與預演結果。
MariaDB DDL不保證交易回滾；部分失敗停止、保留證據，不盲重試。
回滾只切程式到green/gen5，新增表保留；若相容性或migration不符合則不switch。

## 交核／正式验收

每一階段的exact命令、fresh三站health／load／space、manifest／review與rollback
命令交babysit核對後才執行。現在没有新 BUILD_ID、candidate圖、native smoke或B0，
所以只有source固定與準備完成，不是已可切流量。
切換後交 active.json（active、generation、commit、UTC）、BUILD_ID、HSTS
`max-age=86400`、HTML/API no-store、CF DYNAMIC/BYPASS無Age、OAuth S256 callback，
及三站200；babysit再做1280/390真實畫面與隱藏內容驗收。

發現blocker即以已驗green回滾，保留兩版、備份、worktree與所有舊證據。其餘頁面
逐頁review不中止；正式可見不等於F3全文coverage、F4真站coverage或全scope完成。
