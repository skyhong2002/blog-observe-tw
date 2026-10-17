# Article reader filters

## Recommendation

Offer an opt-in per-blog display cap and a separate multi-label blog genre exclusion.
Do not make full catalog tagging a prerequisite. A cap of three keeps every source
in the current list while reducing repetition; leave the default unlimited until
there is a product decision to change it. Frequency is not a quality judgment.

Blog genres are more predictable than matching individual article tags when a
reader wants to exclude an entire kind of source. Post tags can be absent, noisy,
or truncated for display (five per post). A post-level filter would miss untagged
posts and would have different semantics for mixed-topic blogs. It can be added
later as a distinct control, not silently substituted for blog exclusion.

## Read-only production observations

Observed on 2026-10-17 around 15:43 Asia/Taipei. Three sequential queries, one
connection (`connectionLimit: 1`), each `SET STATEMENT max_statement_time=3|5 FOR
SELECT`, bounded to 5,000 blogs, 200 latest articles, or 5,000 tag aggregates.
No production writes or migrations. The public boundary was `status='verified'`;
future-dated posts were excluded. Raw exports stayed outside the repository.

Of 455 public blogs, collected posts in the preceding seven days were:

- 0 posts: 289 blogs.
- 1–7 posts: 128 blogs.
- 8–21 posts: 19 blogs.
- 22–70 posts: 15 blogs.
- 71 or more posts: 4 blogs.

The 166 blogs with recent posts contributed 1,546 collected posts; median 3,
90th percentile 22, 95th percentile 34 (nearest-rank percentiles). The busiest
sources had 160, 118, 96 and 79 posts; kocpc had 69. These are collected publication
counts, not proof that a feed exposes its entire history or that a zero-count
blog did not publish.

The latest 200 posts came from 67 blogs, with one source contributing 24 posts.
Caps of 1 / 2 / 3 retain 67 / 93 / 111 posts respectively, always keeping all 67
sources. The cap counts the current batch, not a rolling seven-day rate. It
retains the newest articles in their original chronological order.

`blogs.category` is populated for 124 / 455 blogs (27.3%); 331 (72.7%) are
`待分類`. Its exact values and counts were: 旅遊 76, 科技 14, 財經 11, 電商 7,
電商 (服裝) 6, 生活內容 5, 科技, 遊戲 2, and one each of 生活內容, 財經 /
財經 (其他) / 旅遊, 生活內容. There is no existing 美食 value. This column alone
cannot support the requested exclusions. Active public feed-derived `blog_tags`
exist for 265 blogs; they are evidence, not curated blog identities.

## Initial classification

`data/blog-genre-review.json` holds multi-label assignments and their evidence.
The vocabulary is 美食, 旅遊, 3C／科技產品, 程式／技術, 生活／日記, 親子,
新聞／媒體, 財經. The initial assignments are heuristic, not author-confirmed.

The proposal used names, descriptions, existing categories and up to 60 distinct
active public feed-category labels per blog (ordered by tag id, not recency).
Identity signals can establish a genre. Otherwise a genre needs at least three
matching distinct labels and 25% of sampled labels, or six matching labels.
Broad 科技 alone never establishes 3C／科技產品. Classification is deliberately
incomplete; a tag sample is not a statistical estimate of a blog's article mix.
Evidence and assignments can be corrected in the review file before deployment.

105 / 455 blogs (23.1%) receive at least one genre; 350 remain unclassified.
Genre assignments overlap: 美食 45, 旅遊 80, 3C／科技產品 6, 程式／技術 2,
生活／日記 8, 親子 2, 新聞／媒體 0, 財經 13. In the sampled latest list,
38 / 67 sources and 131 / 200 articles have a classified source. This coverage
is not a claim of complete food or gadget detection. New and unknown slugs
remain unclassified until the review file is updated.

## Implementation and operation

