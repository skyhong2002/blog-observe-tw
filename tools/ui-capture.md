# 小批次 UI capture 工具

`node tools/ui-capture.mjs plan.json` 預設只做離線 dry-plan，不讀系統 gate、不載入 Playwright、不發 HTTP、不開 browser。使用者已明確授權解凍，`--capture` 可進入實際 gate，無額外人工批准欄位；授權不代表負載、延遲、容量或身份 gate 已通過。目前 blog 首頁實測延遲 gate 未通過，本輪只執行純函式及 dependency mocks，未 capture、probe、build 或連 DB。

## 計畫與身份

共用 JSON 欄位：`targetOrigin`、`expectedSHA`（完整 40 字元 commit）、`expectedBuildId`、`pages: [{path:"/",width:1280,theme:"light"},{path:"/",width:390,theme:"dark"}]`。capture 另需 `playwrightModule`（既有安裝入口）及 `artifactDir`（全新、空白、由目前 UID 擁有且 group/other 權限皆關閉的非 symlink 目錄，實際位於 `/home/deck/.t3/userdata/` 的私有目錄）。可選 `authorization` 僅記錄既有授權文字，不作第二次批准流程。不得為了此工具安裝套件或修改部署。

正式目標以實際 document 回應的 `x-blog-release` 及計畫指定 `buildIdHeader` 核對。缺乏可信 BUILD_ID 回應來源會拒絕保存，不可假造 header。

本機 candidate 改以 `localIdentity` 的真實 process receipt 核對，不要求或製造 header。例如：

```json
{
  "targetOrigin": "http://127.0.0.1:18176",
  "expectedSHA": "填入實際完整commit",
  "expectedBuildId": "填入實際BUILD_ID",
  "localIdentity": {
    "repositoryDir": "/home/deck/.t3/projects/blog-observe-tw",
    "releaseDir": "/填入既有immutable-release",
    "gatewayPid": 12345,
    "gatewayPort": 18176,
    "nextPid": 12346,
    "nextPort": 18177
  },
  "pages": [{"path":"/","width":1280,"theme":"light"},{"path":"/","width":390,"theme":"dark"}]
}
```

PID、commit、路徑及 BUILD_ID 範例不可直接當證據。工具核對 gateway/Next 的 `/proc/<pid>/cwd` 在 release 內、start time 穩定、LISTEN socket inode 真由該 PID 的 fd 持有；讀 Next cwd 的 `.next/BUILD_ID`。從兩個 environ 僅選出非秘密的 `BLOG_UI_ORIGIN=http://127.0.0.1:18177` 與 `BLOG_GATEWAY_INTERNAL_URL=http://127.0.0.1:18176`，不輸出其他值，確保瀏覽器與 SSR 指向隔離 gateway。未使用 gateway 的本機目標亦可只提供 nextPid/nextPort，但這不是本批 candidate 拓樸。

首次保存前另外從 repository 讀指定 commit/tree，逐一比對 release 中所有 tracked blob 的實際 Git SHA-1（symlink 比對 link 文字）；記錄真 tree hash、演算法與檔案數。它驗證已存在的 archive，不建立 release。每頁載入後及保存前再次核對 PID/start/cwd/socket/BUILD_ID/wiring，任一切換即停止。此 receipt 與正式 header receipt 分開記錄。

## 容量、配額與網路

每頁 `theme` 只接受 light/dark（省略為 light）；每頁使用獨立 page，navigation 前執行 `emulateMedia({colorScheme})` 並設定本站 `localStorage.theme`，保存前讀實際 `documentElement.dataset.theme` 與 media query 核對，兩者不符拒絕保存。manifest 記 observed theme，不能只靠 dark 檔名。每批最多 4 張，1280×900／390×900，`fullPage:false`，不任意互動、登入或 scroll。width×height×4 為保守未壓縮估算，總 artifact 預算 50 MiB。啟動及 prelaunch 時可用磁碟扣估算後至少 **40 GiB**；逐頁及保存前扣估算後至少 **30 GiB**，否則停止。load1 必須 <=12；每頁保存前等待至少 5 秒並重驗 gate。

