/** Adapted from tag.observe.tw afe0a65 app/src/v1/openapi.ts; see LICENSE / NOTICE. */
import { API_CACHE, API_LIMITS } from '../public-api/contract.ts';

export type Schema = Record<string, unknown>;
const str = (description = '', extra: Schema = {}): Schema => ({ type: 'string', description, ...extra });
const int = (description = '', extra: Schema = {}): Schema => ({ type: 'integer', description, ...extra });
const num = (description = ''): Schema => ({ type: 'number', description });
const bool = (description = ''): Schema => ({ type: 'boolean', description });
const time = (description = ''): Schema => str(description, { format: 'date-time' });
const nullable = (schema: Schema): Schema => ({ ...schema, type: [schema.type, 'null'] });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const arr = (items: Schema, description = ''): Schema => ({ type: 'array', items, description });
const obj = (properties: Record<string, Schema>, description = '', optional: string[] = []): Schema => ({
  type: 'object',
  description,
  properties,
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
});
const ORIGIN = 'https://blog.observe.tw';

export const API_INTRO = {
  title: '部落格觀察 API',
  version: '1',
  summary: '公開取用最新文章、部落格目錄、正文提及關係與話題排行；資料只涵蓋已收錄且驗證的部落格。',
  rules: [
    `基底網址 \`${ORIGIN}\`。公開查詢使用 \`GET\`（也接受 \`HEAD\`），回傳 UTF-8 JSON。`,
    'API 狀態頁：`/api/status`。瀏覽器以 HTML 顯示；以 `Accept: application/json` 取得 JSON，只顯示 API 狀態與端點用途。狀態包含 `ok` 或 `degraded`，以有界可用性檢查確認公開查詢的資料依賴可連線，最多快取 5 秒；不是每個端點逐筆測試。JSON 欄位為 `status`、`version`、`endpoints`（每項 `path`、`summary`）與 `updatedAt`；這是狀態回應產生時間，不是文章資料更新時間。此回應為 `no-store`，不提供內部主機或爬蟲維運資訊。',
    '公開查詢不需要金鑰。每個 IP 每分鐘最多 60 次，超過回 `429`；回應帶 `x-ratelimit-limit`、`x-ratelimit-remaining`、`x-ratelimit-reset`。登入後可在 `/my/` 建立個人 API 金鑰（每人最多 3 把），以 `x-api-key: blog_…` 傳送，每把每分鐘 1000 次；伺服器只存 SHA-256 摘要，完整金鑰只顯示一次。無效或撤銷的金鑰回 `401`。為防止隨機金鑰探測，首次出現或未快取的金鑰須先通過每 IP 每分鐘 60 次的匿名／驗證桶；若該桶已用完會先回 `429`，請等窗口重設後重試。已快取且有效的金鑰不受此 IP 桶限制，每把每分鐘 1000 次額度不變。金鑰不能用來登入、管理或讀取私人資料，`Authorization` 不是本 API 的金鑰認證方式。',
    '允許跨網域：`Access-Control-Allow-Origin: *`，不接受跨域 cookie 認證。瀏覽器可讀取限流標頭與 `Retry-After`；遇 `429` 請依 `Retry-After` 秒數退避。限流標頭表示產生回應時的額度；來源站對實際到站請求計額。',
    '時間一律使用 UTC ISO 8601（例如 `2026-10-12T00:00:00.000Z`）；「一天」指台北時間（UTC+8）的日曆日，`hours` 則是連續經過的小時數。未知日期回 `null`，不以抓取日期冒充發文日期。',
    '部落格 `slug` 與話題 `id` 是穩定 API 識別碼，不因網頁網址改名而變動。已建立可讀網頁網址時，項目另附選用的 `canonicalPath`，文章附 `blogCanonicalPath`；以基底網址加上此相對路徑即可分享。欄位暫缺時仍可使用原識別碼網址，網頁會 301 到正式網址；不要拿可讀 slug 取代 API 參數。',
    `匿名成功回應帶 \`cache-control: ${API_CACHE}\`。文章依各站 RSS／抓取排程分批更新，查詢不保留跨請求結果快取，讓隱藏或刪除內容可即時反映；低頻部落格不因久未發文而失效。請至少間隔 120 秒輪詢，關係以 5 分鐘以上為宜。更新與歷史回補有延遲，不保證每輪都有新資料。`,
    '帶 `x-api-key` 或 `Authorization` 的請求與錯誤回應為 `private, no-store` 或 `no-store`，不得進共享快取。快取標頭不代表 CDN 已快取該端點；目前 Cloudflare 的專用 HTML 規則只涵蓋首頁。',
    '錯誤格式為 `{"error":"..."}`：`400` 參數／游標錯誤、`401` 無效金鑰、`404` 找不到、`410` 話題證據已全部撤銷、`405` 不支援的方法、`429` 太頻繁、`503` 暫時無法提供服務。未知參數、重複參數與不合法的時間窗口會回 `400`。',
    '路徑參數請 URL 編碼（例如話題 `rss:1` 寫成 `rss%3A1`），路徑結尾不要加 `/`。文章與目錄使用 `limit`、`cursor`／`nextCursor`；游標是不透明字串，請原樣傳回並保持原查詢條件。`nextCursor: null` 表示這個結果已到尾頁。',
    '變更紀錄（2026-10-12，已核准的破壞性變更）：`GET /api/v1/blogs` 的 `items[].url` 與 `GET /api/v1/blogs/{slug}` 的 `blog.url` 改為本站可讀網頁絕對網址；原站首頁移至同物件的 `sourceUrl`（可為 null）。原先使用 blog.url 前往原站的程式請改讀 sourceUrl。`GET /api/v1/topics` 的 `items[].url` 及 `GET /api/v1/topics/{id}` 的 `topic.url` 為新增的本站網頁網址。ID／slug／favicon 識別碼不變，文章 url 仍是原文；內部 /api/* 的原站 url 不改。缺少 registry 時，本站 url 暫用可轉址的舊識別碼路徑；純標點話題不提供網址。不提供 pageUrl 系列欄位。',
    '除上述明列的已核准變更外，`v1` 內只做向後相容的變更（新增欄位、新增端點）；移除或改名會先公告。客戶端應忽略未知的新欄位。既有站內 `/api/*` 介面保留給網站使用，不是本文件的穩定公開契約；本站沒有舊版 PHP API。',
    '部落格文章、標題與圖片著作權屬原作者。API 只提供標題、原文連結、統計及最多 500 字元的短摘要，不提供全文；私人追蹤、個人 RSS、候選證據、管理及 AI 原始輸入不在公開 API。使用統計請註明「資料來源：部落格觀察 blog.observe.tw」，閱讀文章請連回原站。',
    '不寫程式也能追：訂閱各部落格原站提供的 RSS／Atom；登入 `/my/` 可管理追蹤與匯出 `/me/opml` 給閱讀器，OPML 只包含已成功抓取的 RSS／Atom，沒有可用 feed 的站會略過，請到原站確認訂閱方式。`/me/feed.xml` 是需要瀏覽器登入 session 的私人摘要 RSS，不是可公開分享或以 API 金鑰讀取的 feed。',
    '變更紀錄（2026-10-13）：話題詳情新增選用 history 累積歷史清單與 historyCursor 分頁。話題曾有有效比對證據就保留，不因退出每日詞庫窗口消失；只公開標題、原文連結及觀測狀態，絕不提供全文。全部證據明確撤銷時回 410，合併網頁一次 301 到最終話題。',
    '正文提及是交流訊號，不是抄襲或背書判斷。引用占比的分母為來源站在窗口內所有已解析、指向已收錄目標的「文章—目標部落格」提及數；一篇提及三站會計三筆，不是占全站文章的百分比。覆蓋與截斷欄位應與排行一起閱讀。',
    '話題詞條以新文易數維護的標籤池為唯一來源；目前 observed-article-window 僅代表觀測窗口內出現的詞，不代表完整詞庫。NFKC 與大小寫正規化後合併，顯示文字取同快照中上游文章出現次數最多的寫法。只比對標題與清理後正文；同篇取標題權重 2 或正文權重 1，依權重由高到低排列後，同站後續文章貢獻依序乘上 0.5。只命中正文時即 1、0.5、0.25…；2 篇標題加 1 篇正文合計 3.25。排除詞保留原始資料與原因，可透過話題詳情查詢；RSS 分類不另建排行詞庫。',
  ],
  quickstart: [
    {
      label: '最新文章與游標分頁（curl + jq）',
      lang: 'sh',
      code: [
        `BASE='${ORIGIN}'`,
        'page=$(curl --fail-with-body -sS "$BASE/api/v1/articles?hours=720&limit=10")',
        "printf '%s\\n' \"$page\" | jq '.items[] | {title, url, blogName, publishedAt}'",
        "cursor=$(printf '%s\\n' \"$page\" | jq -r '.nextCursor // empty')",
        'if [ -n "$cursor" ]; then',
        '  curl --fail-with-body -sS -G "$BASE/api/v1/articles" --data-urlencode "hours=720" --data-urlencode "limit=10" --data-urlencode "cursor=$cursor" | jq \'.items\'',
        'fi',
      ].join('\n'),
    },
    {
      label: '某部落格的文章與提及關係（curl + jq）',
      lang: 'sh',
      code: [
        `BASE='${ORIGIN}'`,
        'slug=$(curl --fail-with-body -sS "$BASE/api/v1/blogs?limit=1" | jq -r \'.items[0].slug // empty\')',
        'if [ -n "$slug" ]; then',
        '  encoded=$(printf \'%s\' "$slug" | jq -sRr @uri)',
        '  curl --fail-with-body -sS "$BASE/api/v1/blogs/$encoded/articles?hours=2160&limit=10" | jq \'.items\'',
        '  curl --fail-with-body -sS "$BASE/api/v1/blogs/$encoded/relations?hours=2160" | jq \'.outgoing, .incoming, .coverage\'',
        'fi',
      ].join('\n'),
    },
    {
      label: '誰提到誰、熱門話題與部落格目錄（curl + jq）',
      lang: 'sh',
      code: [
        `curl --fail-with-body -sS '${ORIGIN}/api/v1/relations?hours=720' | jq '.nodes, .edges, .coverage'`,
        `curl --fail-with-body -sS '${ORIGIN}/api/v1/topics?hours=168&limit=10' | jq '.items, .vocabulary'`,
        `curl --fail-with-body -sS -G '${ORIGIN}/api/v1/blogs' --data-urlencode 'q=旅行' --data-urlencode 'limit=20' | jq '.items, .nextCursor'`,
      ].join('\n'),
    },
    {
      label: 'JavaScript：有上限的文章分頁（瀏覽器或 Node 24）',
      lang: 'js',
      code: [
        `const endpoint = '${ORIGIN}/api/v1/articles';`,
        'let cursor = null;',
        'for (let page = 0; page < 3; page++) {',
        '  const query = new URLSearchParams({ hours: "720", limit: "50" });',
        '  if (cursor) query.set("cursor", cursor);',
        '  const response = await fetch(endpoint + "?" + query);',
        '  if (!response.ok) throw new Error("HTTP " + response.status + ": " + await response.text());',
        '  const result = await response.json();',
        '  for (const article of result.items) console.log(article.blogName, article.title, article.url);',
        '  cursor = result.nextCursor;',
        '  if (!cursor) break;',
        '  await new Promise(resolve => setTimeout(resolve, 1100));',
        '}',
        '// 這是同一輪分頁；開始下一輪輪詢前至少等 120 秒。',
      ].join('\n'),
    },
  ],
};

