# 設計評審截圖清單

每一輪都照這份清單截圖，ID 與 `tools/states.mjs` 一致。除了 `menu-open` 只截手機，每個狀態截兩張：

| 尺寸 | 視窗 | 像素比 | 截圖高度 |
|---|---|---|---|
| `desktop` | 1440 × 900 | 1 | 從頁首或指定錨點起，最多 2700 px |
| `mobile` | 390 × 844（觸控） | 2 | 從頁首或指定錨點起，最多 1688 CSS px |

固定條件：

- **資料**：weblog.tw 公開讀取的一次性快照（UTC 2026-11-12 18:19 起錄，698 個部落格、550,975 篇文章）。`tools/snapshot-gateway.mjs --record` 只轉送無 Cookie 的公開 GET，一次一個、間隔至少 2 秒，存到 repo 外的 `~/.cache/weblog-ui-hill-climb/snapshot/`。之後每一輪都以重播模式執行，**不再讀共用 tag-db**；沒錄到的路徑回 404 並記在 `misses.txt`。
- **時間**：瀏覽器時鐘固定在 `2026-11-13T02:20+08:00`；Next 伺服器以 `tools/fixed-clock.mjs` 移到同一時間，相對時間不隨拍攝日漂移。
- **登入**：`/auth/me`、`/api/me/*` 由快照 gateway 回答虛構讀者「林小美」（reader@example.com），追蹤三個公開部落格、有一把 API 金鑰。沒有真的 session，也沒有連到 Google。
- **外部資源**：部落格圖示、文章縮圖、tag.observe.tw 標籤視覺第一次看到時抓一次，存在 `~/.cache/weblog-ui-hill-climb/assets/`，之後重用；Google Analytics 一律封鎖。
- 字型以系統 Noto Sans TC 補齊 CJK；淺色外觀（另列深色狀態）；減少動態效果；DNT=1；同一時間只開一個瀏覽器。

## 頁面與狀態

| ID | 頁面 | 狀態 | 重現方式 |
|---|---|---|---|
| `home` | 首頁 `/` | 有資料 | — |
| `home-dark` | 首頁 | 深色外觀 | `prefers-color-scheme: dark` |
| `home-signed-in` | 首頁 | 登入後的頁首 | session=in，只截一屏 |
| `home-empty` | 首頁 | 空資料 | 所有公開讀取回有效的空答案 |
| `home-error` | 首頁 | 讀取失敗 | 所有公開讀取回 503 |
| `home-loading` | 首頁 | 從 `/about/` 點頁首標誌回首頁、資料讀取中 | 先正常載入 `/about/`，再讓公開讀取不回應，點 `header a[href="/"]`，1.5 秒後截一屏 |
| `menu-open` | 全站導覽 | 手機導覽選單展開 | 點 `[aria-controls="site-navigation"]`，只截一屏，只有 mobile |
| `blogs` | 部落格目錄 `/blogs/` | 有資料 | — |
| `blogs-dark` | 部落格目錄 | 深色 | — |
| `blogs-search` | 部落格目錄 | 搜尋「旅行」 | `?q=旅行` |
| `blogs-filter` | 部落格目錄 | 分類「科技」 | `?category=科技` |
| `blogs-no-results` | 部落格目錄 | 搜尋無結果 | `?q=zzqxv` |
| `blogs-empty` | 部落格目錄 | 空資料 | data=empty |
| `blog` | 單一部落格 `/blogs/wiwi.blog/` | 文章多（1,000+ 篇） | — |
| `blog-dark` | 單一部落格（同上） | 深色 | — |
| `blog-following` | 單一部落格（同上） | 已登入、已追蹤 | session=in，只截一屏 |
| `blog-sparse` | 單一部落格 `/blogs/seed-740/` | 尚未收錄文章 | — |
| `blog-not-found` | `/blogs/no-such-blog-zzqxv/` | 不存在的部落格 | — |
| `articles` | 文章 `/articles/` | 最新文章 | — |
| `articles-search` | 文章 | 搜尋「同樂會」（常見詞在正式站搜尋逾時，錄不到結果） | `?q=同樂會` |
| `articles-no-results` | 文章 | 搜尋無結果 | `?q=zzqxv` |
| `articles-empty` | 文章 | 空資料 | data=empty |
| `topics` | 話題 `/topics/` | 共同話題排行（30 天） | — |
| `topics-trending` | 升溫話題 `/topics/trending/` | 有資料 | — |
| `topics-dark` | 話題 | 深色 | — |
| `topics-loading` | 話題 | 從 `/about/` 點導覽到話題、資料讀取中 | 同 `home-loading` 的作法，點 `a[href="/topics/"]` |
| `topics-empty` | 話題 | 空資料 | data=empty |
| `topic` | 單一話題 `/topics/ai/` | 有資料 | — |
| `topic-dark` | 單一話題 | 深色 | — |
| `topic-not-found` | `/topics/zzqxv-no-such-topic/` | 不存在的話題 | — |
| `tags` | 探索標籤 `/tags/` | 有資料 | — |
| `tags-selected` | 探索標籤 | 選了「部落格」 | `?tag=部落格` |
| `tags-empty` | 探索標籤 | 空資料 | data=empty |
| `ranking` | 標籤收錄排行 `/ranking/` | 有資料 | — |
| `ranking-dark` | 標籤收錄排行 | 深色 | — |
| `ranking-empty` | 標籤收錄排行 | 空資料 | data=empty |
| `relations` | 關係圖 `/relations/` | 近 7 天 | — |
| `relations-30` | 關係圖 | 近 30 天 | `?days=30` |
| `relations-loading` | 關係圖 | 直接開啟、資料讀取中 | 公開讀取不回應，直接載入 `/relations/`，2.5 秒後截一屏（伺服器先串流的 loading 畫面）。第 1 輪的定義點的是 `/about/` 上不存在的連結，沒有發生導覽，第 2 輪起改正 |
| `relations-error` | 關係圖 | 讀取失敗（伺服器與瀏覽器重試都失敗） | data=error |
| `my-signed-out` | 我的閱讀 `/my/` | 未登入 | — |
| `my-signed-in` | 我的閱讀 | 已登入、追蹤三站、一把金鑰 | session=in |
| `login` | 登入 `/login/` | 一般 | — |
| `login-error` | 登入 | 登入失敗後返回 | `?error=failed` |
| `about` | 關於 `/about/` | 淺色 | — |
| `about-dark` | 關於 | 深色 | — |
| `not-found` | `/no-such-page/` | 404 | — |

