# 部落格觀察 API

本文件由 `tools/gen-api-docs.ts` 依 `app/src/v1/openapi.ts` 產生，請勿手改。

公開取用最新文章、部落格目錄、正文提及關係與話題排行；資料只涵蓋已收錄且驗證的部落格。

網站文件：<https://blog.observe.tw/api/>；機器可讀規格：<https://blog.observe.tw/api/v1/openapi.json>；API 狀態：<https://blog.observe.tw/api/status>。

## 使用規則

- 基底網址 `https://blog.observe.tw`。公開查詢使用 `GET`（也接受 `HEAD`），回傳 UTF-8 JSON。
- API 狀態頁：`/api/status`。瀏覽器以 HTML 顯示；以 `Accept: application/json` 取得 JSON，只顯示 API 狀態與端點用途。狀態包含 `ok` 或 `degraded`，以有界可用性檢查確認公開查詢的資料依賴可連線，最多快取 5 秒；不是每個端點逐筆測試。JSON 欄位為 `status`、`version`、`endpoints`（每項 `path`、`summary`）與 `updatedAt`；這是狀態回應產生時間，不是文章資料更新時間。此回應為 `no-store`，不提供內部主機或爬蟲維運資訊。
- 公開查詢不需要金鑰。每個 IP 每分鐘最多 60 次，超過回 `429`；回應帶 `x-ratelimit-limit`、`x-ratelimit-remaining`、`x-ratelimit-reset`。登入後可在 `/my/` 建立個人 API 金鑰（每人最多 3 把），以 `x-api-key: blog_…` 傳送，每把每分鐘 1000 次；伺服器只存 SHA-256 摘要，完整金鑰只顯示一次。無效或撤銷的金鑰回 `401`。為防止隨機金鑰探測，首次出現或未快取的金鑰須先通過每 IP 每分鐘 60 次的匿名／驗證桶；若該桶已用完會先回 `429`，請等窗口重設後重試。已快取且有效的金鑰不受此 IP 桶限制，每把每分鐘 1000 次額度不變。金鑰不能用來登入、管理或讀取私人資料，`Authorization` 不是本 API 的金鑰認證方式。
- 允許跨網域：`Access-Control-Allow-Origin: *`，不接受跨域 cookie 認證。瀏覽器可讀取限流標頭與 `Retry-After`；遇 `429` 請依 `Retry-After` 秒數退避。共享快取上的限流標頭可能是產生回應時的快照，不能當作即時餘額；來源站仍對實際到站請求計額。
- 時間一律使用 UTC ISO 8601（例如 `2026-10-12T00:00:00.000Z`）；「一天」指台北時間（UTC+8）的日曆日，`hours` 則是連續經過的小時數。未知日期回 `null`，不以抓取日期冒充發文日期。
- 匿名成功回應帶 `cache-control: public, max-age=0, s-maxage=120, stale-while-revalidate=180`。文章依各站 RSS／抓取排程分批更新，關係快照約每 5 分鐘，話題查詢快取約 2 分鐘；低頻部落格不因久未發文而失效。請至少間隔 120 秒輪詢，關係以 5 分鐘以上為宜。更新與歷史回補有延遲，不保證每輪都有新資料。
- 帶 `x-api-key` 或 `Authorization` 的請求與錯誤回應為 `private, no-store` 或 `no-store`，不得進共享快取。快取標頭不代表 CDN 已快取該端點；目前 Cloudflare 的專用 HTML 規則只涵蓋首頁。
- 錯誤格式為 `{"error":"..."}`：`400` 參數／游標錯誤、`401` 無效金鑰、`404` 找不到、`405` 不支援的方法、`429` 太頻繁、`503` 暫時無法提供服務。未知參數、重複參數與不合法的時間窗口會回 `400`。
- 路徑參數請 URL 編碼（例如話題 `rss:1` 寫成 `rss%3A1`），路徑結尾不要加 `/`。文章與目錄使用 `limit`、`cursor`／`nextCursor`；游標是不透明字串，請原樣傳回並保持原查詢條件。`nextCursor: null` 表示這個結果已到尾頁。
- `v1` 內只做向後相容的變更（新增欄位、新增端點）；移除或改名會先公告。客戶端應忽略未知的新欄位。既有站內 `/api/*` 介面保留給網站使用，不是本文件的穩定公開契約；本站沒有舊版 PHP API。
- 部落格文章、標題與圖片著作權屬原作者。API 只提供標題、原文連結、統計及最多 500 字元的短摘要，不提供全文；私人追蹤、個人 RSS、候選證據、管理及 AI 原始輸入不在公開 API。使用統計請註明「資料來源：部落格觀察 blog.observe.tw」，閱讀文章請連回原站。
- 不寫程式也能追：訂閱各部落格原站提供的 RSS／Atom；登入 `/my/` 可管理追蹤與匯出 `/me/opml` 給閱讀器，OPML 只包含已成功抓取的 RSS／Atom，沒有可用 feed 的站會略過，請到原站確認訂閱方式。`/me/feed.xml` 是需要瀏覽器登入 session 的私人摘要 RSS，不是可公開分享或以 API 金鑰讀取的 feed。
- 正文提及是交流訊號，不是抄襲或背書判斷。引用占比的分母為來源站在窗口內所有已解析、指向已收錄目標的「文章—目標部落格」提及數；一篇提及三站會計三筆，不是占全站文章的百分比。覆蓋與截斷欄位應與排行一起閱讀。
- 話題包含原站 RSS category 與新文易數同步詞庫。詞庫的版本、同步時間與 coverage 隨回應提供；observed-article-window 僅代表觀測窗口內出現的詞，不代表完整詞庫。每站同詞文章依 1、0.5、0.25… 遞減計分。