- `tools/lib/blog-genres.ts` contains proposal and validation logic.
- `tools/propose-blog-genres.ts --input snapshot.json [--dry-run]` generates
  review proposals from a bounded read-only export shaped as
  `{ observedAt, blogs: [{ slug, name, description?, category }], tags: [{ slug, labels }] }`.
  `labels` is a newline-separated string. Generation replaces the review file;
  preserve manual corrections when updating it. It never opens a database.
- Edit `data/blog-genre-review.json`, then run
  `node tools/apply-blog-genres.ts --dry-run` to inspect whether the runtime map
  would change; `--apply` writes only `data/blog-genres.json`. Running it again
  reports `changed:false`. Removing an assignment removes it from the generated
  map, so corrections are reversible. This applies a repository artifact, not DB
  rows; no schema change, migration, or extra runtime database query is needed.
- `app/src/overview.js` adds optional `blogGenres` to public latest-post DTOs.
  `app/src/public-post.ts` allowlists it. `web/src/lib/api.ts` and
  `public-contracts.ts` accept absent fields on older gateways and validate
  known genre arrays when present. Missing genres never cause genre exclusion.
- `web/src/lib/article-filters.ts` parses and applies preferences;
  `web/src/components/public/Articles.tsx` renders the GET form and counts;
  `web/src/app/articles/page.tsx` reads query parameters for the SSR fallback.
  Existing force-dynamic and no-store boundaries remain in place. Architecture
  tests now allow public query parameters only on this server page.

URL example: `/articles/?maxPerBlog=3&exclude=food&exclude=gadgets`.
`maxPerBlog` accepts 0 (unlimited), 1, 2 or 3. Repeated `exclude` values accept
known genre IDs. Unknown values are discarded and duplicates collapse. There
is no localStorage preference, so opening an unfiltered URL is predictable.

Genre exclusion runs before the cap. A mixed-topic blog is excluded if any of
its genres is selected. Unclassified posts survive genre exclusion but can
still be limited by the per-blog cap. The UI shows active settings, retained
and hidden counts, unknown coverage, reset, and a distinct filtered-empty state.
It states that only the latest 200 candidates are filtered; older posts are not
fetched to fill gaps. Search (`?q=`) remains unfiltered and says so explicitly.
The homepage is unchanged; it already lists one latest post per blog.

## Validation

- `npm run typecheck`: passed, both gateway and web TypeScript projects.
- `npx biome check <changed code files>`: passed, 17 code files checked; JSON data is emitted with two-space indentation.
- `npx vitest run`: 134 files, 1,383 tests; initially 1,382 passed and one existing
  5-second subprocess timeout in `topics/snapshot-full-caller.spec.ts`.
  Rerunning that file alone passed all 18 tests in 1.70s. After the final reserved-slug guard, the two affected gateway
  files were rerun: 12 tests passed.
- `npm run test:topic-ui`: 11 files, 185 tests passed, including five new filter
  render tests (server fallback, URL parsing, counts, empty state and search scope).
- `npm run test:web`: 241 tests passed, including four filter logic tests and
  one new optional-DTO contract test.
- Three new gateway/tool tests cover proposal evidence, deterministic/removable
  mappings, reserved property names, DTO serialization, and no added DB reads.
- `npm run audit:topic-writers`: passed, 187 writers. No SQL write literal was
  introduced or changed; `data/topic-writer-registry.json` remains unchanged.
- Apply tool dry run: `changed:false`, 105 classified blogs after applying once.
- Real Next dev server with a local synthetic gateway: URL first load, form
  submission and reset verified in the collaborative browser. Four fixture
  articles reduce to one with cap 1 and food/gadget exclusions; reset restores
  four. At 390px viewport width the document scroll width is also 390px.
  Initial navigation automation timed out, but the subsequent snapshot showed
  the completed page and all later interactions succeeded. Existing footer
  duplicate `/about/` key warnings and fixture-only auth/icon 404s were observed.

No production end-to-end acceptance, production build, deployment, push or
migration was performed. Product decisions left open: change the default from
unlimited to three; refine genre names and review mixed-topic assignments;
extend classification; add homepage controls or separate post-tag exclusions.
