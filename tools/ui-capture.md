# 小批次 UI capture 工具

`node tools/ui-capture.mjs plan.json` 預設只做離線 dry-plan，不讀系統gate、不載入Playwright、不發HTTP、不開browser。**目前所有新增capture已由使用者明令停止**；`--capture` 會在讀取計畫、載入模組或建立輸出目錄之前直接拒絕。不設環境變數或旗標解除，空間回升也不代表獲准；只能等使用者明確通知後另行修改。以下capture流程僅是未啟用的後續設計。本輪只測purefunctions與dependency mocks。

計畫JSON欄位：`targetOrigin`、`expectedSHA`（40字元commit）、`expectedBuildId`、`buildIdHeader`（實際可信回應的build identity header）、`pages: [{path:"/",width:1280},{path:"/",width:390}]`。capture另需 `playwrightModule`（既有安裝的module入口）、`quotaModule`、`artifactDir`（全新且實際位於 `/home/deck/.t3/userdata/` 的私有目錄）。不得為了跑本工具安裝套件或假造identity header。既有edge提供 `x-blog-release`；沒有可信BUILD_ID回應header的目標會拒絕保存截圖，應先由root批准identity驗證來源。

全域quota不是本機lock：`quotaModule` 必須接到跨thread的實際原子browser quota controller，export `acquire({maxBrowsers:2})`，回傳具 `assertHeld()`、`release()` 的lease；`assertHeld()`須從controller確認後明確回true，false/undefined/throw均拒絕。controller需原子限制所有相關sessions總browser數並維持租約；每頁前及保存前檢驗。**目前只定義provider介面，未整合現成全域controller，正式capture不可用。** 沒有已驗證controller就不能啟動capture，不可用固定true／本機檔案lock冒充。工具另在launch前以 `pgrep -fc 'chrome|chromium|playwright'` 作保守gate，>=2或讀取失敗即拒絕。Chromium自身多process不能被說成多browser，因此launch後live配額由controller證明，pgrep只留下實際診斷。此runner不能單獨證明未接入controller的其他thread是否遵守quota。

每批最多4張；固定viewport1280×900／390×900，`fullPage:false`，不做任意互動、登入或scroll。未壓縮估算width×height×4，總artifact預算50MiB；截圖停止線為112.5GiB，另保留512MiB餘裕，`/home`扣估算後至少留113GiB；目前絕對禁止新增capture，不能只因容量符合就執行。每頁前重新檢查load1<=12與磁碟；頁間至少5秒。若後續需要頁面下方證據，另開最多4張的有限scroll-position批次，不能取消fullPage限制。

任何newPage/navigation前註冊 `context.route('**/*')`：以URL hostname判斷GA/GTM/doubleclick，封鎖所有非target origin、非GET/HEAD、auth/private路徑及全部WebSocket；context DNT=1、optout initScript、SWblock、空permissions、全新session，沒有storageState/CDP接管。記錄僅blocked類別數量，不記request headers、cookies、query或身分。首頁TTFB probe是capture明確授權的獨立HTTP gate，僅固定blog/tag/youtube三站DNT GET，不記header/query；任站非200或>2秒即不launch。

每document回應要求 observed `x-blog-release` 與指定build header匹配；沒有證據／跨頁identity切換不保存。**正式目前未證實提供BUILD_ID可信header，故identity gate亦未ready；不得為了capture自行更動部署。** 截圖只記 `captured-unreviewed`，永不自行產生pass。儲存欄位為pathname（不含query）、viewport、UTC、SHA/BUILDID、bytes與安全gate。finally記實際stop/end及close時間；close失敗保持closed=false，沒有launch也不假造browser.close。aftergate/load安全且曾做beforeTTFB時才執行after三站TTFB；超負載時記skipped，不為了補log繼續probe。

舊repo外capture檔保持原樣。離線解析其regex literal及執行普通GA/GTM/doubleclick測例，確認實際單一反斜線且均可匹配；本工具改用精確hostname與default-deny，不宣稱修復不存在的雙重escape錯誤。

驗證：`node --test tools/ui-capture.test.mjs`。測試不launch、不讀正式DB、不HTTP、不build。