export const API_TAGS = [
  { name: 'articles', description: '最新文章與搜尋' },
  { name: 'blogs', description: '部落格目錄' },
  { name: 'relations', description: '部落格提及關係' },
  { name: 'topics', description: '話題與關鍵字' },
  { name: 'meta', description: 'API 本身' },
];
const schemas: Record<string, Schema> = {
  Error: obj({ error: str('穩定錯誤代碼') }),
  Article: obj({
    id: int('文章 ID'),
    title: str('原文標題'),
    url: str('原文網址', { format: 'uri' }),
    author: nullable(str('原站署名，不代表跨站作者身分相同')),
    publishedAt: nullable(time('原站發文時間')),
    updatedAt: nullable(time('RSS／原站提供的文章更新時間')),
    imageUrl: nullable(str('圖片網址；沒有圖片時為 null')),
    blogSlug: str('部落格代碼'),
    blogName: str('部落格名稱'),
    summary: str('純文字短摘要；不提供全文', { maxLength: 500 }),
    observedAt: nullable(time('本站首次收錄時間')),
    iconUrl: nullable(str('部落格圖示')),
  }),
  Blog: obj({
    id: int('部落格 ID'),
    slug: str('部落格代碼'),
    name: str('部落格名稱'),
    url: str('本站部落格可讀網頁絕對網址；2026-10-12 起原站網址改存 sourceUrl', { format: 'uri' }),
    sourceUrl: nullable(str('原站部落格首頁；原 blog.url 的值', { format: 'uri' })),
    category: str('原始分類，不代表權威分類'),
    description: str('公開短簡介', { maxLength: 500 }),
    iconUrl: nullable(str('本站圖示網址')),
    discoveredAt: nullable(time('收錄時間')),
    lastCrawlSuccessAt: nullable(time('最近抓取成功時間')),
    lastPublishedAt: nullable(time('最近發文時間')),
    expectedIntervalHours: int('預期更新間隔，單位小時'),
  }),
  ArticlePage: obj({
    items: arr(ref('Article')),
    nextCursor: nullable(str('下一頁游標；null 表示末頁')),
    window: obj({ since: time(), until: time() }, '此輪固定窗口；游標保留窗口與篩選條件'),
  }),
  BlogPage: obj({ items: arr(ref('Blog')), nextCursor: nullable(str('下一頁游標')) }),
  RelationNode: obj({ id: int(), slug: str(), name: str(), iconUrl: nullable(str()) }),
  RelationEdge: obj({
    sourceBlogId: int(),
    targetBlogId: int(),
    count: int('不同來源文章提及此目標的篇數'),
    share: num('count ÷ 來源站已解析的文章—目標站提及數，不是文章總數占比'),
    firstMentionAt: nullable(time()),
    lastMentionAt: nullable(time()),
    mutual: bool('窗口內是否也有反向正文提及'),
  }),
  RelationCoverage: obj(
    {
      observedPosts: int(),
      totalPosts: int(),
      failedPosts: int(),
      noBodyPosts: int(),
      unknownDatePosts: int(),
      unresolvedLinks: int(),
      truncatedPosts: int(),
      graphTruncated: bool(),
      aggregationTruncated: bool(),
      sampledAt: nullable(time()),
      method: str(),
      nonBodyLinks: obj({ sidebar: int(), blogroll: int(), comment: int() }),
    },
    '解析覆蓋統計；並非所有文章皆已分析',
  ),
  Relations: obj({
    hours: int(),
    days: int(),
    generatedAt: time(),
    nodes: arr(ref('RelationNode')),
    edges: arr(ref('RelationEdge'), '全站最多 500 條圖形邊'),
    mostMentioned: arr(obj({ blogId: int(), mentions: int(), incomingBlogs: int() })),
    mutual: arr(obj({ sourceBlogId: int(), targetBlogId: int(), forwardCount: int(), reverseCount: int() })),
    coverage: ref('RelationCoverage'),
  }),
  BlogRelations: {
    allOf: [
      ref('Relations'),
      obj({
        blogId: int(),
        outgoing: arr(ref('RelationEdge')),
        incoming: arr(ref('RelationEdge')),
        evidence: arr(
          obj({
            postId: int(),
            postTitle: str(),
            postUrl: str(),
            targetUrl: str(),
            anchor: str(),
            publishedAt: nullable(time()),
            sourceBlogId: int(),
            targetBlogId: int(),
            location: str('', { enum: ['body'] }),
          }),
        ),
        profileTruncated: bool(),
      }),
    ],
  },
  Vocabulary: obj({
    status: str('', { enum: ['ready', 'unavailable'] }),
    source: str(),
    version: nullable(str()),
    coverage: nullable(str()),
    syncedAt: nullable(time()),
    window: nullable(obj({ since: time(), until: time() })),
    invalidTagCount: nullable(int()),
    normalizedTagCount: nullable(int()),
    tagNormalization: nullable(str()),
    upstreamSnapshotConsistent: bool(),
    excludedTermCount: int('保留但不參與比對的 canonical 詞條數'),
    exclusionReasons: { type: 'object', additionalProperties: int(), description: '排除原因與詞條數' },
    frequencyBaseline: nullable(
      obj({ since: time(), until: time(), totalPosts: int(), coveredPosts: int(), thresholdRatio: num(), version: str() }),
    ),
    totalSourceTerms: nullable(int('保留的上游原始詞數，包含未參與比對的詞')),
    activeSet: nullable(
      obj({
        status: str(),
        version: nullable(str()),
        asOf: nullable(time()),
        eligibleTerms: int(),
        activeTerms: int(),
        termLimit: int(),
        codePointLimit: int(),
        memoryBudgetBytes: int(),
        estimatedBytes: int(),
        inactiveReasons: { type: 'object', additionalProperties: int(), description: 'low-frequency 或 memory-budget；原詞仍保留' },
      }),
    ),
  }),
  MatchingPolicy: obj({
    version: str(),
    policyVersion: str(),
    titleWeight: { ...num(), const: 2 },
    bodyWeight: { ...num(), const: 1 },
    sameBlogDecay: { ...num(), const: 0.5 },
    sources: arr(str('', { enum: ['title', 'body'] })),
    recentBackfillHours: int(),
    frequency: { type: 'object', additionalProperties: true },
  }),
  Topic: obj({
    id: str('tag:<NFKC／大小寫正規化詞條 SHA-256>；舊 tag／rss ID 可在詳情解析'),
    label: str(),
    source: str('', { enum: ['rss-category', 'tag-vocabulary'] }),
    score: num('同篇取標題 2 或正文 1；同站按權重排序後依序減半加總'),
    posts: int(),
    blogs: int(),
    titlePosts: int(),
    bodyOnlyPosts: int(),
    recentShare: nullable(num()),
    baselineShare: nullable(num()),
    lift: nullable(num('近期文章占比 ÷ 長期基準占比；無基準時為 null，不代表零')),
    matchingRule: str('', { enum: ['title-only', 'title-and-body'] }),
    matchingReason: nullable(str()),
  }),
  Topics: obj({
    items: arr(ref('Topic')),
    nextCursor: { type: 'null', description: '排行僅提供有界快照，不提供游標續頁' },
    hours: int(),
    vocabulary: ref('Vocabulary'),
    matchingPolicy: ref('MatchingPolicy'),
    minimumBlogs: int('', { const: 2 }),
    generatedAt: time(),
    truncated: bool(),
  }),
  TopicHistory: obj({
    articles: arr(
      obj(
        {
          id: int(),
          title: str(),
          url: str('原文連結；不提供全文'),
          publishedAt: nullable(time()),
          blogSlug: str(),
          blogName: str(),
          blogCanonicalPath: str('可讀部落格路徑'),
          evidenceState: str('confirmed 為已確認；pending 為過去觀測、待重新確認', { enum: ['confirmed', 'pending'] }),
          observedAt: time('本站最後觀測到提及的時間'),
        },
        '',
        ['blogCanonicalPath'],
      ),
    ),
    nextCursor: nullable(str('歷史清單下一頁游標；傳入 historyCursor，綁定話題不可跨用')),
    confirmed: int('累積已確認的公開文章數'),
    pending: int('累積待重新確認的公開文章數'),
    lastObservedAt: nullable(time()),
    total: int('累積不同公開文章數'),
  }),
  TopicDetail: obj({
    hours: int(),
    generatedAt: time(),
    topic: obj({
      id: str(),
      label: str(),
      source: str(),
      canonicalId: nullable(str()),
      excludedReason: nullable(
        str(
          'too-short、pure-number、pure-date、tag-noise、no-equal、upstream-noise、upstream-no-equal、invalid-label、empty-label、punctuation-only 或 not-in-tag-vocabulary',
        ),
      ),
      inactiveReason: nullable(str('low-frequency 或 memory-budget；與雜訊排除分開')),
      matchingStatus: str('', { enum: ['active', 'inactive', 'excluded'] }),
      articleCount: nullable(int()),
      lastPublishedAt: nullable(time()),
      matchingRule: str('', { enum: ['title-only', 'title-and-body'] }),
      matchingReason: nullable(str()),
    }),
    vocabulary: ref('Vocabulary'),
    matchingPolicy: ref('MatchingPolicy'),
    blogs: arr(obj({ id: int(), slug: str(), name: str(), posts: int(), score: num(), titlePosts: int(), bodyOnlyPosts: int() })),
    articles: arr(obj({ id: int(), title: str(), url: str(), publishedAt: nullable(time()), blogSlug: str(), blogName: str() })),
    truncated: bool(),
  }),
  OpenApi: {
    type: 'object',
    description: 'OpenAPI 3.1 規格；包含 info、servers、paths、components、tags。',
    required: ['openapi', 'info', 'paths', 'components'],
    properties: {
      openapi: str('', { const: '3.1.0' }),
      info: { type: 'object' },
      paths: { type: 'object' },
      components: { type: 'object' },
    },
  },
};
// Additive link metadata is optional: a registry backfill/cache miss must not
// change the stable API contract or make otherwise valid public data fail.
for (const [schema, field] of [
  ['Blog', 'canonicalPath'],
  ['Topic', 'canonicalPath'],
  ['RelationNode', 'canonicalPath'],
  ['Article', 'blogCanonicalPath'],
  ['RelationEdge', 'sourceBlogCanonicalPath'],
  ['RelationEdge', 'targetBlogCanonicalPath'],
] as const) {
  (schemas[schema].properties as Record<string, Schema>)[field] = str('可讀網頁的相對 canonical 路徑；選用，不取代原 API 識別碼', {
    pattern: '^/(blogs|topics)/[^/?#]+/$',
  });
}
(schemas.Topic.properties as Record<string, Schema>).url = str('本站話題網頁絕對網址；選用，純標點話題不提供', { format: 'uri' });
const topicDetailProperties = schemas.TopicDetail.properties as Record<string, Schema>;
topicDetailProperties.history = ref('TopicHistory');
(schemas.MatchingPolicy.properties as Record<string, Schema>).publicationNoiseVersion = str(
  '公開呈現的純標點雜訊規則版本；不改原始詞條 ID',
);
for (const [schema, pathField] of [
  [topicDetailProperties.topic, 'canonicalPath'],
  [topicDetailProperties.blogs.items as Schema, 'canonicalPath'],
  [topicDetailProperties.articles.items as Schema, 'blogCanonicalPath'],
] as const) {
  const properties = schema.properties as Record<string, Schema>;
  properties[pathField] = str('本站可讀網頁相對路徑；選用');
}
(topicDetailProperties.topic.properties as Record<string, Schema>).url = str('本站話題網頁絕對網址；選用', { format: 'uri' });
export type Parameter = {
  name: string;
  in: 'query' | 'path';
  required?: boolean;
  description: string;
  schema: Schema;
  example?: string | number;
};
export type Endpoint = {
  path: string;
  summary: string;
  tag: string;
  description?: string;
  params?: Parameter[];
  response: Schema;
  example?: string;
  method?: 'GET';
  errors?: Record<string, string>;
  cache?: string;
};
const q = (name: string, description: string, schema: Schema): Parameter => ({ name, in: 'query', description, schema });
const limit = q('limit', '每頁筆數', int('', { minimum: 1, maximum: API_LIMITS.maxLimit, default: API_LIMITS.defaultLimit }));
const cursor = q('cursor', '上一頁的 nextCursor，不可修改或跨篩選條件使用', str('', { maxLength: 2048 }));
const search = q('q', '名稱或標題的純文字包含搜尋；不是 SQL／正規表示式', str('', { maxLength: 100 }));
const slug: Parameter = {
  name: 'slug',
  in: 'path' as const,
  required: true,
  description: '從目錄取得的部落格代碼',
  schema: str(),
  example: 'skyhong-tw',
};
const hours = q('hours', '最近 7／30／90 天', int('', { enum: [168, 720, 2160], default: 720 }));
const articleParams = [
  limit,
  cursor,
  q('hours', '最近幾小時；不得與 since/until 同時使用', int('', { minimum: 1, maximum: 2160, default: 720 })),
  search,
  q('since', '窗口起點（UTC ISO 8601，秒或三位毫秒且以 Z 結尾），必須與 until 成對，跨度最多 90 天', time()),
  q('until', '窗口終點（UTC ISO 8601，秒或三位毫秒且以 Z 結尾），必須與 since 成對', time()),
];
export const ENDPOINTS: Endpoint[] = [
  {
    path: '/api/v1/articles',
    summary: '最新文章與標題搜尋',
    tag: 'articles',
    params: [...articleParams, q('blog', '限制部落格代碼', str())],
    response: ref('ArticlePage'),
    description:
      '依發文時間（未知時用首次收錄時間）再依 ID 由新到舊；publishedAt 仍保留 null。游標固定第一頁窗口與篩選條件，後續請保持相同參數。',
  },
  {
    path: '/api/v1/blogs',
    summary: '已驗證部落格目錄',
    tag: 'blogs',
    params: [limit, cursor, search],
    response: ref('BlogPage'),
    description: '依 ID 由小到大，使用游標續頁；不公開未核准的探索候選。',
  },
  {
    path: '/api/v1/blogs/{slug}',
    summary: '單一部落格資料',
    tag: 'blogs',
    params: [slug],
    response: obj({
      blog: { allOf: [ref('Blog'), obj({ feeds: arr(obj({ url: str('原站 feed 位址'), type: str('rss／atom／sitemap') })) })] },
    }),
  },
  {
    path: '/api/v1/blogs/{slug}/articles',
    summary: '某部落格的文章',
    tag: 'articles',
    params: [slug, ...articleParams],
    response: ref('ArticlePage'),
  },
  {
    path: '/api/v1/relations',
    summary: '誰提到誰與互相提及排行',
    tag: 'relations',
    params: [hours],
    response: ref('Relations'),
    description: '只計正文且雙方均為已驗證部落格。全站圖最多 500 條邊，排行有獨立上限；請檢查 coverage 截斷標記。',
  },
  {
    path: '/api/v1/blogs/{slug}/relations',
    summary: '某部落格提到誰、被誰提到',
    tag: 'relations',
    params: [slug, hours],
    response: ref('BlogRelations'),
    description: '單站關係不受全站圖形 500 邊上限影響，最多 500 邊及 20 筆公開連結證據；不提供正文片段。',
  },
  {
    path: '/api/v1/topics',
    summary: '熱門話題排行',
    tag: 'topics',
    params: [hours, limit],
    response: ref('Topics'),
    description: '只列至少兩個部落格寫過的話題。依 limit 最多回應 200 筆排行；truncated 表示仍有其他結果，此端點不提供 cursor。',
  },
  {
    path: '/api/v1/topics/{id}',
    summary: '某話題有哪些部落格在寫',
    tag: 'topics',
    params: [
      { name: 'id', in: 'path' as const, required: true, description: '從話題排行取得的 ID，請 URL 編碼', schema: str(), example: 'rss:1' },
      hours,
      q('historyCursor', 'history.nextCursor；累積歷史文章續頁，保持同一話題 ID', str('', { maxLength: 256 })),
    ],
    response: ref('TopicDetail'),
    description:
      '近期最多 100 個部落格與 100 篇文章；請檢查 truncated。history 是累積曾有比對證據的公開文章，獨立於 hours 與每日來源窗口；近期為空時仍可讀歷史。pending 僅表示過去觀測、待重新確認，不代表現在仍命中。全部證據明確撤銷回 410；不存在或暫不可公開回 404。',
  },
  { path: '/api/v1/openapi.json', summary: '機器可讀 OpenAPI 規格', tag: 'meta', response: ref('OpenApi') },
].map((endpoint) => ({
  ...endpoint,
  cache: API_CACHE,
  errors: {
    '400': 'invalid_query／invalid_cursor',
    '401': 'invalid_api_key',
    '404': 'not_found',
    '405': 'method_not_allowed',
    ...(endpoint.path === '/api/v1/topics/{id}' ? { '410': 'gone（累積證據已全部撤銷）' } : {}),
    '429': 'rate_limit_exceeded（請依 Retry-After 退避）',
    '503': 'unavailable',
  },
}));