內建跨專案共享 `/home/deck/.cache/observe-ui-quota/browser-{0,1}.lock`，固定兩個 slot，由 `flock --exclusive --nonblock --no-fork` 原子持有。Node holder 透過 nonce challenge、真 PID/start time、持續存在的子程序證明 lease；不是 mkdir/TTL 鎖或固定 true。檔案和目錄須為目前 UID 的非 symlink 私有檔案；鎖檔保留，不 unlink。正常完成先關 browser，再關 holder 釋放 flock；browser close 失敗則 `closed:false` 並保留 lease，交操作端確認遺留程序，不假稱釋放安全。

**這只限制採用同一路徑協定的 participating threads，未採用的 thread 不會被鎖住。** 每次 gate 另讀 `/proc`，按 Chrome/Chromium 無 `--type` 的 root 程序計數，renderer/GPU 子程序不當 browser；不明確的 root 結構拒絕。launch 前已有 2 個 root 即拒絕，執行中超過 2 個即停止。保留原始 `pgrep -fc 'chrome|chromium|playwright'`（例如 10）與 root 數量，不把兩者混淆。外部未合作程序在檢查之間啟動仍有競態，不能宣稱這是全機無條件排他控制。本輪只測協定 mocks，尚未執行真 flock/browser runtime 驗收。

任何 newPage/navigation 前註冊 `context.route('**/*')`，URL hostname 精確判斷 GA/GTM/doubleclick；default deny 所有非 target origin、非 GET/HEAD、auth/private 路徑與全部 WebSocket。context 帶 DNT=1、三站 opt-out localStorage、SW block、空 permissions、全新 session，沒有 storageState/CDP 接管。

網路 manifest 保留 attempted、GA、GTM、analytics、blocked 的原始嘗試次數；最多 500 筆安全欄位，超出明記 truncated 但計數繼續。只記同 origin pathname 或 analytics hostname、method/resourceType/decision，不記 query、header、cookie、body、foreign URL。計數代表被攔截的嘗試，不能宣稱已送達分析服務。外部圖片、字體、script 也被 default-deny 阻擋；manifest 明記此限制，不能把因此缺圖直接判成頁面 bug。本批 B3 關閉，不另行抓取代表圖。

candidate 與正式 capture 均先對固定 blog/tag/youtube 首頁做 DNT GET gate，記錄 status、TTFB 及完整 response 總耗時；任站非 200，或完整首頁 response 的 totalSeconds 超過 blog 6 秒／tag 與 youtube 各 2 秒即不 launch；三個固定 host 必須各有一筆有效 receipt。TTFB 另行記錄，只作診斷，不作放行門檻。單 response 最多讀 2 MiB，完整讀取 deadline 為 blog 6.5 秒／tag 與 youtube 各 2.5 秒，不保存內容。before gate 失敗不再重複 probe；只有確實啟動且關閉 browser、after load 安全才做 after 三站 gate。after 三站完整首頁 totalSeconds 亦套相同門檻，超標／無有效 receipt 時保存原結果並標 after_ttfb_gate、stopped，不刪掉已取得截圖或假稱完成。工具未因本次 mock 驗證而實際發送這些請求。

## 證據與限制

每張只標 `captured-unreviewed`，不自行判 pass。報告記 pathname（無 query）、viewport、UTC、真 SHA/BUILD_ID／身份方式、bytes、PNG SHA-256、gate 與 quota scope。finally 記實際 stop/end/close；未 launch 不假造 close，錯誤不回填成功。新檔用 exclusive write，舊 artifact 不改寫。靜態截圖不證明 sticky、互動或所有 error/empty state 通過。

驗證：`node --test tools/ui-capture.test.mjs`。測試只使用 mocks 與離線無效 CLI 計畫；不 launch、不讀正式 DB、不 HTTP、不 build。