## 快速開始

### 最新文章與游標分頁（curl + jq）

```sh
BASE='https://blog.observe.tw'
page=$(curl --fail-with-body -sS "$BASE/api/v1/articles?hours=720&limit=10")
printf '%s\n' "$page" | jq '.items[] | {title, url, blogName, publishedAt}'
cursor=$(printf '%s\n' "$page" | jq -r '.nextCursor // empty')
if [ -n "$cursor" ]; then
  curl --fail-with-body -sS -G "$BASE/api/v1/articles" --data-urlencode "hours=720" --data-urlencode "limit=10" --data-urlencode "cursor=$cursor" | jq '.items'
fi
```

### 某部落格的文章與提及關係（curl + jq）

```sh
BASE='https://blog.observe.tw'
slug=$(curl --fail-with-body -sS "$BASE/api/v1/blogs?limit=1" | jq -r '.items[0].slug // empty')
if [ -n "$slug" ]; then
  encoded=$(printf '%s' "$slug" | jq -sRr @uri)
  curl --fail-with-body -sS "$BASE/api/v1/blogs/$encoded/articles?hours=2160&limit=10" | jq '.items'
  curl --fail-with-body -sS "$BASE/api/v1/blogs/$encoded/relations?hours=2160" | jq '.outgoing, .incoming, .coverage'
fi
```

### 誰提到誰、熱門話題與部落格目錄（curl + jq）

```sh
curl --fail-with-body -sS 'https://blog.observe.tw/api/v1/relations?hours=720' | jq '.nodes, .edges, .coverage'
curl --fail-with-body -sS 'https://blog.observe.tw/api/v1/topics?hours=168&limit=10' | jq '.items, .vocabulary'
curl --fail-with-body -sS -G 'https://blog.observe.tw/api/v1/blogs' --data-urlencode 'q=旅行' --data-urlencode 'limit=20' | jq '.items, .nextCursor'
```

### JavaScript：有上限的文章分頁（瀏覽器或 Node 24）

```js
const endpoint = 'https://blog.observe.tw/api/v1/articles';
let cursor = null;
for (let page = 0; page < 3; page++) {
  const query = new URLSearchParams({ hours: "720", limit: "50" });
  if (cursor) query.set("cursor", cursor);
  const response = await fetch(endpoint + "?" + query);
  if (!response.ok) throw new Error("HTTP " + response.status + ": " + await response.text());
  const result = await response.json();
  for (const article of result.items) console.log(article.blogName, article.title, article.url);
  cursor = result.nextCursor;
  if (!cursor) break;
  await new Promise(resolve => setTimeout(resolve, 1100));
}
// 這是同一輪分頁；開始下一輪輪詢前至少等 120 秒。
```