export const examplePath = (endpoint: Endpoint) =>
  endpoint.example ??
  endpoint.path.replace(/\{(\w+)\}/g, (_, name: string) =>
    encodeURIComponent(String(endpoint.params?.find((p) => p.name === name)?.example ?? name)),
  );
export const operationId = (path: string) =>
  path
    .replace(/^\/api\/v1\//, '')
    .split(/[/.-]/)
    .map((part, i) => {
      const word = part.replace(/[{}]/g, '');
      return i ? word[0].toUpperCase() + word.slice(1) : word;
    })
    .join('');
export function buildOpenApi() {
  const headers = {
    'cache-control': { description: '公開內容查詢 no-store；帶金鑰／Authorization 為 private, no-store', schema: str() },
    'x-ratelimit-limit': { description: '目前額度上限', schema: int() },
    'x-ratelimit-remaining': { description: '產生回應當時剩餘額度', schema: int() },
    'x-ratelimit-reset': { description: '目前窗口重設的秒數', schema: int() },
    'Access-Control-Allow-Origin': { schema: str('', { const: '*' }) },
  };
  const paths = Object.fromEntries(
    ENDPOINTS.map((endpoint) => {
      const errors = Object.fromEntries(
        Object.entries(endpoint.errors ?? {}).map(([code, description]) => [
          code,
          {
            description,
            ...(code === '429' ? { headers: { 'Retry-After': { schema: int(), description: '建議等待秒數' } } } : {}),
            content: { 'application/json': { schema: ref('Error') } },
          },
        ]),
      );
      const get = {
        operationId: operationId(endpoint.path),
        tags: [endpoint.tag],
        summary: endpoint.summary,
        description: endpoint.description,
        parameters: endpoint.params ?? [],
        security: [{}, { personalApiKey: [] }],
        responses: { '200': { description: 'OK', headers, content: { 'application/json': { schema: endpoint.response } } }, ...errors },
      };
      return [
        endpoint.path,
        {
          get,
          head: {
            ...get,
            operationId: `${get.operationId}Head`,
            summary: `${endpoint.summary}（只取標頭）`,
            responses: Object.fromEntries(
              Object.entries(get.responses).map(([code, response]) => {
                const { content: _content, ...metadata } = response;
                return [code, metadata];
              }),
            ),
          },
        },
      ];
    }),
  );
  return {
    openapi: '3.1.0',
    info: {
      title: API_INTRO.title,
      version: API_INTRO.version,
      summary: API_INTRO.summary,
      description: API_INTRO.rules.map((rule) => `- ${rule}`).join('\n'),
      contact: { name: '部落格觀察', url: `${ORIGIN}/api/` },
      'x-quickstart': API_INTRO.quickstart,
    },
    servers: [{ url: ORIGIN }],
    externalDocs: { description: 'API 文件', url: `${ORIGIN}/api/` },
    tags: API_TAGS,
    paths,
    components: {
      schemas,
      securitySchemes: {
        personalApiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: '選用的個人公開查詢額度金鑰；不授權私人資料。登入 /my/ 申請，完整值只顯示一次。',
        },
      },
    },
  };
}