**authors**：`/authors/` 在 main 已退役，永久轉址到 `/blogs/`（作者數顯示在目錄、作者名顯示在各部落格頁），截圖等同 `blogs`，所以不另列狀態；作者資訊的呈現由 `blogs`、`blog` 涵蓋。
**admin** 不在範圍。

## 參考對手

第一輪截一次，之後每輪重用同一組檔案；換到 skyhong-SM 時（第 6 輪）連同基準一起重拍一次，之後同樣重用：

| ID | 網址 | 對應的我方頁面 |
|---|---|---|
| `blogblog-club` | https://blogblog.club/ | 臺灣部落格名錄／首頁 |
| `ooh-directory-home` | https://ooh.directory/ | 部落格目錄 |
| `ooh-directory-recent` | https://ooh.directory/updated/ | 最新更新的部落格／文章 |
| `blogroll-org` | https://blogroll.org/ | 部落格名錄（分類與推薦）；原定的 Bear Blog discover 對自動化回 403，改用此站 |

## 重現

工具的資料夾預設是 `~/.cache/weblog-ui-hill-climb`（`REVIEW_HOME` 可改）：`snapshot/`、`assets/`、`private/`、`sets/`、`rounds/`、`builds/` 都在這裡，`pw/node_modules` 放截圖用的 playwright（目前 1.63.0，與本機 `~/.cache/ms-playwright` 的 chromium 1243 相符）。第 6 輪起在 skyhong-SM 上拍攝（12 核心；CJK 字型為系統的 Noto Sans CJK TC）；第 1–5 輪在 sky-server 上拍攝，兩段的截圖不混用。

```bash
W=${REVIEW_HOME:-~/.cache/weblog-ui-hill-climb}
# 0. 截圖用的 playwright（一次）；worktree 先 npm ci、npm --prefix web ci（nice／ionice）
(mkdir -p $W/pw && cd $W/pw && npm init -y && npm i playwright@1.63.0)
# 1. 快照 gateway（重播；只有第一次錄製時加 --record）
node docs/design-review/tools/snapshot-gateway.mjs --port 18391 --store $W/snapshot
# 2. 建置：基準版用 `git archive <main SHA>` 匯出的目錄，新版用 prepare-candidate.sh <commit> <name>；
#    等 load1 ≤ 10 且沒有其他 next build，nice 19／ionice idle
docs/design-review/tools/review-build.sh <checkout> http://127.0.0.1:18391
# 3. 啟動（固定時鐘）：基準 18392、新版 18393
docs/design-review/tools/review-serve.sh <checkout> 18392
# 4. 截圖（背景、可續拍）。每張之前等 load1 ≤ REVIEW_LOAD_MAX（預設 10），
#    而且本機沒有別的截圖瀏覽器（例如 tag 的 hill climb）；有的話先關掉自己的瀏覽器再等，全機只開一個
docs/design-review/tools/run-capture.sh 18392 $W/sets/baseline
NODE_PATH=$W/pw/node_modules node docs/design-review/tools/capture.mjs references $W/sets/reference
# 5. 組一輪盲測；評審結束後存原文
python3 docs/design-review/tools/make_round.py 6 $W/sets/r6
python3 docs/design-review/tools/save_review.py 6 opus-5-5 <評審最後一則訊息的文字檔或 .jsonl> "<備註>"
```

參考對手會連外拍攝，所以 `references` 不加 `OFFLINE=1`；它不經過快照 gateway，也不碰 weblog.tw。