## 端點一覽

| 端點 | 說明 |
| --- | --- |
| [`GET /api/v1/articles`](#api-v1-articles) | 最新文章與標題搜尋 |
| [`GET /api/v1/blogs`](#api-v1-blogs) | 已驗證部落格目錄 |
| [`GET /api/v1/blogs/{slug}`](#api-v1-blogs-slug) | 單一部落格資料 |
| [`GET /api/v1/blogs/{slug}/articles`](#api-v1-blogs-slug-articles) | 某部落格的文章 |
| [`GET /api/v1/relations`](#api-v1-relations) | 誰提到誰與互相提及排行 |
| [`GET /api/v1/blogs/{slug}/relations`](#api-v1-blogs-slug-relations) | 某部落格提到誰、被誰提到 |
| [`GET /api/v1/topics`](#api-v1-topics) | 熱門話題排行 |
| [`GET /api/v1/topics/{id}`](#api-v1-topics-id) | 某話題有哪些部落格在寫 |
| [`GET /api/v1/openapi.json`](#api-v1-openapi-json) | 機器可讀 OpenAPI 規格 |

## 最新文章與搜尋

<a id="api-v1-articles"></a>

### `GET /api/v1/articles`

**最新文章與標題搜尋**

依發文時間（未知時用首次收錄時間）再依 ID 由新到舊；publishedAt 仍保留 null。游標固定第一頁窗口與篩選條件，後續請保持相同參數。

| 參數 | 位置 | 型別 | 說明 |
| --- | --- | --- | --- |
| limit | query | integer | 每頁筆數；預設 50；1–200 |
| cursor | query | string | 上一頁的 nextCursor，不可修改或跨篩選條件使用 |
| hours | query | integer | 最近幾小時；不得與 since/until 同時使用；預設 720；1–2160 |
| q | query | string | 名稱或標題的純文字包含搜尋；不是 SQL／正規表示式 |
| since | query | string (ISO 時間) | 窗口起點（UTC ISO 8601，秒或三位毫秒且以 Z 結尾），必須與 until 成對，跨度最多 90 天 |
| until | query | string (ISO 時間) | 窗口終點（UTC ISO 8601，秒或三位毫秒且以 Z 結尾），必須與 since 成對 |
| blog | query | string | 限制部落格代碼 |

範例：

```sh
curl --fail-with-body -sS 'https://blog.observe.tw/api/v1/articles'
```

回應欄位：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `items` | object[] |  |
| `items[].id` | integer | 文章 ID |
| `items[].title` | string | 原文標題 |
| `items[].url` | string | 原文網址 |
| `items[].author` | string \| null | 原站署名，不代表跨站作者身分相同 |
| `items[].publishedAt` | string (ISO 時間) \| null | 原站發文時間 |
| `items[].updatedAt` | string (ISO 時間) \| null | RSS／原站提供的文章更新時間 |
| `items[].imageUrl` | string \| null | 圖片網址；沒有圖片時為 null |
| `items[].blogSlug` | string | 部落格代碼 |
| `items[].blogName` | string | 部落格名稱 |
| `items[].summary` | string | 純文字短摘要；不提供全文 |
| `items[].observedAt` | string (ISO 時間) \| null | 本站首次收錄時間 |
| `items[].iconUrl` | string \| null | 部落格圖示 |
| `nextCursor` | string \| null | 下一頁游標；null 表示末頁 |
| `window` | object | 此輪固定窗口；游標保留窗口與篩選條件 |
| `window.since` | string (ISO 時間) |  |
| `window.until` | string (ISO 時間) |  |

錯誤：`400` invalid_query／invalid_cursor；`401` invalid_api_key；`404` not_found；`405` method_not_allowed；`429` rate_limit_exceeded（請依 Retry-After 退避）；`503` unavailable。

快取：`public, max-age=0, s-maxage=120, stale-while-revalidate=180`（僅匿名成功回應）。

<a id="api-v1-blogs-slug-articles"></a>

### `GET /api/v1/blogs/{slug}/articles`

**某部落格的文章**

| 參數 | 位置 | 型別 | 說明 |
| --- | --- | --- | --- |
| slug | 路徑 | string | 從目錄取得的部落格代碼 |
| limit | query | integer | 每頁筆數；預設 50；1–200 |
| cursor | query | string | 上一頁的 nextCursor，不可修改或跨篩選條件使用 |
| hours | query | integer | 最近幾小時；不得與 since/until 同時使用；預設 720；1–2160 |
| q | query | string | 名稱或標題的純文字包含搜尋；不是 SQL／正規表示式 |
| since | query | string (ISO 時間) | 窗口起點（UTC ISO 8601，秒或三位毫秒且以 Z 結尾），必須與 until 成對，跨度最多 90 天 |
| until | query | string (ISO 時間) | 窗口終點（UTC ISO 8601，秒或三位毫秒且以 Z 結尾），必須與 since 成對 |

範例：

```sh
curl --fail-with-body -sS 'https://blog.observe.tw/api/v1/blogs/skyhong-tw/articles'
```

回應欄位：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `items` | object[] |  |
| `items[].id` | integer | 文章 ID |
| `items[].title` | string | 原文標題 |
| `items[].url` | string | 原文網址 |
| `items[].author` | string \| null | 原站署名，不代表跨站作者身分相同 |
| `items[].publishedAt` | string (ISO 時間) \| null | 原站發文時間 |
| `items[].updatedAt` | string (ISO 時間) \| null | RSS／原站提供的文章更新時間 |
| `items[].imageUrl` | string \| null | 圖片網址；沒有圖片時為 null |
| `items[].blogSlug` | string | 部落格代碼 |
| `items[].blogName` | string | 部落格名稱 |
| `items[].summary` | string | 純文字短摘要；不提供全文 |
| `items[].observedAt` | string (ISO 時間) \| null | 本站首次收錄時間 |
| `items[].iconUrl` | string \| null | 部落格圖示 |
| `nextCursor` | string \| null | 下一頁游標；null 表示末頁 |
| `window` | object | 此輪固定窗口；游標保留窗口與篩選條件 |
| `window.since` | string (ISO 時間) |  |
| `window.until` | string (ISO 時間) |  |

錯誤：`400` invalid_query／invalid_cursor；`401` invalid_api_key；`404` not_found；`405` method_not_allowed；`429` rate_limit_exceeded（請依 Retry-After 退避）；`503` unavailable。

快取：`public, max-age=0, s-maxage=120, stale-while-revalidate=180`（僅匿名成功回應）。

## 部落格目錄

<a id="api-v1-blogs"></a>

### `GET /api/v1/blogs`

**已驗證部落格目錄**

依 ID 由小到大，使用游標續頁；不公開未核准的探索候選。

| 參數 | 位置 | 型別 | 說明 |
| --- | --- | --- | --- |
| limit | query | integer | 每頁筆數；預設 50；1–200 |
| cursor | query | string | 上一頁的 nextCursor，不可修改或跨篩選條件使用 |
| q | query | string | 名稱或標題的純文字包含搜尋；不是 SQL／正規表示式 |

範例：

```sh
curl --fail-with-body -sS 'https://blog.observe.tw/api/v1/blogs'
```

回應欄位：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `items` | object[] |  |
| `items[].id` | integer | 部落格 ID |
| `items[].slug` | string | 部落格代碼 |
| `items[].name` | string | 部落格名稱 |
| `items[].url` | string \| null | 部落格首頁 |
| `items[].category` | string | 原始分類，不代表權威分類 |
| `items[].description` | string | 公開短簡介 |
| `items[].iconUrl` | string \| null | 本站圖示網址 |
| `items[].discoveredAt` | string (ISO 時間) \| null | 收錄時間 |
| `items[].lastCrawlSuccessAt` | string (ISO 時間) \| null | 最近抓取成功時間 |
| `items[].lastPublishedAt` | string (ISO 時間) \| null | 最近發文時間 |
| `items[].expectedIntervalHours` | integer | 預期更新間隔，單位小時 |
| `nextCursor` | string \| null | 下一頁游標 |

錯誤：`400` invalid_query／invalid_cursor；`401` invalid_api_key；`404` not_found；`405` method_not_allowed；`429` rate_limit_exceeded（請依 Retry-After 退避）；`503` unavailable。

快取：`public, max-age=0, s-maxage=120, stale-while-revalidate=180`（僅匿名成功回應）。

<a id="api-v1-blogs-slug"></a>

### `GET /api/v1/blogs/{slug}`

**單一部落格資料**

| 參數 | 位置 | 型別 | 說明 |
| --- | --- | --- | --- |
| slug | 路徑 | string | 從目錄取得的部落格代碼 |

範例：

```sh
curl --fail-with-body -sS 'https://blog.observe.tw/api/v1/blogs/skyhong-tw'
```

回應欄位：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `blog` | object |  |
| `blog.id` | integer | 部落格 ID |
| `blog.slug` | string | 部落格代碼 |
| `blog.name` | string | 部落格名稱 |
| `blog.url` | string \| null | 部落格首頁 |
| `blog.category` | string | 原始分類，不代表權威分類 |
| `blog.description` | string | 公開短簡介 |
| `blog.iconUrl` | string \| null | 本站圖示網址 |
| `blog.discoveredAt` | string (ISO 時間) \| null | 收錄時間 |
| `blog.lastCrawlSuccessAt` | string (ISO 時間) \| null | 最近抓取成功時間 |
| `blog.lastPublishedAt` | string (ISO 時間) \| null | 最近發文時間 |
| `blog.expectedIntervalHours` | integer | 預期更新間隔，單位小時 |
| `blog.feeds` | object[] |  |
| `blog.feeds[].url` | string | 原站 feed 位址 |
| `blog.feeds[].type` | string | rss／atom／sitemap |

錯誤：`400` invalid_query／invalid_cursor；`401` invalid_api_key；`404` not_found；`405` method_not_allowed；`429` rate_limit_exceeded（請依 Retry-After 退避）；`503` unavailable。

快取：`public, max-age=0, s-maxage=120, stale-while-revalidate=180`（僅匿名成功回應）。

## 部落格提及關係

<a id="api-v1-relations"></a>

### `GET /api/v1/relations`

**誰提到誰與互相提及排行**

只計正文且雙方均為已驗證部落格。全站圖最多 500 條邊，排行有獨立上限；請檢查 coverage 截斷標記。

| 參數 | 位置 | 型別 | 說明 |
| --- | --- | --- | --- |
| hours | query | 168 \| 720 \| 2160 | 最近 7／30／90 天；預設 720 |

範例：

```sh
curl --fail-with-body -sS 'https://blog.observe.tw/api/v1/relations'
```

回應欄位：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `hours` | integer |  |
| `days` | integer |  |
| `generatedAt` | string (ISO 時間) |  |
| `nodes` | object[] |  |
| `nodes[].id` | integer |  |
| `nodes[].slug` | string |  |
| `nodes[].name` | string |  |
| `nodes[].iconUrl` | string \| null |  |
| `edges` | object[] | 全站最多 500 條圖形邊 |
| `edges[].sourceBlogId` | integer |  |
| `edges[].targetBlogId` | integer |  |
| `edges[].count` | integer | 不同來源文章提及此目標的篇數 |
| `edges[].share` | number | count ÷ 來源站已解析的文章—目標站提及數，不是文章總數占比 |
| `edges[].firstMentionAt` | string (ISO 時間) \| null |  |
| `edges[].lastMentionAt` | string (ISO 時間) \| null |  |
| `edges[].mutual` | boolean | 窗口內是否也有反向正文提及 |
| `mostMentioned` | object[] |  |
| `mostMentioned[].blogId` | integer |  |
| `mostMentioned[].mentions` | integer |  |
| `mostMentioned[].incomingBlogs` | integer |  |
| `mutual` | object[] |  |
| `mutual[].sourceBlogId` | integer |  |
| `mutual[].targetBlogId` | integer |  |
| `mutual[].forwardCount` | integer |  |
| `mutual[].reverseCount` | integer |  |
| `coverage` | object | 解析覆蓋統計；並非所有文章皆已分析 |
| `coverage.observedPosts` | integer |  |
| `coverage.totalPosts` | integer |  |
| `coverage.failedPosts` | integer |  |
| `coverage.noBodyPosts` | integer |  |
| `coverage.unknownDatePosts` | integer |  |
| `coverage.unresolvedLinks` | integer |  |
| `coverage.truncatedPosts` | integer |  |
| `coverage.graphTruncated` | boolean |  |
| `coverage.aggregationTruncated` | boolean |  |
| `coverage.sampledAt` | string (ISO 時間) \| null |  |
| `coverage.method` | string |  |
| `coverage.nonBodyLinks` | object |  |
| `coverage.nonBodyLinks.sidebar` | integer |  |
| `coverage.nonBodyLinks.blogroll` | integer |  |
| `coverage.nonBodyLinks.comment` | integer |  |

錯誤：`400` invalid_query／invalid_cursor；`401` invalid_api_key；`404` not_found；`405` method_not_allowed；`429` rate_limit_exceeded（請依 Retry-After 退避）；`503` unavailable。

快取：`public, max-age=0, s-maxage=120, stale-while-revalidate=180`（僅匿名成功回應）。

<a id="api-v1-blogs-slug-relations"></a>

### `GET /api/v1/blogs/{slug}/relations`

**某部落格提到誰、被誰提到**

單站關係不受全站圖形 500 邊上限影響，最多 500 邊及 20 筆公開連結證據；不提供正文片段。

| 參數 | 位置 | 型別 | 說明 |
| --- | --- | --- | --- |
| slug | 路徑 | string | 從目錄取得的部落格代碼 |
| hours | query | 168 \| 720 \| 2160 | 最近 7／30／90 天；預設 720 |

範例：

```sh
curl --fail-with-body -sS 'https://blog.observe.tw/api/v1/blogs/skyhong-tw/relations'
```

回應欄位：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `hours` | integer |  |
| `days` | integer |  |
| `generatedAt` | string (ISO 時間) |  |
| `nodes` | object[] |  |
| `nodes[].id` | integer |  |
| `nodes[].slug` | string |  |
| `nodes[].name` | string |  |
| `nodes[].iconUrl` | string \| null |  |
| `edges` | object[] | 全站最多 500 條圖形邊 |
| `edges[].sourceBlogId` | integer |  |
| `edges[].targetBlogId` | integer |  |
| `edges[].count` | integer | 不同來源文章提及此目標的篇數 |
| `edges[].share` | number | count ÷ 來源站已解析的文章—目標站提及數，不是文章總數占比 |
| `edges[].firstMentionAt` | string (ISO 時間) \| null |  |
| `edges[].lastMentionAt` | string (ISO 時間) \| null |  |
| `edges[].mutual` | boolean | 窗口內是否也有反向正文提及 |
| `mostMentioned` | object[] |  |
| `mostMentioned[].blogId` | integer |  |
| `mostMentioned[].mentions` | integer |  |
| `mostMentioned[].incomingBlogs` | integer |  |
| `mutual` | object[] |  |
| `mutual[].sourceBlogId` | integer |  |
| `mutual[].targetBlogId` | integer |  |
| `mutual[].forwardCount` | integer |  |
| `mutual[].reverseCount` | integer |  |
| `coverage` | object | 解析覆蓋統計；並非所有文章皆已分析 |
| `coverage.observedPosts` | integer |  |
| `coverage.totalPosts` | integer |  |
| `coverage.failedPosts` | integer |  |
| `coverage.noBodyPosts` | integer |  |
| `coverage.unknownDatePosts` | integer |  |
| `coverage.unresolvedLinks` | integer |  |
| `coverage.truncatedPosts` | integer |  |
| `coverage.graphTruncated` | boolean |  |
| `coverage.aggregationTruncated` | boolean |  |
| `coverage.sampledAt` | string (ISO 時間) \| null |  |
| `coverage.method` | string |  |
| `coverage.nonBodyLinks` | object |  |
| `coverage.nonBodyLinks.sidebar` | integer |  |
| `coverage.nonBodyLinks.blogroll` | integer |  |
| `coverage.nonBodyLinks.comment` | integer |  |
| `blogId` | integer |  |
| `outgoing` | object[] |  |
| `outgoing[].sourceBlogId` | integer |  |
| `outgoing[].targetBlogId` | integer |  |
| `outgoing[].count` | integer | 不同來源文章提及此目標的篇數 |
| `outgoing[].share` | number | count ÷ 來源站已解析的文章—目標站提及數，不是文章總數占比 |
| `outgoing[].firstMentionAt` | string (ISO 時間) \| null |  |
| `outgoing[].lastMentionAt` | string (ISO 時間) \| null |  |
| `outgoing[].mutual` | boolean | 窗口內是否也有反向正文提及 |
| `incoming` | object[] |  |
| `incoming[].sourceBlogId` | integer |  |
| `incoming[].targetBlogId` | integer |  |
| `incoming[].count` | integer | 不同來源文章提及此目標的篇數 |
| `incoming[].share` | number | count ÷ 來源站已解析的文章—目標站提及數，不是文章總數占比 |
| `incoming[].firstMentionAt` | string (ISO 時間) \| null |  |
| `incoming[].lastMentionAt` | string (ISO 時間) \| null |  |
| `incoming[].mutual` | boolean | 窗口內是否也有反向正文提及 |
| `evidence` | object[] |  |
| `evidence[].postId` | integer |  |
| `evidence[].postTitle` | string |  |
| `evidence[].postUrl` | string |  |
| `evidence[].targetUrl` | string |  |
| `evidence[].anchor` | string |  |
| `evidence[].publishedAt` | string (ISO 時間) \| null |  |
| `evidence[].sourceBlogId` | integer |  |
| `evidence[].targetBlogId` | integer |  |
| `evidence[].location` | "body" |  |
| `profileTruncated` | boolean |  |

錯誤：`400` invalid_query／invalid_cursor；`401` invalid_api_key；`404` not_found；`405` method_not_allowed；`429` rate_limit_exceeded（請依 Retry-After 退避）；`503` unavailable。

快取：`public, max-age=0, s-maxage=120, stale-while-revalidate=180`（僅匿名成功回應）。

## 話題與關鍵字

<a id="api-v1-topics"></a>

### `GET /api/v1/topics`

**熱門話題排行**

只列至少兩個部落格寫過的話題。依 limit 最多回應 200 筆排行；truncated 表示仍有其他結果，此端點不提供 cursor。

| 參數 | 位置 | 型別 | 說明 |
| --- | --- | --- | --- |
| hours | query | 168 \| 720 \| 2160 | 最近 7／30／90 天；預設 720 |
| limit | query | integer | 每頁筆數；預設 50；1–200 |

範例：

```sh
curl --fail-with-body -sS 'https://blog.observe.tw/api/v1/topics'
```

回應欄位：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `items` | object[] |  |
| `items[].id` | string | rss:<數字> 或 tag:<版本內詞彙 ID> |
| `items[].label` | string |  |
| `items[].source` | "rss-category" \| "tag-vocabulary" |  |
| `items[].score` | number | 各站依 1、0.5、0.25… 加總 |
| `items[].posts` | integer |  |
| `items[].blogs` | integer |  |
| `nextCursor` | null | 排行僅提供有界快照，不提供游標續頁 |
| `hours` | integer |  |
| `vocabulary` | object |  |
| `vocabulary.status` | "ready" \| "unavailable" |  |
| `vocabulary.source` | string |  |
| `vocabulary.version` | string \| null |  |
| `vocabulary.coverage` | string \| null |  |
| `vocabulary.syncedAt` | string (ISO 時間) \| null |  |
| `vocabulary.window` | object \| null |  |
| `vocabulary.window.since` | string (ISO 時間) |  |
| `vocabulary.window.until` | string (ISO 時間) |  |
| `vocabulary.invalidTagCount` | integer \| null |  |
| `vocabulary.normalizedTagCount` | integer \| null |  |
| `vocabulary.tagNormalization` | string \| null |  |
| `vocabulary.upstreamSnapshotConsistent` | boolean |  |
| `minimumBlogs` | integer |  |
| `generatedAt` | string (ISO 時間) |  |
| `truncated` | boolean |  |

錯誤：`400` invalid_query／invalid_cursor；`401` invalid_api_key；`404` not_found；`405` method_not_allowed；`429` rate_limit_exceeded（請依 Retry-After 退避）；`503` unavailable。

快取：`public, max-age=0, s-maxage=120, stale-while-revalidate=180`（僅匿名成功回應）。

<a id="api-v1-topics-id"></a>

### `GET /api/v1/topics/{id}`

**某話題有哪些部落格在寫**

最多 100 個部落格與 100 篇文章；請檢查 truncated。

| 參數 | 位置 | 型別 | 說明 |
| --- | --- | --- | --- |
| id | 路徑 | string | 從話題排行取得的 ID，請 URL 編碼 |
| hours | query | 168 \| 720 \| 2160 | 最近 7／30／90 天；預設 720 |

範例：

```sh
curl --fail-with-body -sS 'https://blog.observe.tw/api/v1/topics/rss%3A1'
```

回應欄位：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `hours` | integer |  |
| `generatedAt` | string (ISO 時間) |  |
| `topic` | object |  |
| `topic.id` | string |  |
| `topic.label` | string |  |
| `topic.source` | string |  |
| `vocabulary` | object |  |
| `vocabulary.status` | "ready" \| "unavailable" |  |
| `vocabulary.source` | string |  |
| `vocabulary.version` | string \| null |  |
| `vocabulary.coverage` | string \| null |  |
| `vocabulary.syncedAt` | string (ISO 時間) \| null |  |
| `vocabulary.window` | object \| null |  |
| `vocabulary.window.since` | string (ISO 時間) |  |
| `vocabulary.window.until` | string (ISO 時間) |  |
| `vocabulary.invalidTagCount` | integer \| null |  |
| `vocabulary.normalizedTagCount` | integer \| null |  |
| `vocabulary.tagNormalization` | string \| null |  |
| `vocabulary.upstreamSnapshotConsistent` | boolean |  |
| `blogs` | object[] |  |
| `blogs[].id` | integer |  |
| `blogs[].slug` | string |  |
| `blogs[].name` | string |  |
| `blogs[].posts` | integer |  |
| `blogs[].score` | number |  |
| `articles` | object[] |  |
| `articles[].id` | integer |  |
| `articles[].title` | string |  |
| `articles[].url` | string |  |
| `articles[].publishedAt` | string (ISO 時間) \| null |  |
| `articles[].blogSlug` | string |  |
| `articles[].blogName` | string |  |
| `truncated` | boolean |  |

錯誤：`400` invalid_query／invalid_cursor；`401` invalid_api_key；`404` not_found；`405` method_not_allowed；`429` rate_limit_exceeded（請依 Retry-After 退避）；`503` unavailable。

快取：`public, max-age=0, s-maxage=120, stale-while-revalidate=180`（僅匿名成功回應）。

## API 本身

<a id="api-v1-openapi-json"></a>

### `GET /api/v1/openapi.json`

**機器可讀 OpenAPI 規格**

範例：

```sh
curl --fail-with-body -sS 'https://blog.observe.tw/api/v1/openapi.json'
```

回應欄位：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `openapi` | string |  |
| `info` | object |  |
| `paths` | object |  |
| `components` | object |  |

錯誤：`400` invalid_query／invalid_cursor；`401` invalid_api_key；`404` not_found；`405` method_not_allowed；`429` rate_limit_exceeded（請依 Retry-After 退避）；`503` unavailable。

快取：`public, max-age=0, s-maxage=120, stale-while-revalidate=180`（僅匿名成功回應）。
